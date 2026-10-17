import { NETWORK_AI_DAILY_CAP_USD } from '@towncore/config';
import {
  aiUsage,
  articles,
  placements,
  sources,
  subscribers,
  towns,
  workerHeartbeats,
  businesses,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callModel, SpendCapReached, type LlmProvider } from '../src/llm';
import { evalRegressions, type EvalSummary } from '../src/evals';
import { opsConditions, townHealth } from '../src/ops';

// M8 (docs/plans/M8.md): the operations alerts, the network-wide AI cap, the numbers on
// Admin → Health, and the eval regression check.

const NOW = new Date('2026-10-16T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

let db: Db;
let drop: () => Promise<void>;
let liveId: string;
let draftId: string;

const town = (slug: string, status: 'live' | 'draft' | 'paused', cap = 5) => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status,
  tier: 'small' as const,
  config: { ai_daily_cap_usd: cap, ai_daily_call_cap: 400 },
});
const usage = (townId: string, usd: number, at: Date) => ({
  townId,
  job: 'writer',
  model: 'claude-sonnet-5-5',
  provider: 'anthropic',
  promptVersion: 'writer@v1',
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  estCostUsd: usd.toFixed(6),
  outcome: 'ok',
  createdAt: at,
});
const story = (
  townId: string,
  slug: string,
  at: Date,
  status: 'published' | 'in_review' = 'published',
  pass = true,
) => ({
  townId,
  slug,
  headline: slug,
  bodyMd: 'Body.',
  beat: 'government',
  tier: 2,
  status,
  byline: 'X Newsroom',
  sourceRecordIds: ['00000000-0000-4000-8000-000000000001'],
  factcheck: { decision: pass ? 'pass' : 'review' },
  publishedAt: status === 'published' ? at : null,
  createdAt: at,
  updatedAt: at,
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  const [live] = await db.insert(towns).values(town('livetown', 'live')).returning();
  const [draft] = await db
    .insert(towns)
    .values(town('drafttown', 'draft', 1))
    .returning();
  await db.insert(towns).values(town('pausedtown', 'paused'));
  liveId = live!.id;
  draftId = draft!.id;
});
afterAll(async () => drop());

describe('operations alerts', () => {
  it('names broken sources, caps, cost rises, slow reviews and a silent worker', async () => {
    await db.insert(sources).values([
      {
        townId: liveId,
        key: 'a',
        kind: 'city_news',
        platform: 'civicplus',
        adapter: 'civicplus',
        health: 'broken',
      },
      {
        townId: draftId,
        key: 'b',
        kind: 'agenda',
        platform: 'legistar',
        adapter: 'legistar',
        health: 'broken',
      },
      { townId: liveId, key: 'c', kind: 'weather', platform: 'nws', adapter: 'nws', health: 'ok' },
    ]);
    // The draft town spent its $1 cap today.
    await db.insert(aiUsage).values(usage(draftId, 1.2, hours(2)));
    // Live town: last week 5 stories for $1 ($0.20 each), this week 5 stories for $2 ($0.40).
    for (let i = 0; i < 5; i++) {
      await db.insert(articles).values(story(liveId, `old-${i}`, day(10)));
      await db.insert(articles).values(story(liveId, `new-${i}`, day(2), 'published', i < 3));
    }
    await db.insert(aiUsage).values([usage(liveId, 1, day(10)), usage(liveId, 2, day(2))]);
    // A story waiting two days for review.
    await db.insert(articles).values(story(liveId, 'waiting', day(2), 'in_review'));
    const conditions = await opsConditions(db, NOW);
    const byKey = Object.fromEntries(conditions.map((c) => [c.key.split(':')[0], c]));
    expect(
      conditions
        .filter((c) => c.key.startsWith('source_broken'))
        .map((c) => c.severity)
        .sort(),
    ).toEqual(['critical', 'warning']);
    expect(
      conditions.find((c) => c.severity === 'critical' && c.key.startsWith('source_broken'))!
        .message,
    ).toBe(
      'livetown Square: the city_news source (civicplus) is broken: 3 or more runs failed in a row.',
    );
    expect(byKey.town_cap!.message).toBe(
      'drafttown Square reached its daily AI cap ($1.20 of $1.00, 1 of 400 calls).',
    );
    expect(byKey.cost_per_story!.message).toBe(
      'livetown Square: AI cost per published story is $0.40 this week, up from $0.20 (more than 50%).',
    );
    expect(byKey.review_waiting!.message).toBe(
      '1 story has waited in review for more than 24 hours.',
    );
    expect(byKey.worker_stale).toMatchObject({
      severity: 'critical',
      message: 'No worker has ever reported a heartbeat.',
    });
    expect(byKey.network_cap).toBeUndefined();

    await db.insert(workerHeartbeats).values({
      workerId: 'w1',
      startedAt: hours(1),
      lastBeatAt: new Date(NOW.getTime() - 60_000),
    });
    expect((await opsConditions(db, NOW)).some((c) => c.key === 'worker_stale')).toBe(false);
  });

  it('stops every model call at the network-wide cap and says so', async () => {
    let called = 0;
    const provider: LlmProvider = {
      name: 'anthropic',
      async generate() {
        called++;
        return {
          text: '{}',
          stop: 'end',
          model: 'claude-haiku-5-5',
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        };
      },
    };
    const [paused] = await db
      .insert(towns)
      .values(town('spare', 'draft', 100))
      .returning();
    // Another town's spending reaches the network cap; this town's own cap is far away.
    await db.insert(aiUsage).values(usage(paused!.id, NETWORK_AI_DAILY_CAP_USD, hours(1)));
    await expect(
      callModel(
        { db, provider, providerName: 'anthropic', now: () => NOW },
        {
          job: 'x',
          town: {
            id: paused!.id,
            timezone: 'America/New_York',
            aiDailyCapUsd: 100,
            aiDailyCallCap: 400,
          },
          prompt: {
            id: 'p',
            version: 'v1',
            task: 'classify',
            system: 's',
            schema: z.object({}),
          },
          input: 'i',
        },
      ),
    ).rejects.toThrow(SpendCapReached);
    expect(called).toBe(0);
    const network = (await opsConditions(db, NOW)).find((c) => c.key === 'network_cap');
    expect(network).toMatchObject({ severity: 'critical' });
  });
});

