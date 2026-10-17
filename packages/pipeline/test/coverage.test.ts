import {
  articles,
  eq,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storyCoverage } from '../src/coverage';

// Stories against the Rule 7 target: items a day by source kind, skips by reason, the gap and
// the source kinds still to build, furthest-behind town first.

const NOW = new Date('2026-10-17T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let db: Db;
let drop: () => Promise<void>;

const town = (slug: string, tier: 'small' | 'large', status: 'live' | 'paused' = 'live') => ({
  slug,
  name: slug,
  state: 'ZZ',
  county: 'Sample',
  timezone: 'America/New_York',
  domain: `${slug}.test`,
  siteName: `${slug} Square`,
  status,
  tier,
  config: {},
});

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

describe('story coverage', () => {
  it('counts published stories by source kind against the target and lists what to build', async () => {
    const [small] = await db.insert(towns).values(town('smallville', 'small')).returning();
    const [big] = await db.insert(towns).values(town('bigcity', 'large')).returning();
    await db.insert(towns).values(town('pausedville', 'large', 'paused'));
    await db.update(towns).set({ readinessScore: 0.8 }).where(eq(towns.id, big!.id));
    const source = async (townId: string, kind: 'agenda' | 'city_news' | 'police', key: string) => {
      const [s] = await db
        .insert(sources)
        .values({ townId, key, kind, platform: 'x', adapter: 'x', health: 'ok' })
        .returning();
      return s!;
    };
    const record = async (townId: string, sourceId: string, id: string) => {
      const [r] = await db
        .insert(records)
        .values({ townId, sourceId, externalId: id, type: 'release', title: id, contentHash: id })
        .returning();
      return r!;
    };
    const news = await source(small!.id, 'city_news', 's-news');
    const meetings = await source(small!.id, 'agenda', 's-agenda');
    let n = 0;
    const story = async (townId: string, recordId: string, at: Date, kind = 'story') =>
      db.insert(articles).values({
        townId,
        slug: `a-${n++}`,
        headline: 'H',
        bodyMd: 'Body.',
        beat: 'government',
        tier: 1,
        status: 'published',
        kind: kind as 'story',
        byline: 'X Newsroom',
        sourceRecordIds: [recordId],
        publishedAt: at,
      });
    // 45 city releases and 15 meeting recaps in 30 days: 1.5 + 0.5 = 2 a day, 1 short of 3.
    for (let i = 0; i < 45; i++) {
      const r = await record(small!.id, news.id, `n${i}`);
      await story(small!.id, r.id, day(1 + (i % 29)));
    }
    for (let i = 0; i < 15; i++) {
      const r = await record(small!.id, meetings.id, `m${i}`);
      await story(small!.id, r.id, day(2));
    }
    // Older than the window, and a guide: neither counts.
    const old = await record(small!.id, news.id, 'old');
    await story(small!.id, old.id, day(40));
    const guideRecord = await record(small!.id, news.id, 'guide');
    await story(small!.id, guideRecord.id, day(3), 'guide');
    // Two thin releases and one duplicate skipped this month.
    for (const [i, reason] of (['thin_source', 'thin_source', 'duplicate'] as const).entries()) {
      const [c] = await db
        .insert(storyCandidates)
        .values({
          townId: small!.id,
          recordIds: [],
          beat: 'government',
          proposedTier: 1,
          key: `c${i}`,
          status: 'skipped',
        })
        .returning();
      await db.insert(skippedCandidates).values({ candidateId: c!.id, reason, createdAt: day(5) });
    }
    await source(big!.id, 'police', 'b-police');

    const rows = await storyCoverage(db, NOW);
    expect(rows.map((r) => [r.siteName, r.perDay, r.target, r.gap])).toEqual([
      ['bigcity Square', 0, 10, 10],
      ['smallville Square', 2, 3, 1],
    ]);
    const smallRow = rows[1]!;
    expect(smallRow.bySource).toEqual([
      { kind: 'city_news', perDay: 1.5 },
      { kind: 'agenda', perDay: 0.5 },
    ]);
    expect(smallRow.skipped).toEqual([
      { reason: 'thin_source', count: 2 },
      { reason: 'duplicate', count: 1 },
    ]);
    expect(smallRow.missing.slice(0, 3)).toEqual(['permits', 'police', 'fire']);
    expect(smallRow.missing).not.toContain('agenda');
    expect(rows[0]!.missing).not.toContain('police');
    expect(rows[0]!.readiness).toBe(0.8);
  });
});
