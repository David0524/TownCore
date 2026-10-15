import { and, eq, isNull, ne, storyCandidates, towns, type Db } from '@towncore/db';
import {
  runStoryFinder,
  writeCandidate,
  type FinderReport,
  type Llm,
  type WriteOutcome,
} from '@towncore/pipeline';
import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { queues } from './queues';

export type StoryFinderJob = { townId: string };
export type WriterJob = { candidateId: string };

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
  boss: PgBoss,
  llm: Llm | undefined,
  logger: Logger,
  job: StoryFinderJob,
): Promise<FinderReport> {
  const report = await runStoryFinder(db, job.townId, { llm });
  // Queue every accepted, unwritten candidate (also ones left waiting on an earlier run).
  const ready = await db
    .select({ id: storyCandidates.id })
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, job.townId),
        eq(storyCandidates.status, 'accepted'),
        isNull(storyCandidates.articleId),
      ),
    );
  for (const candidate of ready) {
    await boss.send(queues.writer, { candidateId: candidate.id } satisfies WriterJob, {
      singletonKey: candidate.id,
    });
  }
  if (report.capReached)
    logger.warn({ townId: job.townId }, 'AI daily cap reached; candidates wait');
  if (!llm && report.pending > 0) {
    logger.warn({ townId: job.townId, pending: report.pending }, 'no model provider configured');
  }
  logger.info({ townId: job.townId, ...report }, 'story finder finished');
  return report;
}

export async function runWriterJob(
  db: Db,
  llm: Llm | undefined,
  logger: Logger,
  job: WriterJob,
): Promise<WriteOutcome> {
  const outcome = await writeCandidate(db, job.candidateId, { llm });
  logger.info({ candidateId: job.candidateId, ...outcome }, 'writer finished');
  return outcome;
}
