import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTowns, taskRoutes, type TownConfig } from '@towncore/config';
import {
  aiRequests,
  aiUsage,
  and,
  articles,
  eq,
  getTownBySlug,
  guideSourceKey,
  records,
  sources,
  storyCandidates,
  syncTowns,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import {
  classifyV2,
  discoverV1,
  factcheckV1,
  guideV1,
  writerV1,
  type DiscoverResult,
  type FactcheckResult,
  type GuideDraft,
  type WriterDraft,
} from '@towncore/prompts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stableUuid } from '../src/evals';
import { runStoryFinder } from '../src/finder';
import { createGuideCandidates } from '../src/guides';
import {
  BatchPending,
  callModel,
  recordingProvider,
  replayProvider,
  runAiBatches,
  type Llm,
  type LlmProvider,
  type LlmResponse,
} from '../src/llm';
import { writeCandidate } from '../src/write';
import { classification } from './helpers';

// The whole pipeline on the Claude path, offline (owner, 2026-10-17, model protocol §5): the
// story finder (Haiku classify, with confidence), writer and fact-check (Sonnet), tier router and
// publish; an evergreen guide through the Batch API; and launcher discovery (Opus, web search).
// Responses replay from a recording in the same format as the Gemini eval recordings.
//
// The recording is SYNTHETIC: Claude-format answers written for this test, because no
// ANTHROPIC_API_KEY exists yet. When the key is added, `pnpm evals --live` records real ones.
// After a prompt or input change, delete test/fixtures/llm/claude-synthetic.json and run this
// test once: it records the synthetic answers again.

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/llm/claude-synthetic.json', import.meta.url));
// No recording yet (deleted after a prompt or input change): this run makes it.
const RECORD = !existsSync(FIXTURE);
const NOW = new Date('2026-10-17T15:00:00Z');
const STORY_ID = stableUuid('claude-path:story');
const PAGE_ID = stableUuid('claude-path:bulk-page');
const TEXT =
  'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road. Work begins Nov. 2 and is expected to take six weeks, the city said. The project covers the stretch from Federal Highway to the Intracoastal Waterway bridge. One eastbound lane will close between 9 a.m. and 3 p.m. on weekdays while crews work, and the road will stay open to traffic in both directions at night and on weekends.';
const PAGE =
  'Bulk Item Collection\nBulk items are collected from single-family residences once a week.\nA minimum fee of $161.71 will be charged for items measuring up to 2 cubic yards.\nTo schedule a pickup, please call the Sanitation Department at 561-416-3367.';

/** Claude-format answers by prompt, as the recording was made (synthetic until the key exists). */
function syntheticClaude(): LlmProvider {
  const reply = (value: unknown, model: string, cached: number): LlmResponse => ({
    text: JSON.stringify(value),
    stop: 'end',
    model,
    usage: { inputTokens: 400, outputTokens: 600, cacheReadTokens: cached, cacheWriteTokens: 0 },
    webSearches: 0,
  });
  const story: WriterDraft = {
    headline: 'Council approves paving contract for Palmetto Park Road',
    dek: 'The work begins Nov. 2 and is expected to take six weeks.',
    body_md:
      'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road.\n\nWork begins Nov. 2 and is expected to take six weeks, the city said.',
    beat: 'government',
    source_record_ids: [STORY_ID],
    claims: [{ text: 'The council voted 4-1.', record_id: STORY_ID }],
  };
  const storyCheck: FactcheckResult = {
    claims: [
      { claim: 'vote', record_id: STORY_ID, quote: 'voted 4-1 on Tuesday', supported: true },
      {
        claim: 'contract',
        record_id: STORY_ID,
        quote: 'a $2,500,000 contract with Acme Paving',
        supported: true,
      },
      { claim: 'start', record_id: STORY_ID, quote: 'Work begins Nov. 2', supported: true },
    ],
    wrong_town_risk: false,
    wrong_town_reason: null,
  };
  const guide: GuideDraft = {
    headline: 'How bulk trash pickup works in Boca Raton',
    dek: 'What the city collects, and what a paid pickup costs.',
    body_md:
      '## Collection\nBulk items are collected from single-family residences once a week.\n\n## Paid pickups\nA minimum fee of $161.71 will be charged for items measuring up to 2 cubic yards. Call the Sanitation Department at 561-416-3367.',
    source_record_ids: [PAGE_ID],
    claims: [],
  };
  const guideCheck: FactcheckResult = {
    claims: [
      {
        claim: 'weekly',
        record_id: PAGE_ID,
        quote: 'collected from single-family residences once a week',
        supported: true,
      },
      { claim: 'fee', record_id: PAGE_ID, quote: 'A minimum fee of $161.71', supported: true },
    ],
    wrong_town_risk: false,
    wrong_town_reason: null,
  };
  const discovered: DiscoverResult = {
    sources: [
      {
        kind: 'agenda',
        url: 'https://www.example-city.gov/agendas',
        publisher: 'City of Example',
        why: 'The city clerk posts council agendas here.',
      },
    ],
    outlets: [{ name: 'Example Weekly', url: null, status: 'defunct' }],
  };
  return {
    name: 'anthropic',
    webSearch: true,
    async generate(request) {
      if (request.system === classifyV2.system)
        return reply({ ...classification(), confidence: 0.92 }, 'claude-haiku-5-5', 1200);
      if (request.system === writerV1.system) return reply(story, 'claude-sonnet-5-5', 1800);
      if (request.system === guideV1.system) return reply(guide, 'claude-sonnet-5-5', 1800);
      if (request.system === factcheckV1.system)
        return reply(
          request.input.includes('Bulk') ? guideCheck : storyCheck,
          'claude-sonnet-5-5',
          2000,
        );
      if (request.system === discoverV1.system)
        return { ...reply(discovered, 'claude-opus-5-5', 0), webSearches: 4 };
      throw new Error('No synthetic answer for this prompt');
    },
  };
}

let db: Db;
let drop: () => Promise<void>;
let town: typeof towns.$inferSelect;
let llm: Llm;
let save: (() => void) | undefined;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncTowns(
    db,
    loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton'),
  );
  town = (await getTownBySlug(db, 'boca-raton'))!;
  // Judge on tiers and checks, not the budget (as the evals do).
  await db
    .update(towns)
    .set({ config: { ...(town.config as TownConfig), story_budget: 1000, score_threshold: 0 } })
    .where(eq(towns.id, town.id));
  if (RECORD) {
    const recorder = recordingProvider(syntheticClaude());
    llm = { db, provider: recorder.provider, providerName: 'anthropic', now: () => NOW };
    save = () => recorder.save(FIXTURE);
  } else {
    llm = {
      db,
      provider: replayProvider(FIXTURE, { batch: true }),
      providerName: 'anthropic',
      now: () => NOW,
    };
  }
});
afterAll(async () => {
  save?.();
  await drop();
});

