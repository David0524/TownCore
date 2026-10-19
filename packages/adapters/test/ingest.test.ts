import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { eq, getTownBySlug, records, sourceRuns, sources, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flDbprAdapter } from '../src/fl-dbpr';
import { Fetcher, FetchPolicyError, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { contentHash, ingestSource, listIngestableSources } from '../src/ingest';
import {
  defaultSchedule,
  intervalMs,
  isDue,
  isPolicyRefusal,
  retryIntervalMs,
} from '../src/schedule';
import type { RawRecord, SourceAdapter } from '../src/types';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));

/** A test adapter whose next result is set per test. */
function fakeAdapter() {
  let next: () => Promise<RawRecord[]> = async () => [];
  const adapter: SourceAdapter = {
    platform: 'fake',
    kinds: ['events'],
    detect: async () => 0,
    fetch: () => next(),
    healthCheck: async () => ({ ok: true }),
  };
  return {
    adapter,
    returns: (items: RawRecord[]) => (next = async () => items),
    throws: (e: Error) =>
      (next = async () => {
        throw e;
      }),
  };
}

const item = (id: string, title = `Item ${id}`): RawRecord => ({
  externalId: id,
  type: 'event',
  title,
  raw: { id },
});

let db: Db;
let drop: () => Promise<void>;
let townId: string;
const fetcher = new Fetcher({ fetchImpl: async () => new Response('', { status: 404 }) });

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncTowns(db, loadTowns(townsDir));
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
});
afterAll(async () => drop());

async function newSource() {
  const [row] = await db
    .insert(sources)
    .values({
      townId,
      kind: 'events',
      platform: 'fake',
      adapter: 'fake',
      key: `events:fake:${Math.random()}`,
    })
    .returning();
  return row!;
}
const reload = async (id: string) =>
  (await db.select().from(sources).where(eq(sources.id, id)))[0]!;

