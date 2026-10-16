import { fileURLToPath } from 'node:url';
import { FIRST_GUIDE_BATCH, loadTowns } from '@towncore/config';
import {
  and,
  articles,
  eq,
  getTownBySlug,
  guideSourceKey,
  images,
  records,
  sources,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { factcheckV1, guideV1, type FactcheckResult, type GuideDraft } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStoryFinder } from '../src/finder';
import { createGuideCandidates, pagesHash } from '../src/guides';
import type { Llm, LlmProvider, LlmResponse } from '../src/llm';
import { writeCandidate } from '../src/write';

// Evergreen guides (CLAUDE.md §6a; docs/plans/M4.md §5, D-M4-2).
const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-17T15:00:00Z');
const PAGE =
  'Bulk Item Collection\nBulk items are collected from single-family residences once a week.\nA minimum fee of $161.71 will be charged for items measuring up to 2 cubic yards.\nTo schedule a pickup, please call the Sanitation Department at 561-416-3367.';
const BULK_URL = 'https://www.myboca.us/684/Bulk-Waste';

let db: Db;
let drop: () => Promise<void>;
let town: typeof towns.$inferSelect;
let bulkSource: string;

const draft = (over: Partial<GuideDraft> = {}): GuideDraft => ({
  headline: 'How bulk trash pickup works in Boca Raton',
  dek: 'What the city collects, how to set it out and what a paid pickup costs.',
  body_md:
    '## Collection\nBulk items are collected from single-family residences once a week.\n\n## Paid pickups\nA minimum fee of $161.71 will be charged for items measuring up to 2 cubic yards. Call the Sanitation Department at 561-416-3367.',
  source_record_ids: [],
  claims: [],
  ...over,
});
const check = (recordId: string, supported = true): FactcheckResult => ({
  claims: [
    {
      claim: 'weekly',
      record_id: recordId,
      quote: 'collected from single-family residences once a week',
      supported,
    },
    { claim: 'fee', record_id: recordId, quote: 'A minimum fee of $161.71', supported: true },
  ],
  wrong_town_risk: false,
  wrong_town_reason: null,
});

/** Scripted answers per prompt; records every request. */
function scripted(answers: { guide: unknown[]; factcheck: unknown[] }) {
  const calls: string[] = [];
  const queues = { guide: [...answers.guide], factcheck: [...answers.factcheck] };
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request): Promise<LlmResponse> {
      const prompt =
        request.system === guideV1.system
          ? 'guide'
          : request.system === factcheckV1.system
            ? 'factcheck'
            : 'other';
      calls.push(prompt);
      const queue = queues[prompt as 'guide' | 'factcheck'];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 };
      return { text: JSON.stringify(next), stop: 'end', model: 'gemini-flash-latest', usage };
    },
  };
  const llm: Llm = { db, provider, providerName: 'gemini', now: () => NOW };
  return { llm, calls };
}

async function setPage(text = PAGE, url = BULK_URL, sourceId = bulkSource) {
  const externalId = `page:${url}`;
  const hash = `h-${text.length}-${text.slice(-12)}`;
  const [existing] = await db
    .select()
    .from(records)
    .where(and(eq(records.sourceId, sourceId), eq(records.externalId, externalId)));
  if (existing) {
    await db
      .update(records)
      .set({ text, contentHash: hash, changedAt: NOW })
      .where(eq(records.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(records)
    .values({
      sourceId,
      townId: town.id,
      externalId,
      type: 'page',
      title: 'Bulk Waste',
      text,
      url,
      contentHash: hash,
      raw: { topic: 'bulk-waste' },
    })
    .returning();
  return row!.id;
}

async function guideCandidate() {
  await createGuideCandidates(db, town, NOW);
  const rows = await db
    .select()
    .from(storyCandidates)
    .where(and(eq(storyCandidates.townId, town.id), eq(storyCandidates.kind, 'guide')));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncTowns(
    db,
    loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton'),
  );
  town = (await getTownBySlug(db, 'boca-raton'))!;
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.townId, town.id), eq(sources.key, guideSourceKey('bulk-waste'))));
  bulkSource = source!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(images);
  await db.delete(articles);
  await db.delete(storyCandidates);
  await db.delete(records);
});

describe('guide candidates', () => {
  it('queue once per version of a topic’s pages, outside the story budget', async () => {
    await setPage();
    expect(await createGuideCandidates(db, town, NOW)).toBe(1);
    expect(await createGuideCandidates(db, town, NOW)).toBe(0);
    const [candidate] = await guideCandidate();
    expect(candidate).toMatchObject({
      kind: 'guide',
      status: 'accepted',
      beat: 'community',
      proposedTier: 1,
      title: 'Bulk trash and yard waste',
    });
    expect(candidate!.key).toMatch(/^guide:bulk-waste:[0-9a-f]{16}$/);
    // The page changes: a new version, so a new candidate.
    await setPage(`${PAGE}\nBulk items should be placed 5 feet away from obstructions.`);
    expect(await createGuideCandidates(db, town, NOW)).toBe(1);
  });

  it('wait until every page of the topic has been fetched', async () => {
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.townId, town.id), eq(sources.key, guideSourceKey('trash-pickup'))));
    const pages = (source!.config as { pages: string[] }).pages;
    expect(pages.length).toBe(2);
    await setPage(PAGE, pages[0]!, source!.id);
    expect(await createGuideCandidates(db, town, NOW)).toBe(0);
    await setPage(PAGE, pages[1]!, source!.id);
    expect(await createGuideCandidates(db, town, NOW)).toBe(1);
  });

  it('come from the story finder run', async () => {
    await setPage();
    const report = await runStoryFinder(db, town.id, { now: NOW });
    expect(report.guides).toBe(1);
  });

  it('hash the pages order-independently', () => {
    const a = { externalId: 'page:a', contentHash: '1' };
    const b = { externalId: 'page:b', contentHash: '2' };
    expect(pagesHash([a, b])).toBe(pagesHash([b, a]));
    expect(pagesHash([a, b])).not.toBe(pagesHash([a, { ...b, contentHash: '3' }]));
  });
});

