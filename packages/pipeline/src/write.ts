import { tier2ReviewSample, type SourceKind, type TownConfig } from '@towncore/config';
import {
  and,
  articles,
  articleUpdates,
  desc,
  eq,
  gte,
  lt,
  pins,
  inArray,
  records,
  sources,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import {
  classifyPrompt,
  factcheckV1,
  updateV1,
  writerV1,
  type Classification,
  type FactcheckResult,
  type WriterDraft,
} from '@towncore/prompts';
import { buildByline } from './byline';
import { assignArticleImage } from './images';
import { checkDraft, type FactcheckReport } from './factcheck';
import { applyUpdate, linkRelatedStories } from './followups';
import { writeGuide } from './guides';
import { llmTown } from './finder';
import { callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import { uniqueSlug } from './publish';
import {
  federalAwardsRoundup,
  inspectionsRoundup,
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
  permitsRoundup,
  propertySalesRoundup,
  roadWorkRoundup,
  newPlacesRoundup,
  weatherAlert,
  type RoundupKind,
  type TemplatedDraft,
} from './templates';
import { pastWeekCounts, roundupWeekRecords } from './roundup-weeks';
import {
  inspectionSpotlight,
  permitSpotlight,
  SPOTLIGHT_ROUNDUP,
  type SpotlightKind,
} from './spotlights';
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

  // --- Evergreen guides: written from their topic's official pages (M4 PR F).
  if (candidate.kind === 'guide') {
    return writeGuide(db, candidate, { llm: opts.llm, now, backTo });
  }

  // --- Templated items: built in code from the records.
  if (candidate.kind === 'roundup' || candidate.kind === 'template') {
    const draft = await buildTemplate(db, candidate.key, town!, config, rows);
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
    const isAlert = candidate.key.startsWith('alert:');
    const isSpotlight = candidate.key.startsWith('spotlight:');
    return saveArticle(db, {
      candidateId,
      town: town!,
      draft,
      kind: isAlert ? 'alert' : isSpotlight ? 'story' : 'roundup',
      pin: isAlert ? severeWeatherPin(rows[0]?.record.raw, now) : null,
      tier: tier.tier,
      tierReasons: [...(candidate.tierReasons ?? []), ...tier.reasons],
      factcheck: { method: 'template', score: 1, decision: 'pass' },
      promptVersions: ['template'],
      now,
      random,
    });
  }

  if (candidate.kind === 'update') {
    return writeUpdate(db, {
      candidate,
      town: town!,
      config,
      rows,
      llm: opts.llm,
      now,
      random,
      backTo,
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
        // The second attempt, with the unsupported claims removed, is the one revise (§7).
        task: attempt === 1 ? 'write' : 'revise',
        inputPrefix: townLines.join('\n'),
        input: [`Beat: ${candidate.beat}. Kind: story.`, ...remove, '', ...sourcesText].join('\n'),
      }));
      const { value: checked } = await callModel(llm, {
        job: 'fact-check',
        town: tTown,
        prompt: factcheckV1,
        inputPrefix: townLines.join('\n'),
        input: [
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
    kind: 'story',
    pin: roadClosurePin(finalDraft.headline, now),
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
    forceReview: !report
      ? 'model_error'
      : report.decision !== 'pass'
        ? 'factcheck'
        : // Machine captions can misspell names, so a person checks any story built on one.
          rows.some((r) => r.record.type === 'transcript')
          ? 'transcript'
          : undefined,
    promptVersions: versions,
    now,
    random,
  });
}

const ROUNDUPS: Record<RoundupKind, typeof meetingsRoundup> = {
  meetings: meetingsRoundup,
  'new-businesses': newBusinessesRoundup,
  'new-licenses': newLicensesRoundup,
  inspections: inspectionsRoundup,
  permits: permitsRoundup,
  sales: propertySalesRoundup,
  'new-places': newPlacesRoundup,
  roads: roadWorkRoundup,
  federal: federalAwardsRoundup,
};

/** Builds a templated item; a roundup also gets the town's own past weeks to compare with. */
export async function buildTemplate(
  db: Db,
  key: string,
  town: typeof towns.$inferSelect,
  config: TownConfig,
  rows: Row[],
): Promise<TemplatedDraft | null> {
  const info = { name: town.name, timezone: town.timezone, agency: config.agencies[0]! };
  const recs = rows.map((r) => ({ ...r.record }));
  const [prefix, kind, week] = key.split(':');
  if (prefix === 'roundup' && week && kind && kind in ROUNDUPS) {
    const k = kind as RoundupKind;
    const weekStart = localWeekStart(new Date(`${week}T12:00:00Z`), town.timezone);
    const past = await pastWeekCounts(db, town, k, weekStart);
    return ROUNDUPS[k](info, weekStart, recs, past);
  }
  if (prefix === 'alert' && recs[0]) return weatherAlert(info, recs[0]);
  if (prefix === 'spotlight' && kind && week && kind in SPOTLIGHT_ROUNDUP && recs[0]) {
    const k = kind as SpotlightKind;
    const weekStart = localWeekStart(new Date(`${week}T12:00:00Z`), town.timezone);
    const weekRecs = await roundupWeekRecords(db, town, SPOTLIGHT_ROUNDUP[k], weekStart);
    if (k === 'inspection') {
      const license = key.split(':').slice(3).join(':');
      const history = await inspectionHistory(db, town.id, license, weekStart);
      return inspectionSpotlight(info, recs, history);
    }
    return permitSpotlight(info, recs[0], weekRecs);
  }
  return null;
}

/** An establishment's inspections in the year before the spotlight's week, newest first. */
async function inspectionHistory(db: Db, townId: string, license: string, before: Date) {
  return db
    .select()
    .from(records)
    .where(
      and(
        eq(records.townId, townId),
        eq(records.type, 'inspection'),
        sql`${records.raw}->>'licenseNumber' = ${license}`,
        gte(records.occurredAt, new Date(before.getTime() - 365 * 86_400_000)),
        lt(records.occurredAt, before),
      ),
    )
    .orderBy(desc(records.occurredAt));
}

async function saveArticle(
  db: Db,
  a: {
    candidateId: string;
    town: typeof towns.$inferSelect;
    draft: TemplatedDraft;
    kind: 'story' | 'roundup' | 'alert';
    pin?: AutoPin | null;
    claims?: unknown;
    tier: Tier;
    tierReasons: string[];
    factcheck: Record<string, unknown>;
    forceReview?: 'factcheck' | 'model_error' | 'transcript';
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
      kind: a.kind,
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
  // The article's visual (§11c), chosen now so it's ready whenever the article is published.
  if (status !== 'blocked') await assignArticleImage(db, article!.id);
  if (a.pin && status !== 'blocked') {
    await db.insert(pins).values({
      articleId: article!.id,
      townId: a.town.id,
      reason: a.pin.reason,
      expiresAt: a.pin.expiresAt,
    });
  }
  if (status !== 'blocked' && !a.promptVersions.includes('template')) {
    await linkRelatedStories(
      db,
      { id: article!.id, townId: a.town.id, headline: a.draft.headline, bodyMd: a.draft.bodyMd },
      a.now,
    );
  }
  return reviewReason
    ? { status, articleId: article!.id, reason: reviewReason }
    : { status, articleId: article!.id };
}

/** A dated update note for a published story (CLAUDE.md §6a), checked like any draft. */
async function writeUpdate(
  db: Db,
  a: {
    candidate: typeof storyCandidates.$inferSelect;
    town: typeof towns.$inferSelect;
    config: TownConfig;
    rows: Row[];
    llm?: Llm;
    now: Date;
    random: () => number;
    backTo: (status: 'accepted' | 'skipped') => Promise<unknown>;
  },
): Promise<WriteOutcome> {
  const { candidate, town, config, rows, now } = a;
  const [target] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, candidate.targetArticleId ?? '00000000-0000-0000-0000-000000000000'));
  if (!target || !['published', 'corrected'].includes(target.status)) {
    await a.backTo('skipped');
    return { status: 'skipped', reason: 'the story to update is not published' };
  }
  if (!a.llm) {
    await a.backTo('accepted');
    return { status: 'waiting', reason: 'no model provider configured' };
  }
  const tTown = llmTown(town, config);
  const townLines = [
    `Town: ${town.name}, ${town.state} (${town.county} County). Timezone: ${town.timezone}.`,
    `Agencies: ${config.agencies.join('; ')}`,
  ];
  const recordText = (rs: { record: typeof records.$inferSelect; sourceKind: string }[]) =>
    rs.map(({ record, sourceKind }) =>
      [
        `--- Record ${record.id} (source: ${sourceKind}${record.occurredAt ? `, dated ${record.occurredAt.toISOString()}` : ''})`,
        `Title: ${record.title ?? ''}`,
        record.text ?? '',
      ].join('\n'),
    );
  const originals = (
    await db
      .select({ record: records, sourceKind: sources.kind })
      .from(records)
      .innerJoin(sources, eq(records.sourceId, sources.id))
      .where(inArray(records.id, target.sourceRecordIds))
  ).map((r) => ({ record: r.record, sourceKind: r.sourceKind as SourceKind }));

  let classification: Classification;
  let note: { note_md: string; source_record_ids: string[] };
  let report: FactcheckReport | undefined;
  try {
    ({ value: classification } = await callModel(a.llm, {
      job: 'update.classify',
      town: tTown,
      prompt: classifyPrompt,
      inputPrefix: townLines.join('\n'),
      input: ['', ...recordText(rows)].join('\n'),
    }));
    ({ value: note } = await callModel(a.llm, {
      job: 'update.write',
      town: tTown,
      prompt: updateV1,
      inputPrefix: townLines.join('\n'),
      input: [
        '',
        '=== Published story',
        `Headline: ${target.headline}`,
        target.bodyMd,
        '',
        '=== New records',
        ...recordText(rows),
      ].join('\n'),
    }));
    const { value: checked } = await callModel(a.llm, {
      job: 'update.fact-check',
      town: tTown,
      prompt: factcheckV1,
      inputPrefix: townLines.join('\n'),
      input: [
        '',
        '=== Draft',
        'Headline: (update note)',
        note.note_md,
        '',
        '=== Records',
        ...recordText(rows),
      ].join('\n'),
    });
    report = checkDraft({
      draft: { headline: '', dek: '', bodyMd: note.note_md },
      // Names and numbers may also come from the story's own records (context).
      sources: [...rows, ...originals].map((r) => ({
        id: r.record.id,
        title: r.record.title,
        text: r.record.text,
      })),
      model: checked as FactcheckResult,
      knownNames: [town.name, town.siteName, town.county, 'Florida', ...config.agencies],
      otherPlaces: config.same_name_elsewhere,
    });
  } catch (error) {
    if (error instanceof SpendCapReached) {
      await a.backTo('accepted');
      return { status: 'waiting', reason: error.message };
    }
    if (error instanceof LlmOutputError) {
      await a.backTo('skipped');
      return { status: 'skipped', reason: `update: ${error.message}` };
    }
    await a.backTo('accepted');
    throw error;
  }

  const decision = decideTier({
    sourceKinds: rows.map((r) => r.sourceKind),
    beat: target.beat,
    classification,
    text: [...rows.map((r) => `${r.record.title}\n${r.record.text}`), note.note_md].join('\n'),
    baseTier: target.tier as Tier,
  });
  const tier = Math.max(target.tier, decision.tier) as Tier;
  let status: 'published' | 'in_review' | 'rejected' = 'published';
  let reviewReason: string | null = null;
  if (tier === 4) [status, reviewReason] = ['rejected', 'tier4'];
  else if (report.decision !== 'pass') [status, reviewReason] = ['in_review', 'factcheck'];
  else if (tier === 3) [status, reviewReason] = ['in_review', 'tier3'];
  else if (tier === 2 && a.random() < tier2ReviewSample)
    [status, reviewReason] = ['in_review', 'sample'];

  const [update] = await db
    .insert(articleUpdates)
    .values({
      articleId: target.id,
      candidateId: candidate.id,
      noteMd: note.note_md,
      recordIds: rows.map((r) => r.record.id),
      tier,
      status: status === 'published' ? 'in_review' : status,
      reviewReason,
      factcheck: { method: 'model+code', ...report, tierReasons: decision.reasons },
    })
    .returning({ id: articleUpdates.id });
  if (status === 'published') await applyUpdate(db, update!.id, { now });
  await db
    .update(storyCandidates)
    .set({ status: 'written', articleId: target.id })
    .where(eq(storyCandidates.id, candidate.id));
  if (status === 'rejected') return { status: 'blocked', articleId: target.id, reason: 'tier4' };
  return reviewReason
    ? { status, articleId: target.id, reason: reviewReason }
    : { status, articleId: target.id };
}

type AutoPin = { reason: string; expiresAt: Date };

/** Severe and Extreme NWS warnings pin themselves until the alert expires (§6a). */
export function severeWeatherPin(raw: unknown, now: Date): AutoPin | null {
  const alert = (raw ?? {}) as { severity?: string; expires?: string; ends?: string | null };
  if (!['Severe', 'Extreme'].includes(alert.severity ?? '')) return null;
  const until = new Date(alert.ends ?? alert.expires ?? '');
  const expiresAt = Number.isNaN(until.getTime())
    ? new Date(now.getTime() + 24 * 3_600_000)
    : until;
  return expiresAt > now ? { reason: 'severe weather warning', expiresAt } : null;
}

const ROAD_CLOSURE =
  /\b(road|lane|street|bridge|ramp)s? closures?\b|\bclos(es|ed|ing|ure of)\b.*\b(road|street|avenue|boulevard|highway|bridge|lanes?)\b/i;

/** Road-closure stories pin themselves for 48 hours (§6a). */
export function roadClosurePin(headline: string, now: Date): AutoPin | null {
  return ROAD_CLOSURE.test(headline)
    ? { reason: 'road closure', expiresAt: new Date(now.getTime() + 48 * 3_600_000) }
    : null;
}
