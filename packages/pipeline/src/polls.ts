import { createHmac } from 'node:crypto';
import { loadEnv } from '@towncore/config';
import {
  and,
  desc,
  eq,
  gt,
  logAdminAction,
  lte,
  pollVotes,
  polls,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { localMidnight } from './time';

// Quick polls (owner, 2026-10-17): one opinion question about a local topic per town at a time,
// written by staff and shown only once a staff member approves it. Never about a named private
// person. Readers vote once per poll: the browser remembers its vote, and the server keeps one
// vote per address per poll, stored only as a keyed hash (no raw IP addresses). Results show
// after voting.

export type Poll = typeof polls.$inferSelect;
export type PollResults = { poll: Poll; counts: number[]; total: number };

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
/** Longest a poll may run. */
export const POLL_MAX_DAYS = 31;

export class PollError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: string | null | undefined, max: number) =>
  (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A draft poll for staff to approve. */
export async function createPoll(
  db: Db,
  input: {
    townId: string;
    staffId: string;
    question: string;
    options: string[];
    /** First and last day it runs (YYYY-MM-DD, town-local, whole days). */
    startsOn: string;
    endsOn: string;
  },
): Promise<Poll> {
  const question = clean(input.question, 160);
  const options = input.options.map((o) => clean(o, 60)).filter(Boolean);
  if (question.length < 10) throw new PollError('Write a question of at least 10 characters.');
  if (/https?:|www\.|@/i.test(question)) throw new PollError('No links or handles in a question.');
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS)
    throw new PollError(`Give ${POLL_MIN_OPTIONS} to ${POLL_MAX_OPTIONS} answers.`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
    throw new PollError('Each answer must be different.');
  const [town] = UUID.test(input.townId)
    ? await db.select({ timezone: towns.timezone }).from(towns).where(eq(towns.id, input.townId))
    : [];
  if (!town) throw new PollError('Pick a town.');
  const day = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  };
  const first = day(input.startsOn);
  const last = day(input.endsOn);
  if (!first || !last) throw new PollError('Pick a first and a last day.');
  const startsAt = localMidnight(first, town.timezone);
  const endsAt = localMidnight({ ...last, d: last.d + 1 }, town.timezone);
  if (endsAt <= startsAt) throw new PollError('The last day must be on or after the first.');
  if (endsAt.getTime() - startsAt.getTime() > (POLL_MAX_DAYS + 1) * 86_400_000)
    throw new PollError(`A poll runs at most ${POLL_MAX_DAYS} days.`);
  const [poll] = await db
    .insert(polls)
    .values({
      townId: input.townId,
      question,
      options,
      startsAt,
      endsAt,
      createdBy: input.staffId,
    })
    .returning();
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'poll.create',
    target: { type: 'poll', id: poll!.id },
    detail: { townId: input.townId, question },
  });
  return poll!;
}

/** Approves a draft (it shows from its start time) or withdraws a poll. Audited. */
export async function decidePoll(
  db: Db,
  input: { pollId: string; staffId: string; decision: 'approve' | 'withdraw'; now?: Date },
): Promise<Poll> {
  const now = input.now ?? new Date();
  const [poll] = await db
    .update(polls)
    .set(
      input.decision === 'approve'
        ? { status: 'approved', approvedBy: input.staffId, approvedAt: now }
        : { status: 'withdrawn' },
    )
    .where(
      and(
        eq(polls.id, input.pollId),
        input.decision === 'approve'
          ? eq(polls.status, 'draft')
          : sql`${polls.status} <> 'withdrawn'`,
      ),
    )
    .returning();
  if (!poll) throw new PollError('That poll was already decided.');
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'approve' ? 'poll.approve' : 'poll.withdraw',
    target: { type: 'poll', id: poll.id },
    detail: { townId: poll.townId },
  });
  return poll;
}

/** The town's approved poll running now (the latest to start), if any. */
export async function activePoll(db: Db, townId: string, now = new Date()): Promise<Poll | null> {
  const [poll] = await db
    .select()
    .from(polls)
    .where(
      and(
        eq(polls.townId, townId),
        eq(polls.status, 'approved'),
        lte(polls.startsAt, now),
        gt(polls.endsAt, now),
      ),
    )
    .orderBy(desc(polls.startsAt))
    .limit(1);
  return poll ?? null;
}

/** Vote counts per answer. */
export async function pollResults(db: Db, poll: Poll): Promise<PollResults> {
  const rows = await db
    .select({ option: pollVotes.option, n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, poll.id))
    .groupBy(pollVotes.option);
  const counts = poll.options.map((_, i) => rows.find((r) => r.option === i)?.n ?? 0);
  return { poll, counts, total: counts.reduce((a, b) => a + b, 0) };
}

/**
 * The voter key stored with a vote: a keyed hash of the poll and the reader's address, so one
 * address votes once per poll and no address is ever stored. Readers without an address share one
 * key per poll (local development).
 */
export function voterHash(
  pollId: string,
  ip: string | null,
  secret = loadEnv().VOTE_HASH_SECRET ?? 'towncore-development-vote-key',
): string {
  return createHmac('sha256', secret)
    .update(`${pollId}:${ip ?? 'unknown'}`)
    .digest('hex');
}

export type VoteOutcome = 'counted' | 'already' | 'closed';

/** Records a reader's vote on a running poll of this town. */
export async function castVote(
  db: Db,
  input: { townId: string; pollId: string; option: number; ip: string | null; now?: Date },
): Promise<{ outcome: VoteOutcome; results: PollResults | null }> {
  const now = input.now ?? new Date();
  const [poll] = await db
    .select()
    .from(polls)
    .innerJoin(towns, eq(towns.id, polls.townId))
    .where(and(eq(polls.id, input.pollId), eq(polls.townId, input.townId)));
  const p = poll?.polls;
  if (!p || p.status !== 'approved' || p.startsAt > now || p.endsAt <= now)
    return {
      outcome: 'closed',
      results: p && p.status === 'approved' ? await pollResults(db, p) : null,
    };
  if (!Number.isInteger(input.option) || input.option < 0 || input.option >= p.options.length)
    throw new PollError('Pick one of the answers.');
  const inserted = await db
    .insert(pollVotes)
    .values({
      pollId: p.id,
      option: input.option,
      voterHash: voterHash(p.id, input.ip),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: pollVotes.id });
  return { outcome: inserted.length ? 'counted' : 'already', results: await pollResults(db, p) };
}

/** Every town's polls for Admin → Polls: drafts first, then running and recent ones. */
export async function listPolls(db: Db, limit = 60) {
  return db
    .select({ poll: polls, siteName: towns.siteName })
    .from(polls)
    .innerJoin(towns, eq(towns.id, polls.townId))
    .orderBy(sql`${polls.status} = 'draft' desc`, desc(polls.startsAt))
    .limit(limit);
}

/** Round shares for display; they may not add to exactly 100. */
export function pollShares(results: Pick<PollResults, 'counts' | 'total'>): number[] {
  return results.counts.map((n) => (results.total ? Math.round((n / results.total) * 100) : 0));
}
