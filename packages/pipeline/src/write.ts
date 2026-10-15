import { tier2ReviewSample, type SourceKind, type TownConfig } from '@towncore/config';
import {
  articles,
  eq,
  inArray,
  records,
  sources,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import {
  factcheckV1,
  writerV1,
  type Classification,
  type FactcheckResult,
  type WriterDraft,
} from '@towncore/prompts';
import { buildByline } from './byline';
import { checkDraft, type FactcheckReport } from './factcheck';
import { llmTown } from './finder';
import { callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import { uniqueSlug } from './publish';
import {
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
  weatherAlert,
  type TemplatedDraft,
} from './templates';
import { decideTier, type Tier } from './tiers';
import { localWeekStart } from './time';

// Writer job (CLAUDE.md §6 steps 3–6): accepted candidate → draft → fact-check (one revise) →
// tier router → published, in review, or blocked. Templated items skip the model; their
// facts are copied from records by code, so they're checked by construction.

export type WriteOutcome =
  | { status: 'published' | 'in_review' | 'blocked'; articleId: string; reason?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'waiting'; reason: string };

type Row = { record: typeof records.$inferSelect; sourceKind: SourceKind };

export async function writeCandidate(
  db: Db,
  candidateId: string,
  opts: { llm?: Llm; now?: Date; random?: () => number } = {},
): Promise<WriteOutcome> {
  const now = opts.now ?? new Date();
  const random = opts.random ?? Math.random;
  const [candidate] = await db
    .select()
    .from(storyCandidates)
    .where(eq(storyCandidates.id, candidateId));
  if (!candidate || candidate.status !== 'accepted' || candidate.articleId) {
    return { status: 'skipped', reason: 'not an accepted, unwritten candidate' };
  }
  const [town] = await db.select().from(towns).where(eq(towns.id, candidate.townId));
  const config = town!.config as TownConfig;
  const rows: Row[] = (
    await db
      .select({ record: records, sourceKind: sources.kind })
      .from(records)
      .innerJoin(sources, eq(records.sourceId, sources.id))
      .where(inArray(records.id, candidate.recordIds))
  ).map((r) => ({ record: r.record, sourceKind: r.sourceKind as SourceKind }));

  await db
    .update(storyCandidates)
    .set({ status: 'writing' })
    .where(eq(storyCandidates.id, candidateId));
  const backTo = async (status: 'accepted' | 'skipped') =>
    db.update(storyCandidates).set({ status }).where(eq(storyCandidates.id, candidateId));

  // --- Templated items: built in code from the records.
  if (candidate.kind === 'roundup' || candidate.kind === 'template') {
    const draft = buildTemplate(candidate.key, town!, config, rows);
    if (!draft) {
      await backTo('skipped');
      return { status: 'skipped', reason: `no template for ${candidate.key}` };
    }
    // Roundups list businesses, meetings and alerts copied from structured records, so the
    // free-text minor heuristics don't apply (a business named "Teens Academy LLC" is not a
    // minor); the source-kind rules still do.
    const tier = decideTier({
      sourceKinds: rows.map((r) => r.sourceKind),
      beat: draft.beat,
      classification: null,
      text: '',
      baseTier: candidate.proposedTier as Tier,
    });
    return saveArticle(db, {
      candidateId,
      town: town!,
      draft,
      tier: tier.tier,
      tierReasons: [...(candidate.tierReasons ?? []), ...tier.reasons],
      factcheck: { method: 'template', score: 1, decision: 'pass' },
      promptVersions: ['template'],
      now,
      random,
    });
  }

  // --- Stories: writer, then a separate fact-check call, then code checks.
  if (!opts.llm) {
    await backTo('accepted');
    return { status: 'waiting', reason: 'no model provider configured' };
  }
  const llm = opts.llm;
  const tTown = llmTown(town!, config);
  const sourcesText = rows.map(({ record, sourceKind }) =>
    [
      `--- Record ${record.id} (source: ${sourceKind}${record.occurredAt ? `, dated ${record.occurredAt.toISOString()}` : ''}${record.url ? `, ${record.url}` : ''})`,
      `Title: ${record.title ?? ''}`,
      record.text ?? '',
    ].join('\n'),
  );
  const townLines = [
    `Town: ${town!.name}, ${town!.state} (${town!.county} County). Timezone: ${town!.timezone}.`,
    `Agencies: ${config.agencies.join('; ')}`,
  ];
  const knownNames = [town!.name, town!.siteName, town!.county, 'Florida', ...config.agencies];

  let draft: WriterDraft | undefined;
  let report: FactcheckReport | undefined;
  const versions = [
    `${writerV1.id}@${writerV1.version}`,
    `${factcheckV1.id}@${factcheckV1.version}`,
  ];
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remove =
        attempt === 2 && report
          ? [
              '',
              'Remove these claims, which the records do not support:',
              ...report.unsupportedClaims.map((c) => `- ${c}`),
            ]
          : [];
      ({ value: draft } = await callModel(llm, {
        job: 'writer',
        town: tTown,
        prompt: writerV1,
        input: [
          ...townLines,
          `Beat: ${candidate.beat}. Kind: story.`,
          ...remove,
          '',
          ...sourcesText,
        ].join('\n'),
      }));
      const { value: checked } = await callModel(llm, {
        job: 'fact-check',
        town: tTown,
        prompt: factcheckV1,
        input: [
          ...townLines,
          '',
          '=== Draft',
          `Headline: ${draft.headline}`,
          `Dek: ${draft.dek}`,
          draft.body_md,
          '',
          '=== Records',
          ...sourcesText,
        ].join('\n'),
      });
      report = checkDraft({
        draft: { headline: draft.headline, dek: draft.dek, bodyMd: draft.body_md },
        sources: rows.map((r) => ({ id: r.record.id, title: r.record.title, text: r.record.text })),
        model: checked as FactcheckResult,
        knownNames,
        otherPlaces: config.same_name_elsewhere,
      });
      if (report.decision !== 'revise') break;
    }
  } catch (error) {
    if (error instanceof SpendCapReached) {
      await backTo('accepted');
      return { status: 'waiting', reason: error.message };
    }
    if (error instanceof LlmOutputError && !draft) {
      // No draft to review: log it like a skip so a reviewer can retry it.
      await backTo('skipped');
      return { status: 'skipped', reason: `writer: ${error.message}` };
    }
    if (!(error instanceof LlmOutputError)) {
      await backTo('accepted');
      throw error;
    }
    report = undefined; // a draft exists but fact-check failed: human review
  }

  const finalDraft = draft!;
  const sourceIds = new Set(rows.map((r) => r.record.id));
  const cited = finalDraft.source_record_ids.filter((id) => sourceIds.has(id));
  const tier = decideTier({
    sourceKinds: rows.map((r) => r.sourceKind),
    beat: finalDraft.beat,
    classification: candidate.classification as Classification | null,
    text: [...rows.map((r) => `${r.record.title}\n${r.record.text}`), finalDraft.body_md].join(
      '\n',
    ),
  });
  return saveArticle(db, {
    candidateId,
    town: town!,
    draft: {
      headline: finalDraft.headline,
      dek: finalDraft.dek,
      bodyMd: finalDraft.body_md,
      beat: finalDraft.beat,
      // Rule 4: cite only records the writer was given; fall back to all of them.
      sourceRecordIds: cited.length > 0 ? cited : [...sourceIds],
    },
    claims: finalDraft.claims,
    tier: Math.max(candidate.proposedTier, tier.tier) as Tier,
    tierReasons: [...new Set([...(candidate.tierReasons ?? []), ...tier.reasons])],
    factcheck: report
      ? { method: 'model+code', ...report }
      : { method: 'model+code', decision: 'review', error: 'fact-check failed to run' },
    forceReview: !report ? 'model_error' : report.decision !== 'pass' ? 'factcheck' : undefined,
    promptVersions: versions,
    now,
    random,
  });
}

