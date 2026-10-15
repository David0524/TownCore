import { hostname } from 'node:os';
import { createDb, type Db } from '@towncore/db';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { recordHeartbeat } from './heartbeat.js';
import { queues, schedules } from './queues.js';

export type WorkerOptions = {
  databaseUrl: string;
  logger: Logger;
  workerId?: string;
};

export type RunningWorker = {
  boss: PgBoss;
  db: Db;
  workerId: string;
  stop: () => Promise<void>;
};

/**
 * Boots pg-boss (which creates and migrates its own `pgboss` schema), creates every queue,
 * registers handlers and cron schedules. pg-boss needs a session-mode Postgres connection.
 */
export async function startWorker({
  databaseUrl,
  logger,
  workerId = `${hostname()}-${process.pid}`,
}: WorkerOptions): Promise<RunningWorker> {
  const startedAt = new Date();
  const db = createDb(databaseUrl, { max: 5 });
  const boss = new PgBoss({ connectionString: databaseUrl, application_name: 'towncore-worker' });
  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));

  await boss.start();
  for (const name of Object.values(queues)) {
    await boss.createQueue(name);
  }

  await boss.work(queues.heartbeat, async (jobs) => {
    await recordHeartbeat(db, workerId, startedAt);
    logger.info({ jobs: jobs.length, workerId }, 'heartbeat');
  });

  for (const { queue, cron } of schedules) {
    await boss.schedule(queue, cron);
  }

  logger.info({ workerId, queues: Object.values(queues) }, 'worker started');

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      logger.info({ workerId }, 'worker stopping');
      await boss.stop({ graceful: true, timeout: 30_000 });
      await db.$client.end();
      logger.info({ workerId }, 'worker stopped');
    })();
    return stopping;
  };

  return { boss, db, workerId, stop };
}