describe('writing guides', () => {
  it('writes from the pages, fact-checks, and sends the first batch to review', async () => {
    const recordId = await setPage();
    const [candidate] = await guideCandidate();
    const { llm, calls } = scripted({
      guide: [draft({ source_record_ids: [recordId] })],
      factcheck: [check(recordId)],
    });
    const outcome = await writeCandidate(db, candidate!.id, { llm, now: NOW });
    expect(outcome).toMatchObject({ status: 'in_review', reason: 'first_guides' });
    expect(calls).toEqual(['guide', 'factcheck']);
    const [guide] = await db.select().from(articles).where(eq(articles.kind, 'guide'));
    expect(guide).toMatchObject({
      guideTopic: 'bulk-waste',
      tier: 1,
      beat: 'community',
      byline: 'Boca Town Square Newsroom',
      sourceRecordIds: [recordId],
      promptVersions: ['guide@v1', 'factcheck@v1'],
    });
    expect((guide!.factcheck as { decision: string }).decision).toBe('pass');
    // Every guide gets a visual, like every article.
    expect(await db.select().from(images).where(eq(images.articleId, guide!.id))).toHaveLength(1);
  });

  it('publishes as Tier 1 once the first batch is out, and rewrites in place when pages change', async () => {
    // The town already has a full first batch of published guides.
    await db.insert(articles).values(
      Array.from({ length: FIRST_GUIDE_BATCH }, (_, i) => ({
        townId: town.id,
        slug: `old-guide-${i}`,
        headline: `Old guide ${i}`,
        bodyMd: 'Body.',
        beat: 'community',
        tier: 1,
        status: 'published' as const,
        byline: 'Boca Town Square Newsroom',
        sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
        kind: 'guide',
        publishedAt: new Date('2026-09-01T12:00:00Z'),
      })),
    );
    const recordId = await setPage();
    const [first] = await guideCandidate();
    const answers = {
      guide: [draft({ source_record_ids: [recordId] })],
      factcheck: [check(recordId)],
    };
    expect(
      await writeCandidate(db, first!.id, { llm: scripted(answers).llm, now: NOW }),
    ).toMatchObject({ status: 'published' });
    const [before] = await db.select().from(articles).where(eq(articles.guideTopic, 'bulk-waste'));

    // The city changes the page: the guide is rewritten under the same address.
    const later = new Date(NOW.getTime() + 86_400_000);
    await setPage(`${PAGE}\nBulk items should be placed 5 feet away from obstructions.`);
    await createGuideCandidates(db, town, later);
    const [second] = await guideCandidate();
    expect(second!.id).not.toBe(first!.id);
    const rewrite = scripted({
      guide: [
        draft({ headline: 'Bulk trash pickup in Boca Raton', source_record_ids: [recordId] }),
      ],
      factcheck: [check(recordId)],
    });
    expect(await writeCandidate(db, second!.id, { llm: rewrite.llm, now: later })).toMatchObject({
      status: 'published',
      articleId: before!.id,
    });
    const guides = await db.select().from(articles).where(eq(articles.guideTopic, 'bulk-waste'));
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({
      id: before!.id,
      slug: before!.slug,
      headline: 'Bulk trash pickup in Boca Raton',
      publishedAt: before!.publishedAt,
      updatedAt: later,
    });
  });

  it('sends a guide that fails fact-check to review after one revise', async () => {
    const recordId = await setPage();
    const [candidate] = await guideCandidate();
    const { llm, calls } = scripted({
      guide: [draft({ source_record_ids: [recordId] })],
      factcheck: [check(recordId, false)],
    });
    expect(await writeCandidate(db, candidate!.id, { llm, now: NOW })).toMatchObject({
      status: 'in_review',
      reason: 'factcheck',
    });
    expect(calls).toEqual(['guide', 'factcheck', 'guide', 'factcheck']);
  });

  it('never writes from stale pages: an older version is skipped', async () => {
    await setPage();
    const [old] = await guideCandidate();
    await setPage(`${PAGE}\nNew rule.`);
    const { llm, calls } = scripted({ guide: [draft()], factcheck: [check('x')] });
    expect(await writeCandidate(db, old!.id, { llm, now: NOW })).toMatchObject({
      status: 'skipped',
      reason: 'superseded: the pages changed again',
    });
    expect(calls).toEqual([]);
  });

  it('keeps the same tier rules as stories: a minor’s age blocks it for a reviewer', async () => {
    const text = `${PAGE}\nChildren 12 years old and under must be accompanied by an adult.`;
    const recordId = await setPage(text);
    const [candidate] = await guideCandidate();
    const { llm } = scripted({
      guide: [
        draft({
          body_md: `${draft().body_md}\n\nChildren 12 years old and under must be accompanied by an adult.`,
          source_record_ids: [recordId],
        }),
      ],
      factcheck: [check(recordId)],
    });
    expect(await writeCandidate(db, candidate!.id, { llm, now: NOW })).toMatchObject({
      status: 'blocked',
    });
  });

  it('waits without a model provider', async () => {
    await setPage();
    const [candidate] = await guideCandidate();
    expect(await writeCandidate(db, candidate!.id, { now: NOW })).toMatchObject({
      status: 'waiting',
    });
    const [row] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.id, candidate!.id));
    expect(row!.status).toBe('accepted');
  });
});
