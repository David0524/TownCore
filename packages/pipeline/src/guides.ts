import { createHash } from 'node:crypto';
import { FIRST_GUIDE_BATCH, guideTopic, type TownConfig } from '@towncore/config';
import {
  and,
  articles,
  count,
  eq,
  inArray,
  records,
  sources,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { factcheckV1, guideV1, type FactcheckResult, type GuideDraft } from '@towncore/prompts';
import { buildByline } from './byline';
import { checkDraft, type FactcheckReport } from './factcheck';
import { llmTown } from './finder';
import { assignArticleImage } from './images';
import { BatchPending, callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import { uniqueSlug } from './publish';
import { decideTier } from './tiers';

// Evergreen guides (CLAUDE.md §6a, §10 step 6; docs/plans/M4.md §5, D-M4-2). Each guide topic
// a town configures has a reference source of official pages (the `page` adapter). When a
// topic's pages are first fetched, or their text changes, a guide candidate is queued; the
// writer drafts the guide from those pages only, a separate fact-check call and the code checks
// verify it, and the guide is written, or rewritten in place under the same address.
// Guides are Tier 1, but go to review until the town's first batch is published, and whenever
// they fail a check.

type TownRow = typeof towns.$inferSelect;

/**
 * The same fact-check prompt (wording and version) with more room to answer: a guide makes two
 * or three times as many claims as a story, and the first live run cut 2 of 12 answers off at
 * the stories' 12,000-token limit.
 */
type PageRecord = typeof records.$inferSelect;

/** A short fingerprint of a topic's pages: changes whenever any page's text does. */
export function pagesHash(pages: Array<Pick<PageRecord, 'externalId' | 'contentHash'>>): string {
  const canonical = pages
    .map((p) => `${p.externalId}:${p.contentHash}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** The town's guide topics whose every page has been fetched, with those pages. */
async function topicPages(db: Db, townId: string) {
  const rows = await db
    .select({ source: sources, record: records })
    .from(sources)
    .innerJoin(records, eq(records.sourceId, sources.id))
    .where(
      and(eq(sources.townId, townId), eq(sources.kind, 'reference'), eq(records.type, 'page')),
    );
  const bySource = new Map<string, { topic: string; pages: string[]; records: PageRecord[] }>();
  for (const { source, record } of rows) {
    const config = source.config as { topic?: string; pages?: string[] };
    if (!config.topic || !config.pages) continue;
    const entry = bySource.get(source.id) ?? {
      topic: config.topic,
      pages: config.pages,
      records: [],
    };
    entry.records.push(record);
    bySource.set(source.id, entry);
  }
  // Only the pages the config lists now (a page removed from the YAML no longer counts), and
  // only topics with all of them: a guide is never written from part of its pages.
  return [...bySource.values()]
    .map((t) => ({
      ...t,
      records: t.pages
        .map((url) => t.records.find((r) => r.externalId === `page:${url}`))
        .filter((r): r is PageRecord => Boolean(r)),
    }))
    .filter((t) => t.records.length === t.pages.length && guideTopic(t.topic));
}

/** Queues a guide candidate for each topic that has no guide yet or whose pages changed. */
export async function createGuideCandidates(db: Db, town: TownRow, now: Date): Promise<number> {
  let created = 0;
  for (const t of await topicPages(db, town.id)) {
    const topic = guideTopic(t.topic)!;
    const [row] = await db
      .insert(storyCandidates)
      .values({
        townId: town.id,
        kind: 'guide',
        key: `guide:${t.topic}:${pagesHash(t.records)}`,
        title: topic.title,
        beat: topic.beat,
        recordIds: t.records.map((r) => r.id),
        proposedTier: 1,
        status: 'accepted',
        acceptedAt: now,
        tierReasons: ['evergreen guide'],
      })
      .onConflictDoNothing({ target: [storyCandidates.townId, storyCandidates.key] })
      .returning({ id: storyCandidates.id });
    if (row) created++;
  }
  return created;
}

export type GuideOutcome =
  | { status: 'published' | 'in_review' | 'blocked'; articleId: string; reason?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'waiting'; reason: string };

/** Writes (or rewrites) the guide for a guide candidate. Called by the writer job. */
export async function writeGuide(
  db: Db,
  candidate: typeof storyCandidates.$inferSelect,
  opts: { llm?: Llm; now: Date; backTo: (status: 'accepted' | 'skipped') => Promise<unknown> },
): Promise<GuideOutcome> {
  const { now, backTo } = opts;
  const [, topicKey, hash] = candidate.key.split(':');
  const topic = guideTopic(topicKey ?? '');
  const [town] = await db.select().from(towns).where(eq(towns.id, candidate.townId));
  const config = town!.config as TownConfig;
  const current = (await topicPages(db, town!.id)).find((t) => t.topic === topicKey);
  if (!topic || !current) {
    await backTo('skipped');
    return { status: 'skipped', reason: `guide topic ${topicKey} is no longer configured` };
  }
  // A newer version of the pages has its own candidate; never write from stale text.
  if (pagesHash(current.records) !== hash) {
    await backTo('skipped');
    return { status: 'skipped', reason: 'superseded: the pages changed again' };
  }
  if (!opts.llm) {
    await backTo('accepted');
    return { status: 'waiting', reason: 'no model provider configured' };
  }
  const llm = opts.llm;
  const pages = current.records;
  const tTown = llmTown(town!, config);
  const townLines = [
    `Town: ${town!.name}, ${town!.state} (${town!.county} County). Timezone: ${town!.timezone}.`,
    `Agencies: ${config.agencies.join('; ')}`,
  ];
  const pagesText = pages.map((p) =>
    [`--- Record ${p.id} (official page, ${p.url})`, `Title: ${p.title ?? ''}`, p.text ?? ''].join(
      '\n',
    ),
  );
  // The pages name their own offices and agencies (a county property appraiser, a school
  // district); those names are checked against the pages like any other.
  const knownNames = [town!.name, town!.siteName, town!.county, 'Florida', ...config.agencies];

  let draft: GuideDraft | undefined;
  let report: FactcheckReport | undefined;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remove =
        attempt === 2 && report
          ? [
              '',
              'Remove these claims, which the pages do not support:',
              ...report.unsupportedClaims.map((c) => `- ${c}`),
            ]
          : [];
      ({ value: draft } = await callModel(llm, {
        job: 'guide',
        town: tTown,
        prompt: guideV1,
        task: attempt === 1 ? 'guide' : 'guide-revise',
        inputPrefix: townLines.join('\n'),
        input: [
          `Guide topic: ${topic.title}. Readers need: ${topic.need}.`,
          ...remove,
          '',
          ...pagesText,
        ].join('\n'),
      }));
      const { value: checked } = await callModel(llm, {
        job: 'guide.fact-check',
        town: tTown,
        prompt: factcheckV1,
        task: 'guide-factcheck',
        inputPrefix: townLines.join('\n'),
        input: [
          '',
          '=== Draft',
          `Headline: ${draft.headline}`,
          `Dek: ${draft.dek}`,
          draft.body_md,
          '',
          '=== Records',
          ...pagesText,
        ].join('\n'),
      });
      report = checkDraft({
        draft: { headline: draft.headline, dek: draft.dek, bodyMd: draft.body_md },
        sources: pages.map((p) => ({ id: p.id, title: p.title, text: p.text })),
        model: checked as FactcheckResult,
        knownNames,
        otherPlaces: config.same_name_elsewhere,
      });
      if (report.decision !== 'revise') break;
    }
  } catch (error) {
    // Guides go through the Batch API: each step waits for its batch, and the next run picks the
    // answer up by the same request (never sent twice) and goes on to the next step.
    if (error instanceof SpendCapReached || error instanceof BatchPending) {
      await backTo('accepted');
      return { status: 'waiting', reason: error.message };
    }
    if (error instanceof LlmOutputError && !draft) {
      await backTo('skipped');
      return { status: 'skipped', reason: `guide writer: ${error.message}` };
    }
    if (!(error instanceof LlmOutputError)) {
      await backTo('accepted');
      throw error;
    }
    report = undefined; // a draft exists but fact-check failed: human review
  }

  const final = draft!;
  const pageIds = new Set(pages.map((p) => p.id));
  const cited = final.source_record_ids.filter((id) => pageIds.has(id));
  // The same deterministic rules as every story (§7); a guide starts at Tier 1.
  const tier = decideTier({
    sourceKinds: ['reference'],
    beat: topic.beat,
    classification: null,
    text: [final.headline, final.dek, final.body_md].join('\n'),
    baseTier: 1,
  });
  const [{ published }] = (await db
    .select({ published: count() })
    .from(articles)
    .where(
      and(
        eq(articles.townId, town!.id),
        eq(articles.kind, 'guide'),
        inArray(articles.status, ['published', 'corrected']),
      ),
    )) as [{ published: number }];

  let status: 'published' | 'in_review' | 'blocked' = 'published';
  let reviewReason: string | null = null;
  if (tier.tier === 4) [status, reviewReason] = ['blocked', null];
  else if (!report) [status, reviewReason] = ['in_review', 'model_error'];
  else if (report.decision !== 'pass') [status, reviewReason] = ['in_review', 'factcheck'];
  else if (tier.tier === 3) [status, reviewReason] = ['in_review', 'tier3'];
  // D-M4-2: the first batch for each town is reviewed by a person.
  else if (Number(published) < FIRST_GUIDE_BATCH)
    [status, reviewReason] = ['in_review', 'first_guides'];

  const [existing] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.townId, town!.id), eq(articles.guideTopic, topic.key)));
  const values = {
    headline: final.headline,
    dek: final.dek,
    bodyMd: final.body_md,
    beat: topic.beat,
    tier: tier.tier,
    status,
    byline: buildByline(town!.siteName),
    // A rewrite drops any earlier reviewer: the new text hasn't been reviewed.
    reviewerId: null,
    sourceRecordIds: cited.length > 0 ? cited : [...pageIds],
    claims: final.claims,
    factcheck: report
      ? { method: 'model+code', ...report, pagesHash: hash }
      : { method: 'model+code', decision: 'review', error: 'fact-check failed to run' },
    candidateId: candidate.id,
    kind: 'guide',
    guideTopic: topic.key,
    promptVersions: [
      `${guideV1.id}@${guideV1.version}`,
      `${factcheckV1.id}@${factcheckV1.version}`,
    ],
    reviewReason,
    tierReasons: tier.reasons,
    rejectionReason: null,
    // A guide keeps its first publication date; "Updated" comes from updated_at.
    publishedAt:
      status === 'published' ? (existing?.publishedAt ?? now) : (existing?.publishedAt ?? null),
    updatedAt: now,
  };
  let articleId: string;
  if (existing) {
    await db.update(articles).set(values).where(eq(articles.id, existing.id));
    articleId = existing.id;
  } else {
    const [row] = await db
      .insert(articles)
      .values({
        ...values,
        townId: town!.id,
        slug: await uniqueSlug(db, town!.id, final.headline),
      })
      .returning({ id: articles.id });
    articleId = row!.id;
  }
  await db
    .update(storyCandidates)
    .set({ status: 'written', articleId })
    .where(eq(storyCandidates.id, candidate.id));
  if (status !== 'blocked') await assignArticleImage(db, articleId);
  if (status === 'blocked') return { status, articleId, reason: tier.reasons.join('; ') };
  return reviewReason ? { status, articleId, reason: reviewReason } : { status, articleId };
}
