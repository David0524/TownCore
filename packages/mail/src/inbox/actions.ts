import { eq, logAdminAction, notes, staff, teams, threads, type Db } from '@towncore/db';
import type { ThreadStatus } from './queries';

// Inbox actions (Mail-3): assign, change status, move team, spam / not spam, notes. Every one
// writes the audit log (brief §10). Marking spam is a status change; "not spam" reopens.

export class InboxActionError extends Error {}

type Actor = { id: string };

async function audit(db: Db, actor: Actor, action: string, threadId: string, detail: unknown) {
  await logAdminAction(db, {
    staffId: actor.id,
    action,
    target: { type: 'thread', id: threadId },
    detail,
  });
}

async function current(db: Db, threadId: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!row) throw new InboxActionError('No such conversation.');
  return row;
}

export async function assignThread(
  db: Db,
  actor: Actor,
  threadId: string,
  assigneeId: string | null,
) {
  const before = await current(db, threadId);
  if (assigneeId) {
    const [person] = await db.select().from(staff).where(eq(staff.id, assigneeId));
    if (!person?.active) throw new InboxActionError('That person can’t be assigned.');
  }
  if (before.assigneeId === assigneeId) return;
  await db.update(threads).set({ assigneeId }).where(eq(threads.id, threadId));
  await audit(db, actor, 'thread_assign', threadId, { from: before.assigneeId, to: assigneeId });
}

export async function setThreadStatus(
  db: Db,
  actor: Actor,
  threadId: string,
  status: ThreadStatus,
) {
  const before = await current(db, threadId);
  if (before.status === status) return;
  await db.update(threads).set({ status }).where(eq(threads.id, threadId));
  const action =
    status === 'spam'
      ? 'thread_mark_spam'
      : before.status === 'spam'
        ? 'thread_not_spam'
        : 'thread_status';
  await audit(db, actor, action, threadId, { from: before.status, to: status });
}

export async function moveThreadToTeam(db: Db, actor: Actor, threadId: string, teamId: string) {
  const before = await current(db, threadId);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) throw new InboxActionError('No such team.');
  if (before.teamId === teamId) return;
  await db.update(threads).set({ teamId }).where(eq(threads.id, threadId));
  await audit(db, actor, 'thread_move_team', threadId, { from: before.teamId, to: teamId });
}

/** Internal notes are never emailed (brief §6). */
export async function addNote(db: Db, actor: Actor, threadId: string, body: string) {
  await current(db, threadId);
  const text = body.trim();
  if (!text) throw new InboxActionError('A note can’t be empty.');
  if (text.length > 10_000) throw new InboxActionError('That note is too long.');
  const [note] = await db
    .insert(notes)
    .values({ threadId, staffId: actor.id, body: text })
    .returning();
  await audit(db, actor, 'thread_note', threadId, { noteId: note!.id });
  return note!;
}