function buildTemplate(
  key: string,
  town: typeof towns.$inferSelect,
  config: TownConfig,
  rows: Row[],
): TemplatedDraft | null {
  const info = { name: town.name, timezone: town.timezone, agency: config.agencies[0]! };
  const recs = rows.map((r) => ({ ...r.record }));
  const weekOf = (iso: string) => localWeekStart(new Date(`${iso}T12:00:00Z`), town.timezone);
  const week = key.split(':')[2];
  if (key.startsWith('roundup:meetings:')) return meetingsRoundup(info, weekOf(week!), recs);
  if (key.startsWith('roundup:new-businesses:'))
    return newBusinessesRoundup(info, weekOf(week!), recs);
  if (key.startsWith('roundup:new-licenses:')) return newLicensesRoundup(info, weekOf(week!), recs);
  if (key.startsWith('alert:') && recs[0]) return weatherAlert(info, recs[0]);
  return null;
}

async function saveArticle(
  db: Db,
  a: {
    candidateId: string;
    town: typeof towns.$inferSelect;
    draft: TemplatedDraft;
    claims?: unknown;
    tier: Tier;
    tierReasons: string[];
    factcheck: Record<string, unknown>;
    forceReview?: 'factcheck' | 'model_error';
    promptVersions: string[];
    now: Date;
    random: () => number;
  },
): Promise<WriteOutcome> {
  // Tier router (§7): blocked, review, or publish.
  let status: 'published' | 'in_review' | 'blocked';
  let reviewReason: string | null = null;
  if (a.tier === 4) {
    status = 'blocked';
  } else if (a.forceReview) {
    status = 'in_review';
    reviewReason = a.forceReview;
  } else if (a.tier === 3) {
    status = 'in_review';
    reviewReason = 'tier3';
  } else if (a.tier === 2 && a.random() < tier2ReviewSample) {
    status = 'in_review';
    reviewReason = 'sample';
  } else {
    status = 'published';
  }

  const [article] = await db
    .insert(articles)
    .values({
      townId: a.town.id,
      slug: await uniqueSlug(db, a.town.id, a.draft.headline),
      headline: a.draft.headline,
      dek: a.draft.dek,
      bodyMd: a.draft.bodyMd,
      beat: a.draft.beat,
      tier: a.tier,
      status,
      byline: buildByline(a.town.siteName),
      sourceRecordIds: a.draft.sourceRecordIds,
      claims: a.claims ?? null,
      factcheck: a.factcheck,
      candidateId: a.candidateId,
      promptVersions: a.promptVersions,
      reviewReason,
      tierReasons: a.tierReasons,
      publishedAt: status === 'published' ? a.now : null,
    })
    .returning({ id: articles.id });
  await db
    .update(storyCandidates)
    .set({ status: 'written', articleId: article!.id })
    .where(eq(storyCandidates.id, a.candidateId));
  return reviewReason
    ? { status, articleId: article!.id, reason: reviewReason }
    : { status, articleId: article!.id };
}
