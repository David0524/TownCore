import {
  Fetcher,
  getAdapter,
  ingestSource,
  isDue,
  listIngestableSources,
  missingEnv,
  type IngestResult,
} from '@towncore/adapters';
import type { SourceKind } from '@towncore/config';
import { eq, sources, type Db } from '@towncore/db';
import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { queues } from './queues';

export type IngestJob = { sourceId: string };

/** Enqueues one ingest job per due source. Singleton keys stop a source running twice at once. */
export async function enqueueDueSources(db: Db, boss: PgBoss, logger: Logger, now = new Date()) {
  const due = (await listIngestableSources(db)).filter((source) =>
    isDue({ ...source, kind: source.kind as SourceKind }, now),
  );
  let queued = 0;
  for (const source of due) {
    if (!getAdapter(source.adapter)) {
      logger.warn(
        { sourceId: source.id, adapter: source.adapter },
        'no adapter registered; skipping',
      );
      continue;
    }
    const missing = missingEnv(getAdapter(source.adapter)!);
    if (missing.length > 0) {
      logger.info(
        { sourceId: source.id, missing },
        'source needs an API key that is not set; skipping',
      );
      continue;
    }
    const id = await boss.send(queues.ingest, { sourceId: source.id } satisfies IngestJob, {
      singletonKey: source.id,
    });
    if (id) queued++;
  }
  logger.info({ due: due.length, queued }, 'ingest tick');
  return queued;
}

/** One shared Fetcher per worker, so the 1 request/second per host limit holds across jobs. */
export async function runIngestJob(
  db: Db,
  fetcher: Fetcher,
  logger: Logger,
  job: IngestJob,
): Promise<IngestResult | null> {
  const [source] = await db.select().from(sources).where(eq(sources.id, job.sourceId));
  if (!source) {
    logger.warn({ sourceId: job.sourceId }, 'source no longer exists');
    return null;
  }
  const adapter = getAdapter(source.adapter);
  if (!adapter) {
    logger.warn({ sourceId: source.id, adapter: source.adapter }, 'no adapter registered');
    return null;
  }
  const result = await ingestSource(db, source, adapter, fetcher);
  logger.info({ sourceId: source.id, platform: source.platform, ...result }, 'ingest finished');
  return result;
}