describe('Admin → Health numbers', () => {
  it('summarizes each town that is not paused', async () => {
    const [biz] = await db
      .insert(businesses)
      .values({
        townId: liveId,
        slug: 'shop',
        name: 'Shop',
        category: 'restaurants',
        licenseVerified: true,
        dataSource: 'test',
        active: true,
      })
      .returning();
    await db
      .insert(placements)
      .values({ businessId: biz!.id, townId: liveId, product: 'enhanced', status: 'active' });
    await db.insert(subscribers).values({
      townId: liveId,
      email: 'a@example.com',
      status: 'active',
      consentAt: NOW,
      consentSource: 'test',
      confirmedAt: NOW,
    });
    const rows = await townHealth(db, NOW);
    expect(rows.map((r) => r.siteName)).toEqual([
      'drafttown Square',
      'livetown Square',
      'spare Square',
    ]);
    const live = rows.find((r) => r.id === liveId)!;
    expect(live).toMatchObject({
      itemsPerDay: 0.7,
      review: { waiting: 1, oldestHours: 48 },
      corrections30d: 0,
      sources: { ok: 1, degraded: 0, broken: ['city_news (civicplus)'] },
      subscribers: 1,
      payingBusinesses: 1,
    });
    // Of the 6 stories written this week (5 published, 1 waiting), 4 passed fact-check first time.
    expect(live.factcheckPassRate).toBeCloseTo(4 / 6);
    expect(live.ai.perStoryUsd).toBeCloseTo(0.4);
  });
});

describe('eval regressions (CLAUDE.md §12)', () => {
  const summary = (over: Partial<EvalSummary> = {}, unsupported = 1): EvalSummary => ({
    cases: 20,
    passed: 20,
    safetyFailures: 0,
    factcheckPassRate: 0.5,
    verbatimQuoteRate: 0.97,
    results: [
      {
        id: 'a',
        skip: null,
        tier: 2,
        status: 'published',
        factcheckScore: 1,
        claims: 10,
        verbatimClaims: 10 - unsupported,
        failures: [],
      },
    ],
    ...over,
  });
  it('flags a lower pass rate, more unsupported claims and safety failures', () => {
    expect(evalRegressions(summary(), summary())).toEqual([]);
    expect(evalRegressions(summary(), summary({ factcheckPassRate: 0.6 }, 0))).toEqual([]);
    expect(
      evalRegressions(
        summary(),
        summary({ factcheckPassRate: 0.45, safetyFailures: 1, passed: 19 }, 3),
      ),
    ).toEqual([
      'safety failures rose from 0 to 1',
      'fact-check pass rate fell from 50% to 45%',
      'unsupported claims rose from 1 to 3',
      'cases passing fell from 20 to 19',
    ]);
  });
});
