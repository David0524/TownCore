import { eq, workerHeartbeats } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { Fetcher } from '@towncore/adapters';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queues } from '../src/queues';
import { startWorker, type RunningWorker } from '../src/worker';

let testDb: Awaited<ReturnType<typeof createTestDb>>;

// Tests never touch the network: any real fetch fails loudly.
const offlineFetcher = () =>
  new Fetcher({
    fetchImpl: async (url) => {
      throw new Error(`Network disabled in tests (${url})`);
    },
  });
let worker: RunningWorker;

beforeAll(async () => {
  testDb = await createTestDb();
  worker = await startWorker({
    databaseUrl: testDb.url,
    logger: pino({ level: 'silent' }),
    workerId: 'test-worker',
    fetcher: offlineFetcher(),
    llmProvider: null,
  });
});

afterAll(async () => {
  await worker?.stop();
  await testDb?.drop();
});

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out');
}

describe('worker', () => {
  it('creates every pipeline queue', async () => {
    for (const name of Object.values(queues)) {
      expect(await worker.boss.getQueue(name), name).not.toBeNull();
    }
  });

  it('schedules the heartbeat every minute', async () => {
    const [schedule] = await worker.boss.getSchedules(queues.heartbeat);
    expect(schedule).toMatchObject({ name: queues.heartbeat, cron: '* * * * *' });
  });

  it('processes a heartbeat job and records it', async () => {
    await worker.boss.send(queues.heartbeat);
    const beat = await waitFor(async () => {
      const [row] = await testDb.db
        .select()
        .from(workerHeartbeats)
        .where(eq(workerHeartbeats.workerId, 'test-worker'));
      return row;
    });
    expect(beat.lastBeatAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('can restart against an existing pg-boss schema and stops cleanly', async () => {
    const second = await startWorker({
      databaseUrl: testDb.url,
      logger: pino({ level: 'silent' }),
      workerId: 'second-worker',
      fetcher: offlineFetcher(),
      llmProvider: null,
    });
    await expect(second.stop()).resolves.toBeUndefined();
    await expect(second.stop()).resolves.toBeUndefined();
  });
});

describe('ingest', () => {
  it('a tick enqueues due sources and the ingest job stores their records', async () => {
    const { registerAdapter } = await import('@towncore/adapters');
    const { getTownBySlug, records, sources, syncTowns } = await import('@towncore/db');
    const { loadTowns } = await import('@towncore/config');
    const { fileURLToPath } = await import('node:url');

    registerAdapter({
      platform: 'worker-test',
      kinds: ['events'],
      detect: async () => 0,
      fetch: async () => [{ externalId: 'e1', type: 'event', title: 'Test event', raw: {} }],
      healthCheck: async () => ({ ok: true }),
    });
    // Boca's config without its real sources, so the tick only finds the test source.
    const loaded = loadTowns(fileURLToPath(new URL('../../../towns', import.meta.url))).map(
      (t) => ({
        ...t,
        config: { ...t.config, sources: [] },
      }),
    );
    await syncTowns(testDb.db, loaded);
    const town = await getTownBySlug(testDb.db, 'boca-raton');
    const [source] = await testDb.db
      .insert(sources)
      .values({
        townId: town!.id,
        kind: 'events',
        platform: 'worker-test',
        adapter: 'worker-test',
        key: 'worker-test',
      })
      .returning();

    await worker.boss.send(queues.ingestTick);
    const stored = await waitFor(async () => {
      const rows = await testDb.db.select().from(records).where(eq(records.sourceId, source!.id));
      return rows.length > 0 ? rows : undefined;
    });
    expect(stored[0]).toMatchObject({ externalId: 'e1', title: 'Test event' });
    const [after] = await testDb.db.select().from(sources).where(eq(sources.id, source!.id));
    expect(after).toMatchObject({ health: 'ok' });
  });
});

describe('story finder', () => {
  it('a tick runs the finder per town; templated items need no model', async () => {
    const { getTownBySlug, records, sources, storyCandidates } = await import('@towncore/db');
    const town = await getTownBySlug(testDb.db, 'boca-raton');
    const [source] = await testDb.db
      .insert(sources)
      .values({ townId: town!.id, kind: 'weather', platform: 'nws', adapter: 'nws', key: 'wx' })
      .returning();
    await testDb.db.insert(records).values({
      sourceId: source!.id,
      townId: town!.id,
      externalId: 'alert-1',
      type: 'alert',
      title: 'Flood Watch',
      contentHash: 'h',
      occurredAt: new Date(),
      raw: { severity: 'Moderate', event: 'Flood Watch' },
    });

    await worker.boss.send(queues.storyFinderTick);
    const candidate = await waitFor(async () => {
      const [row] = await testDb.db
        .select()
        .from(storyCandidates)
        .where(eq(storyCandidates.townId, town!.id));
      return row;
    });
    expect(candidate).toMatchObject({ kind: 'template', status: 'accepted', title: 'Flood Watch' });
  });
});
