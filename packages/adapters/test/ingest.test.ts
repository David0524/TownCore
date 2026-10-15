import { fileURLToPath } from 'node:url';
import { loadTowns } from '@towncore/config';
import { eq, getTownBySlug, records, sourceRuns, sources, syncTowns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fetcher, FetchPolicyError } from '../src/http/fetcher';
import { contentHash, ingestSource, listIngestableSources } from '../src/ingest';
import { defaultSchedule, intervalMs, isDue } from '../src/schedule';
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

  it('has platform overrides', () => {
    expect(defaultSchedule('weather', 'nws')).toBe('15m');
    expect(defaultSchedule('business_filings', 'fl-dbpr')).toBe('7d');
    expect(defaultSchedule('events', 'civicplus')).toBe('1h');
  });
});