describe('the Claude path, offline', () => {
  it('classifies on Haiku, writes and checks on Sonnet, and publishes a Tier 2 story', async () => {
    const [source] = await db
      .insert(sources)
      .values({ townId: town.id, kind: 'city_news', platform: 'test', adapter: 'test', key: 'cp' })
      .returning();
    await db.insert(records).values({
      id: STORY_ID,
      sourceId: source!.id,
      townId: town.id,
      externalId: 'cp-1',
      type: 'release',
      title: 'Council approves paving contract',
      text: TEXT,
      contentHash: 'cp',
      occurredAt: NOW,
    });
    await runStoryFinder(db, town.id, { llm, now: NOW });
    const [candidate] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.key, `record:${STORY_ID}`));
    expect(candidate).toMatchObject({ status: 'accepted', beat: 'government' });

    const outcome = await writeCandidate(db, candidate!.id, { llm, now: NOW, random: () => 0.5 });
    expect(outcome).toMatchObject({ status: 'published' });
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, (outcome as { articleId: string }).articleId));
    expect(article).toMatchObject({ tier: 2, status: 'published' });

    const used = await db.select().from(aiUsage).where(eq(aiUsage.townId, town.id));
    expect(used.map((u) => [u.task, u.model])).toEqual(
      expect.arrayContaining([
        ['classify', 'claude-haiku-5-5'],
        ['write', 'claude-sonnet-5-5'],
        ['factcheck', 'claude-sonnet-5-5'],
      ]),
    );
    expect(used.every((u) => !u.escalated && u.cacheReadTokens > 0)).toBe(true);
  });

  it('writes an evergreen guide through the Batch API', async () => {
    const [guideSource] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.townId, town.id), eq(sources.key, guideSourceKey('bulk-waste'))));
    await db.insert(records).values({
      id: PAGE_ID,
      sourceId: guideSource!.id,
      townId: town.id,
      externalId: 'page:https://www.myboca.us/684/Bulk-Waste',
      type: 'page',
      title: 'Bulk Waste',
      text: PAGE,
      url: 'https://www.myboca.us/684/Bulk-Waste',
      contentHash: 'bulk',
      raw: { topic: 'bulk-waste' },
    });
    await createGuideCandidates(db, town, NOW);
    const [candidate] = await db
      .select()
      .from(storyCandidates)
      .where(and(eq(storyCandidates.townId, town.id), eq(storyCandidates.kind, 'guide')));

    const write = () => writeCandidate(db, candidate!.id, { llm, now: NOW, random: () => 0.5 });
    if (!RECORD) {
      // Writer, then fact-check: each waits for its batch, picked up on the next run.
      expect(await write()).toMatchObject({ status: 'waiting' });
      expect(await runAiBatches(llm)).toMatchObject({ submitted: 1 });
      expect(await runAiBatches(llm)).toMatchObject({ collected: 1 });
      expect(await write()).toMatchObject({ status: 'waiting' });
      await runAiBatches(llm);
      await runAiBatches(llm);
    }
    // The town's first 30 guides go to review (D-M4-2).
    expect(await write()).toMatchObject({ status: 'in_review' });
    if (!RECORD) {
      const batched = await db.select().from(aiUsage).where(eq(aiUsage.batch, true));
      expect(batched.map((u) => u.task).sort()).toEqual(['guide', 'guide-factcheck']);
      expect(taskRoutes.guide.batch).toBe(true);
      expect(await db.select().from(aiRequests).where(eq(aiRequests.status, 'queued'))).toEqual([]);
    }
  });

  it('runs launcher discovery on Opus with web search', async () => {
    const { value, model } = await callModel(llm, {
      job: 'launch.discover',
      town: { id: town.id, timezone: town.timezone, aiDailyCapUsd: 25, aiDailyCallCap: 50 },
      prompt: discoverV1,
      input: 'Town: Example, FL\nCounty: Example County\nGovernment: City of Example',
    });
    expect(model).toBe('claude-opus-5-5');
    expect(value.sources[0]).toMatchObject({ kind: 'agenda' });
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.task, 'discover'));
    // 4 searches at $0.01 on top of the tokens.
    expect(Number(row!.estCostUsd)).toBeGreaterThan(0.04);
  });

  it('never waits on a batch with nothing queued', () => {
    expect(new BatchPending('guide').message).toMatch(/waiting/);
  });
});
