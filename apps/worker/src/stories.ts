import { ne, towns, type Db } from '@towncore/db';
import { runStoryFinder, type FinderReport, type Llm } from '@towncore/pipeline';
import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { queues } from './queues';

export type StoryFinderJob = { townId: string };

/** Enqueues one story-finder job per town that isn't paused (draft towns run, unpublished). */
export async function enqueueStoryFinders(db: Db, boss: PgBoss, logger: Logger): Promise<number> {
  const active = await db.select({ id: towns.id }).from(towns).where(ne(towns.status, 'paused'));
  let queued = 0;
  for (const town of active) {
    const id = await boss.send(queues.storyFinder, { townId: town.id } satisfies StoryFinderJob, {
      singletonKey: town.id,
    });
    if (id) queued++;
  }
  logger.info({ towns: active.length, queued }, 'story finder tick');
  return queued;
}

export async function runStoryFinderJob(
  db: Db,
  llm: Llm | undefined,
  logger: Logger,
  job: StoryFinderJob,
): Promise<FinderReport> {
  const report = await runStoryFinder(db, job.townId, { llm });
  if (report.capReached)
    logger.warn({ townId: job.townId }, 'AI daily cap reached; candidates wait');
  if (!llm && report.pending > 0) {
    logger.warn({ townId: job.townId, pending: report.pending }, 'no model provider configured');
  }
  logger.info({ townId: job.townId, ...report }, 'story finder finished');
  return report;
}
