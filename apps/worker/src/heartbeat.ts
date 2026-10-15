import { sql, workerHeartbeats, type Db } from '@towncore/db';

export async function recordHeartbeat(db: Db, workerId: string, startedAt: Date): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ workerId, startedAt, lastBeatAt: sql`now()` })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { startedAt, lastBeatAt: sql`now()` },
    });
}
