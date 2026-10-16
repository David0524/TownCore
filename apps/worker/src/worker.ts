import { hostname } from 'node:os';
import { Fetcher } from '@towncore/adapters';
import { createDb, type Db } from '@towncore/db';
import { runNewsletterTick } from '@towncore/email';
import type { IdentityProvider } from '@towncore/mail';
import {
  providerFromEnv,
  resolveProviderName,
  type Llm,
  type LlmProvider,
} from '@towncore/pipeline';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { recordHeartbeat } from './heartbeat';
import {
  bulkFromEnv,
  inboundFromEnv,
  opsFromEnv,
  runBulkHealth,
  runMailTick,
  sesFromEnv,
  startBulkLoop,
  startInboundLoop,
  type InboundConfig,
} from './mail';
import { enqueueDueSources, runIngestJob, type IngestJob } from './ingest';
import { refreshWeather } from './weather';
import { geocodeDirectory, refreshDirectory, sendProofReports } from './directory';
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
  /** SES (read-only use) for mail domain checks. Default: from AWS env; null skips them. */
  ses?: IdentityProvider | null;
  /** Raw mail bucket for inbound processing. Default: from AWS env; null turns it off. */
  inbound?: InboundConfig | null;
  /** Bulk sending. Default: from the environment; false turns it off. */
  bulk?: boolean;
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
  ses = sesFromEnv(),
  inbound = inboundFromEnv(),
  bulk = true,
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

  await boss.work(queues.mailTick, async () => {
    await runMailTick(db, ses, logger);
  });

  const opsDeps = opsFromEnv();
  await boss.work(queues.bulkHealth, async () => {
    await runBulkHealth(db, logger, new Date(), opsDeps);
  });

  await boss.work(queues.weather, async () => {
    await refreshWeather(db, fetcher, logger);
  });

  await boss.work(queues.directorySeed, async () => {
    await refreshDirectory(db, logger);
  });

  await boss.work(queues.directoryGeocode, async () => {
    await geocodeDirectory(db, fetcher, logger);
  });

  await boss.work(queues.proofReports, async () => {
    await sendProofReports(db, opsDeps.alertMail, logger);
  });

  // The daily newsletter (M5): test list or every subscriber, once per town and local date.
  const newsletterDeps = bulk ? bulkFromEnv(db) : null;
  await boss.work(queues.newsletter, async () => {
    if (!newsletterDeps) return;
    for (const result of await runNewsletterTick(newsletterDeps)) {
      if (result.outcome !== 'waiting' && result.outcome !== 'exists')
        logger.info(result, 'newsletter issue');
    }
  });

  for (const { queue, cron } of schedules) {
    await boss.schedule(queue, cron);
  }

  // Inbound mail: the webhook stores SNS notifications in mail_events; this drains them.
  const stopInbound = startInboundLoop(db, inbound, logger);
  // Newsletters and campaigns (Mail-5).
  const stopBulk = startBulkLoop(newsletterDeps, logger);

  logger.info(
    { workerId, queues: Object.values(queues), llm: llmProvider?.name ?? 'none' },
    'worker started',
  );

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      logger.info({ workerId }, 'worker stopping');
      await stopInbound();
      await stopBulk();
      await boss.stop({ graceful: true, timeout: 30_000 });
      await db.$client.end();
      logger.info({ workerId }, 'worker stopped');
    })();
    return stopping;
  };

  return { boss, db, workerId, stop };
}
