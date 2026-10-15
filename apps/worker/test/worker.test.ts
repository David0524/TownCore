import { eq, workerHeartbeats } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queues } from '../src/queues';
import { startWorker, type RunningWorker } from '../src/worker';

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let worker: RunningWorker;

beforeAll(async () => {
  testDb = await createTestDb();
  worker = await startWorker({
    databaseUrl: testDb.url,
    logger: pino({ level: 'silent' }),
    workerId: 'test-worker',
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
    });
    await expect(second.stop()).resolves.toBeUndefined();
    await expect(second.stop()).resolves.toBeUndefined();
  });
});
