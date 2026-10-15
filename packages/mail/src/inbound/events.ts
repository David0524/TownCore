import { mailEvents, sql, type Db } from '@towncore/db';

// The mail_events table is the queue between the webhook and the worker (Mail-2 design).
// Claiming pushes next_attempt_at forward, so a crashed worker's events come back on their own,
// and SKIP LOCKED lets several workers share the load.

export const MAX_EVENT_ATTEMPTS = 8;
const CLAIM_MS = 5 * 60_000;

export type EventHandler = (event: {
  id: string;
  type: string;
  payload: unknown;
}) => Promise<{ status: 'done' | 'dropped'; note?: string }>;

export type BatchResult = { done: number; dropped: number; retried: number; failed: number };

/** Backoff after a failed attempt: 1, 2, 4 … minutes, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

export async function processDueEvents(
  db: Db,
  handler: EventHandler,
  limit = 10,
): Promise<BatchResult> {
  const claimed = (await db.execute(sql`
    update ${mailEvents}
    set next_attempt_at = now() + make_interval(secs => ${CLAIM_MS / 1000}), attempts = attempts + 1
    where id in (
      select id from ${mailEvents}
      where status = 'pending' and next_attempt_at <= now()
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, type, payload, attempts
  `)) as unknown as { id: string; type: string; payload: unknown; attempts: number }[];

  const result: BatchResult = { done: 0, dropped: 0, retried: 0, failed: 0 };
  for (const event of claimed) {
    try {
      const outcome = await handler(event);
      await db.execute(sql`
        update ${mailEvents}
        set status = ${outcome.status}, processed_at = now(), last_error = ${outcome.note ?? null}
        where id = ${event.id}
      `);
      result[outcome.status]++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      const giveUp = event.attempts >= MAX_EVENT_ATTEMPTS;
      await db.execute(sql`
        update ${mailEvents}
        set last_error = ${message},
            status = ${giveUp ? 'failed' : 'pending'},
            next_attempt_at = now() + make_interval(secs => ${retryDelayMs(event.attempts) / 1000})
        where id = ${event.id}
      `);
      if (giveUp) result.failed++;
      else result.retried++;
    }
  }
  return result;
}