describe('ingestSource', () => {
  let fake: ReturnType<typeof fakeAdapter>;
  beforeEach(() => {
    fake = fakeAdapter();
  });

  it('inserts new records, skips unchanged ones and updates changed ones', async () => {
    const source = await newSource();
    fake.returns([item('a'), item('b')]);
    expect(await ingestSource(db, source, fake.adapter, fetcher)).toMatchObject({
      status: 'ok',
      newItems: 2,
      changedItems: 0,
    });

    fake.returns([item('a'), item('b', 'Item b (updated)'), item('c')]);
    expect(await ingestSource(db, await reload(source.id), fake.adapter, fetcher)).toMatchObject({
      items: 3,
      newItems: 1,
      changedItems: 1,
    });

    const rows = await db.select().from(records).where(eq(records.sourceId, source.id));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.externalId === 'b')).toMatchObject({ title: 'Item b (updated)' });
    expect(rows.find((r) => r.externalId === 'b')!.changedAt).not.toBeNull();
    expect(rows.find((r) => r.externalId === 'a')!.changedAt).toBeNull();

    const after = await reload(source.id);
    expect(after).toMatchObject({ health: 'ok', consecutiveFailures: 0, lastError: null });
    expect(after.lastOkAt).not.toBeNull();
    const runs = await db.select().from(sourceRuns).where(eq(sourceRuns.sourceId, source.id));
    expect(runs.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('dedupes repeated external IDs within one fetch', async () => {
    const source = await newSource();
    fake.returns([item('x', 'first'), item('x', 'second')]);
    expect(await ingestSource(db, source, fake.adapter, fetcher)).toMatchObject({ newItems: 1 });
  });

  it('dates undated items when first seen, but not on the first run, and keeps that date', async () => {
    const source = await newSource();
    const sighted = (id: string, text: string): RawRecord => ({
      ...item(id),
      text,
      datedOnSight: true,
    });
    const first = new Date('2026-10-05T12:00:00Z');
    const second = new Date('2026-10-12T12:00:00Z');
    fake.returns([sighted('old', 'Stage: Proposed')]);
    await ingestSource(db, source, fake.adapter, fetcher, first);
    fake.returns([sighted('old', 'Stage: Proposed (edited)'), sighted('new', 'Stage: Approved')]);
    await ingestSource(db, await reload(source.id), fake.adapter, fetcher, second);
    fake.returns([sighted('new', 'Stage: Approved (edited)')]);
    await ingestSource(db, await reload(source.id), fake.adapter, fetcher, new Date());

    const rows = await db.select().from(records).where(eq(records.sourceId, source.id));
    // What was there on the first run is the baseline, not news; an edit doesn't date it.
    expect(rows.find((r) => r.externalId === 'old')).toMatchObject({ occurredAt: null });
    expect(rows.find((r) => r.externalId === 'new')).toMatchObject({
      occurredAt: second,
      text: 'Stage: Approved (edited)',
    });
  });

  it('goes degraded on a failure and broken after 3 in a row, then recovers', async () => {
    const source = await newSource();
    fake.throws(new Error('HTTP 500'));
    for (const expected of ['degraded', 'degraded', 'broken']) {
      const result = await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
      expect(result).toMatchObject({ status: 'failed', error: 'HTTP 500' });
      expect((await reload(source.id)).health).toBe(expected);
    }
    fake.returns([item('ok')]);
    await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
    expect(await reload(source.id)).toMatchObject({ health: 'ok', consecutiveFailures: 0 });
  });

  it('marks a robots.txt or never-scrape refusal broken immediately', async () => {
    const source = await newSource();
    fake.throws(new FetchPolicyError('Refusing to fetch x: disallowed by robots.txt'));
    await ingestSource(db, source, fake.adapter, fetcher);
    expect(await reload(source.id)).toMatchObject({
      health: 'broken',
      lastError: expect.stringMatching(/robots/),
    });
    // Retried weekly; one good run puts it back to ok and its normal schedule.
    expect(retryIntervalMs({ ...(await reload(source.id)), kind: 'events' })).toBe(7 * 86_400_000);
    fake.returns([item('back')]);
    await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
    expect(await reload(source.id)).toMatchObject({
      health: 'ok',
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it('goes degraded when a source that usually has items returns none', async () => {
    const source = await newSource();
    for (let i = 0; i < 3; i++) {
      fake.returns([item(`r${i}`)]);
      await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
    }
    fake.returns([]);
    await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
    expect(await reload(source.id)).toMatchObject({
      health: 'degraded',
      lastError: expect.stringMatching(/no items/),
    });
  });

  it('lists sources of towns that are not paused', async () => {
    const all = await listIngestableSources(db);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.townId === townId)).toBe(true);
  });
});

describe('contentHash', () => {
  it('changes when content changes and ignores raw payload noise', () => {
    expect(contentHash(item('a'))).toBe(contentHash({ ...item('a'), raw: { other: true } }));
    expect(contentHash(item('a'))).not.toBe(contentHash(item('a', 'different')));
  });
});

describe('schedules', () => {
  it('parses intervals', () => {
    expect(intervalMs('15m')).toBe(900_000);
    expect(intervalMs('3h')).toBe(10_800_000);
    expect(intervalMs('7d')).toBe(604_800_000);
    expect(() => intervalMs('weekly')).toThrow();
  });

  it('decides when a source is due', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const base = { kind: 'weather' as const, platform: 'nws', schedule: '3h' };
    expect(isDue({ ...base, lastRunAt: null }, now)).toBe(true);
    expect(isDue({ ...base, lastRunAt: new Date('2026-10-15T10:00:00Z') }, now)).toBe(false);
    expect(isDue({ ...base, lastRunAt: new Date('2026-10-15T08:59:00Z') }, now)).toBe(true);
    expect(
      isDue({ ...base, schedule: '15m', lastRunAt: new Date('2026-10-15T11:40:00Z') }, now),
    ).toBe(true);
  });

  it('backs off a broken source: 6 h, 12 h, then daily, never faster than its schedule', () => {
    const H = 3_600_000;
    const base = { kind: 'events' as const, platform: 'fake', schedule: '1h', health: 'broken' };
    expect(retryIntervalMs({ ...base, consecutiveFailures: 3, lastError: 'HTTP 500' })).toBe(6 * H);
    expect(retryIntervalMs({ ...base, consecutiveFailures: 4, lastError: 'HTTP 500' })).toBe(
      12 * H,
    );
    expect(retryIntervalMs({ ...base, consecutiveFailures: 5, lastError: 'HTTP 500' })).toBe(
      24 * H,
    );
    expect(retryIntervalMs({ ...base, consecutiveFailures: 40, lastError: 'HTTP 500' })).toBe(
      24 * H,
    );
    // A weekly source keeps its weekly schedule when broken.
    expect(
      retryIntervalMs({ ...base, schedule: '7d', consecutiveFailures: 3, lastError: 'x' }),
    ).toBe(7 * 24 * H);
    // Degraded and healthy sources keep their normal schedule.
    expect(retryIntervalMs({ ...base, health: 'degraded', consecutiveFailures: 2 })).toBe(H);
    expect(retryIntervalMs({ ...base, health: 'ok' })).toBe(H);

    const now = new Date('2026-10-15T12:00:00Z');
    const ago = (h: number) => new Date(now.getTime() - h * H);
    const broken = { ...base, consecutiveFailures: 3, lastError: 'HTTP 500' };
    expect(isDue({ ...broken, lastRunAt: ago(2) }, now)).toBe(false);
    expect(isDue({ ...broken, lastRunAt: ago(6) }, now)).toBe(true);
  });

  it('retries a robots.txt or never-scrape refusal weekly', () => {
    const lastError = 'Refusing to fetch https://x.example/: disallowed by robots.txt';
    expect(isPolicyRefusal(lastError)).toBe(true);
    expect(isPolicyRefusal('Refusing to POST to https://x/: not a documented API')).toBe(true);
    expect(isPolicyRefusal('HTTP 403')).toBe(false);
    expect(isPolicyRefusal(null)).toBe(false);
    const source = {
      kind: 'agenda' as const,
      platform: 'civicplus',
      schedule: null,
      health: 'broken',
      consecutiveFailures: 1,
      lastError,
    };
    expect(retryIntervalMs(source)).toBe(7 * 86_400_000);
    const now = new Date('2026-10-15T12:00:00Z');
    expect(isDue({ ...source, lastRunAt: new Date('2026-10-10T12:00:00Z') }, now)).toBe(false);
    expect(isDue({ ...source, lastRunAt: new Date('2026-10-08T12:00:00Z') }, now)).toBe(true);
  });

  it('has platform overrides', () => {
    expect(defaultSchedule('weather', 'nws')).toBe('15m');
    expect(defaultSchedule('business_filings', 'fl-dbpr')).toBe('7d');
    expect(defaultSchedule('events', 'civicplus')).toBe('1h');
  });
});

describe('NotModified', () => {
  it('counts as a healthy run with no items, never as degraded', async () => {
    const { NotModified } = await import('../src/http/fetcher');
    const fake = fakeAdapter();
    const source = await newSource();
    for (let i = 0; i < 3; i++) {
      fake.returns([item(`n${i}`)]);
      await ingestSource(db, await reload(source.id), fake.adapter, fetcher);
    }
    fake.throws(new NotModified('unchanged'));
    expect(await ingestSource(db, await reload(source.id), fake.adapter, fetcher)).toMatchObject({
      status: 'ok',
      items: 0,
    });
    expect(await reload(source.id)).toMatchObject({ health: 'ok', lastError: null });
  });
});

describe('statewide files shared across towns (rollout Phase 1)', () => {
  it('downloads once, and each source gets its own run, records and health', async () => {
    const fixture = fileURLToPath(new URL('../fixtures/fl-dbpr/boca.json', import.meta.url));
    const requests: string[] = [];
    const replay = replayFetch(fixture);
    const fetchImpl: FetchFn = async (url, init) => {
      if (!url.endsWith('robots.txt')) requests.push(url);
      return replay(url, init);
    };
    const shared = new Fetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    const make = async (city: string) => {
      const [row] = await db
        .insert(sources)
        .values({
          townId,
          kind: 'business_filings',
          platform: 'fl-dbpr',
          adapter: 'fl-dbpr',
          key: `business_filings:fl-dbpr:${city}`,
          config: { city },
        })
        .returning();
      return row!;
    };
    const boca = await make('BOCA RATON');
    const jax = await make('JACKSONVILLE');
    const now = new Date('2026-10-16T12:00:00Z');
    const a = await ingestSource(db, boca, flDbprAdapter, shared, now);
    const b = await ingestSource(db, jax, flDbprAdapter, shared, now);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    // Two files, each downloaded once for both sources.
    expect(requests).toHaveLength(2);
    for (const s of [boca, jax]) {
      const [row] = await db.select().from(sources).where(eq(sources.id, s.id));
      expect(row!.health).toBe('ok');
      expect(await db.select().from(sourceRuns).where(eq(sourceRuns.sourceId, s.id))).toHaveLength(
        1,
      );
    }
    const jaxRecords = await db.select().from(records).where(eq(records.sourceId, jax.id));
    expect(jaxRecords.length).toBe(b.newItems);
    expect(jaxRecords.every((r) => /JACKSONVILLE/.test(r.text ?? ''))).toBe(true);
  });
});
