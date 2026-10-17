import { hostname } from 'node:os';
import { Fetcher } from '@towncore/adapters';
import { createDb, type Db } from '@towncore/db';
import { runNewsletterTick } from '@towncore/email';
import type { IdentityProvider } from '@towncore/mail';
import { loadEnv } from '@towncore/config';
import {
  autopostFacebook,
  checkSites,
  parseCheckUrls,
  providerFromEnv,
  queueFacebookPosts,
  resolveProviderName,
  runAiBatches,
  type Llm,
  type LlmProvider,
} from '@towncore/pipeline';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { runAdapterFixes, runCohorts, runDigest, runDiscovery, runLearning } from './agents';
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
import { drawMaps, refreshBasemaps } from './maps';
import { drawStockPhotos, unsplashFromEnv } from './photos';
import { refreshTropics, refreshWeather } from './weather';
import {
  geocodeDirectory,
  recalculatePrices,
  refreshDirectory,
  runFollowups,
  sendProofReports,
} from './directory';
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

  await boss.work(queues.aiBatches, async () => {
    if (!llm) return;
    const batches = await runAiBatches(llm);
    if (batches.submitted || batches.collected || batches.failed)
      logger.info(batches, 'ai batches');
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

  await boss.work(queues.tropics, async () => {
    await refreshTropics(db, fetcher, logger);
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

  await boss.work(queues.followups, async () => {
    await runFollowups(db, opsDeps.alertMail, logger);
  });

  await boss.work(queues.pricing, async () => {
    await recalculatePrices(db, logger);
  });

  await boss.work(queues.basemaps, async () => {
    await refreshBasemaps(db, logger);
  });

  await boss.work(queues.maps, async () => {
    await drawMaps(db, fetcher, logger);
  });

  const unsplash = unsplashFromEnv();
  await boss.work(queues.photos, async () => {
    await drawStockPhotos(db, fetcher, unsplash, logger);
  });

  // Facebook (owner, 2026-10-17): queue each live town's posts. Posting waits for staff, unless
  // the owner has granted a standing approval (FACEBOOK_AUTOPOST=on).
  await boss.work(queues.facebook, async () => {
    const queued = await queueFacebookPosts(db);
    const posted = await autopostFacebook(db);
    if (queued || posted) logger.info({ queued, posted }, 'facebook posts');
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

  // Agentic operations (docs/plans/agentic-ops.md): each prepares a decision for a person.
  await boss.work(queues.cohorts, async () => {
    await runCohorts(db, fetcher, llm, logger);
  });
  await boss.work(queues.sourceDiscovery, async () => {
    await runDiscovery(db, fetcher, llm, logger);
  });
  await boss.work(queues.adapterFixes, async () => {
    await runAdapterFixes(db, fetcher, logger);
  });
  await boss.work(queues.learning, async () => {
    await runLearning(db, logger);
  });
  await boss.work(queues.digest, async () => {
    await runDigest(db, opsDeps.alertMail, logger);
  });

  // Uptime (Admin → Analytics): every live site's /api/health; a site down twice in a row alerts.
  const previews = parseCheckUrls(loadEnv().SITE_CHECK_URLS);
  await boss.work(queues.siteChecks, async () => {
    const results = await checkSites(db, { previews });
    const down = results.filter((r) => !r.ok);
    if (down.length) logger.warn({ down: down.map((r) => `${r.slug}: ${r.error}`) }, 'site checks');
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
