import { fileURLToPath } from 'node:url';
import { loadTowns, type TownConfig } from '@towncore/config';
import {
  aiUsage,
  articleLinks,
  articles,
  articleScores,
  articleUpdates,
  eq,
  getTownBySlug,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { classifyV1, factcheckV1, updateV1, type FactcheckResult } from '@towncore/prompts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStoryFinder } from '../src/finder';
import {
  linkRelatedStories,
  matchPublished,
  mentionsDroppedCharges,
  updateParagraph,
} from '../src/followups';
import type { Llm, LlmProvider } from '../src/llm';
import { writeCandidate } from '../src/write';
import { classification } from './helpers';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const NOW = new Date('2026-10-17T15:00:00Z');
const ORIGINAL =
  'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road.';
const NEWS =
  'The City of Boca Raton said work on Palmetto Park Road will start Nov. 9 instead of Nov. 2.';

let db: Db;
let drop: () => Promise<void>;
let townId: string;
let sourceId: string;

describe('detectors', () => {
  it.each([
    ['Prosecutors dropped the charges against Pat Doe.', true],
    ['The charges against him were dismissed Monday.', true],
    ['The state filed a nolle prosequi.', true],
    ['Officers charged a man with burglary.', false],
    ['The city dropped the fee for permits.', false],
  ])('%s → %s', (text, expected) => {
    expect(mentionsDroppedCharges(text)).toBe(expected);
  });

  const published = [
    {
      id: 'a1',
      headline: 'Council approves paving contract for Palmetto Park Road',
      bodyMd: 'Police arrested Pat Doe on Monday.',
      beat: 'government',
      tier: 2,
      sourceRecordIds: [],
    },
  ];
  it('matches a new record to a published story by headline, or by name for dropped charges', () => {
    expect(
      matchPublished(
        { title: 'Palmetto Park Road paving contract approved by council', text: '' },
        published,
      )?.id,
    ).toBe('a1');
    expect(matchPublished({ title: 'Beach parking rates rise', text: '' }, published)).toBeNull();
    expect(
      matchPublished(
        { title: 'Case update', text: 'Charges against Pat Doe were dropped.' },
        published,
      )?.id,
    ).toBe('a1');
  });

  it('formats the dated update line', () => {
    expect(updateParagraph('Work moves to Nov. 9.', NOW, 'America/New_York')).toBe(
      '**Update, Oct. 17, 2026:** Work moves to Nov. 9.',
    );
  });
});

/** Answers classify, update and fact-check prompts. */
function llmFor(opts: { tier?: 1 | 2 | 3; quote?: string } = {}) {
  const calls: string[] = [];
  const provider: LlmProvider = {
    name: 'replay',
    async generate(request) {
      const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
      const id = request.input.match(/--- Record ([0-9a-f-]{36})/)?.[1] ?? '';
      let value: unknown;
      if (request.system === classifyV1.system) {
        calls.push('classify');
        value = classification({
          proposed_tier: opts.tier ?? 1,
          impact: 0,
          novelty: 0,
          proximity: 0,
        });
      } else if (request.system === updateV1.system) {
        calls.push('update');
        value = { note_md: NEWS, source_record_ids: [id], claims: [] };
      } else if (request.system === factcheckV1.system) {
        calls.push('factcheck');
        value = {
          claims: [
            {
              claim: 'start date',
              record_id: id,
              quote: opts.quote ?? 'will start Nov. 9',
              supported: true,
            },
          ],
          wrong_town_risk: false,
          wrong_town_reason: null,
        } satisfies FactcheckResult;
      }
      return { text: JSON.stringify(value), stop: 'end', model: 'gemini-flash-latest', usage };
    },
  };
  const llm: Llm = { db, provider, providerName: 'gemini', now: () => NOW };
  return { llm, calls };
}

async function record(title: string, text: string) {
  const [row] = await db
    .insert(records)
    .values({
      sourceId,
      townId,
      externalId: `r-${title}-${Math.random()}`,
      type: 'release',
      title,
      text,
      contentHash: text.slice(0, 20),
      occurredAt: NOW,
    })
    .returning();
  return row!;
}

async function publishedStory(recordId: string, tier = 2) {
  const [row] = await db
    .insert(articles)
    .values({
      townId,
      slug: `paving-${Math.random()}`,
      headline: 'Council approves paving contract for Palmetto Park Road',
      bodyMd: ORIGINAL,
      beat: 'government',
      tier,
      status: 'published',
      byline: 'Boca Town Square Newsroom (AI-assisted)',
      sourceRecordIds: [recordId],
      publishedAt: new Date(NOW.getTime() - 86_400_000),
    })
    .returning();
  return row!;
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const loaded = loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton');
  await syncTowns(
    db,
    loaded.map((t) => ({ ...t, config: { ...t.config, sources: [] } })),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
  const [s] = await db
    .insert(sources)
    .values({ townId, kind: 'city_news', platform: 'test', adapter: 'test', key: 'news' })
    .returning();
  sourceId = s!.id;
});
afterAll(async () => drop());
beforeEach(async () => {
  await db.delete(articleLinks);
  await db.delete(articleUpdates);
  await db.delete(skippedCandidates);
  await db.delete(articleScores);
  await db.delete(storyCandidates);
  await db.delete(articles);
  await db.delete(records);
  await db.delete(aiUsage);
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  await db
    .update(towns)
    .set({ config: { ...(town!.config as TownConfig), story_budget: 3 } })
    .where(eq(towns.id, townId));
});

describe('follow-ups end to end', () => {
  it('a new record about a published story becomes a dated update on it', async () => {
    const original = await record('Council approves paving contract', ORIGINAL);
    const article = await publishedStory(original.id);
    const news = await record(
      'Palmetto Park Road paving contract: council approves new start date',
      NEWS,
    );

    const report = await runStoryFinder(db, townId, { now: NOW });
    expect(report).toMatchObject({ updates: 1, candidates: 0 });
    const [candidate] = await db.select().from(storyCandidates);
    expect(candidate).toMatchObject({
      kind: 'update',
      targetArticleId: article.id,
      status: 'accepted',
    });

    const { llm, calls } = llmFor();
    const outcome = await writeCandidate(db, candidate!.id, { llm, now: NOW, random: () => 0.9 });
    expect(outcome).toMatchObject({ status: 'published', articleId: article.id });
    expect(calls).toEqual(['classify', 'update', 'factcheck']);
    const [after] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(after!.bodyMd).toBe(`${ORIGINAL}\n\n**Update, Oct. 17, 2026:** ${NEWS}`);
    expect(after!.sourceRecordIds).toEqual([original.id, news.id]);

    // Nothing new on the next run.
    expect((await runStoryFinder(db, townId, { now: NOW })).updates).toBe(0);
  });

  it('a changed record cited by a published story queues an update', async () => {
    const original = await record('Council approves paving contract', ORIGINAL);
    const article = await publishedStory(original.id);
    await db
      .update(records)
      .set({ text: `${ORIGINAL} ${NEWS}`, contentHash: 'changed', changedAt: NOW })
      .where(eq(records.id, original.id));
    const report = await runStoryFinder(db, townId, { now: NOW });
    expect(report.updates).toBe(1);
    const [candidate] = await db.select().from(storyCandidates);
    expect(candidate).toMatchObject({ kind: 'update', targetArticleId: article.id });
  });

  it('an update that fails fact-check, or is Tier 3, waits for review', async () => {
    const original = await record('Council approves paving contract', ORIGINAL);
    const article = await publishedStory(original.id);
    await record('Palmetto Park Road paving contract: council approves new start date', NEWS);
    await runStoryFinder(db, townId, { now: NOW });
    const [candidate] = await db.select().from(storyCandidates);
    const { llm } = llmFor({ quote: 'starts in December' });
    expect(await writeCandidate(db, candidate!.id, { llm, now: NOW })).toMatchObject({
      status: 'in_review',
      reason: 'factcheck',
    });
    const [update] = await db.select().from(articleUpdates);
    expect(update).toMatchObject({ status: 'in_review', articleId: article.id });
    const [unchanged] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(unchanged!.bodyMd).toBe(ORIGINAL);
  });

  it('dropped charges are always written, whatever the score or budget', async () => {
    await record('Case update', 'Prosecutors dropped the charges against Pat Doe on Friday.');
    const { llm } = llmFor();
    const report = await runStoryFinder(db, townId, { llm, now: NOW });
    // Short text and a zero score would normally skip it.
    expect(report).toMatchObject({ accepted: 1, skipped: {} });
    const [candidate] = await db.select().from(storyCandidates);
    expect(candidate).toMatchObject({ mustWrite: true, status: 'accepted' });
  });
});

describe('linking related stories', () => {
  it('links a new story to earlier coverage of the same subject', async () => {
    const original = await record('Council approves paving contract', ORIGINAL);
    const earlier = await publishedStory(original.id);
    const [newer] = await db
      .insert(articles)
      .values({
        townId,
        slug: 'paving-starts',
        headline: 'Palmetto Park Road paving begins, Acme Paving says',
        bodyMd: 'Acme Paving started work on Palmetto Park Road on Monday.',
        beat: 'government',
        tier: 2,
        status: 'draft',
        byline: '',
      })
      .returning();
    expect(await linkRelatedStories(db, { ...newer!, townId }, NOW)).toEqual([earlier.id]);
    const links = await db.select().from(articleLinks);
    expect(links).toEqual([
      expect.objectContaining({
        fromArticleId: newer!.id,
        toArticleId: earlier.id,
        kind: 'follow_up',
      }),
    ]);
    // Unrelated stories aren't linked.
    expect(
      await linkRelatedStories(
        db,
        {
          id: newer!.id,
          townId,
          headline: 'Library hours change',
          bodyMd: 'The library opens at 9.',
        },
        NOW,
      ),
    ).toEqual([]);
  });
});
