import { hostname } from 'node:os';
import { Fetcher } from '@towncore/adapters';
import { createDb, type Db } from '@towncore/db';
import {
  providerFromEnv,
  resolveProviderName,
  type Llm,
  type LlmProvider,
} from '@towncore/pipeline';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { recordHeartbeat } from './heartbeat';
import { enqueueDueSources, runIngestJob, type IngestJob } from './ingest';
import { queues, schedules } from './queues';
import {
  enqueueStoryFinders,
  runStoryFinderJob,
  runWriterJob,
  type StoryFinderJob,
  type WriterJob,
} from './stories';

export type WorkerOptions = {
  databaseUrl: string;
  logger: Logger;
  workerId?: string;
  fetcher?: Fetcher;
  /**
   * Model provider for the pipeline. Default: from the environment (LLM_PROVIDER, or whichever
   * key is set). null runs without a model: candidates wait as pending.
   */
  llmProvider?: { name: Llm['providerName']; provider: LlmProvider } | null;
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
  fetcher = new Fetcher(),
  llmProvider = resolveProviderName() ? providerFromEnv() : null,
}: WorkerOptions): Promise<RunningWorker> {
  const startedAt = new Date();
  const db = createDb(databaseUrl, { max: 5 });
  const llm: Llm | undefined = llmProvider
    ? { db, provider: llmProvider.provider, providerName: llmProvider.name }
    : undefined;
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

  await boss.work(queues.ingestTick, async () => {
    await enqueueDueSources(db, boss, logger);
  });

  await boss.work<IngestJob>(queues.ingest, async (jobs) => {
    for (const job of jobs) await runIngestJob(db, fetcher, logger, job.data);
  });

  await boss.work(queues.storyFinderTick, async () => {
    await enqueueStoryFinders(db, boss, logger);
  });

  await boss.work<StoryFinderJob>(queues.storyFinder, async (jobs) => {
    for (const job of jobs) await runStoryFinderJob(db, boss, llm, logger, job.data);
  });

  // Writer + fact-check + tier router for one candidate (fact-check is a separate model call
  // inside the same job, so a retry never re-publishes half a story).
  await boss.work<WriterJob>(queues.writer, async (jobs) => {
    for (const job of jobs) await runWriterJob(db, llm, logger, job.data);
  });

  for (const { queue, cron } of schedules) {
    await boss.schedule(queue, cron);
  }

  logger.info(
    { workerId, queues: Object.values(queues), llm: llmProvider?.name ?? 'none' },
    'worker started',
  );

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
