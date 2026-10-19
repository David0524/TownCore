'use server';

import {
  addNote,
  assignThread,
  InboxActionError,
  moveThreadToTeam,
  setThreadStatus,
  suppress,
  threadStatuses,
  type ThreadStatus,
} from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { contacts, eq, logAdminAction, threads } from '@towncore/db';
import { NewsroomError, sendToNewsroom } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Thread actions from /admin/mail/inbox/<id> (Mail-3). Every one is audited in packages/mail.

async function run(
  form: FormData,
  act: (actor: { id: string }, threadId: string) => Promise<unknown>,
) {
  const actor = await requireStaff();
  const threadId = String(form.get('threadId') ?? '');
  let error = '';
  try {
    await act(actor, threadId);
  } catch (e) {
    if (!(e instanceof InboxActionError)) throw e;
    error = e.message;
  }
  revalidatePath(`/admin/mail/inbox/${threadId}`);
  redirect(`/admin/mail/inbox/${threadId}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

export async function assignAction(form: FormData) {
  const value = String(form.get('assignee') ?? '');
  await run(form, (actor, id) =>
    assignThread(db(), actor, id, value === 'me' ? actor.id : value || null),
  );
}

export async function statusAction(form: FormData) {
  const status = String(form.get('status') ?? '');
  await run(form, async (actor, id) => {
    if (!(threadStatuses as readonly string[]).includes(status))
      throw new InboxActionError('Unknown status.');
    await setThreadStatus(db(), actor, id, status as ThreadStatus);
  });
}

export async function moveTeamAction(form: FormData) {
  const teamId = String(form.get('teamId') ?? '');
  await run(form, (actor, id) => moveThreadToTeam(db(), actor, id, teamId));
}

export async function noteAction(form: FormData) {
  const body = String(form.get('body') ?? '');
  await run(form, (actor, id) => addNote(db(), actor, id, body));
}

/**
 * The contact asked not to be emailed (for example a "no thanks" to outreach): a manual, global
 * suppression. Staff sends to the address then need the "send anyway" confirmation.
 */
export async function suppressContactAction(form: FormData) {
  await run(form, async (actor, id) => {
    const [row] = await db()
      .select({ email: contacts.email })
      .from(threads)
      .innerJoin(contacts, eq(contacts.id, threads.contactId))
      .where(eq(threads.id, id));
    if (!row) throw new InboxActionError('No contact on this conversation.');
    await suppress(db(), { email: row.email, reason: 'manual', note: 'Asked not to be emailed' });
    await logAdminAction(db(), {
      staffId: actor.id,
      action: 'mail.suppress',
      target: { type: 'thread', id },
      detail: { email: row.email },
    });
  });
}

/**
 * "Send to newsroom": stores an inbound press release as a primary-source record of the town
 * (packages/pipeline/src/press-releases.ts), for the story finder. Staff must confirm it comes
 * from the organization itself, not a news outlet (Rule 3). Audited there.
 */
export async function sendToNewsroomAction(form: FormData) {
  const actor = await requireStaff();
  const threadId = String(form.get('threadId') ?? '');
  let query: string;
  try {
    const result = await sendToNewsroom(db(), {
      messageId: String(form.get('messageId') ?? ''),
      staffId: actor.id,
      kind: String(form.get('kind') ?? ''),
      fromOrganization: form.get('fromOrganization') === 'yes',
    });
    query = `?newsroom=${result.created ? 'sent' : 'already'}`;
  } catch (e) {
    if (!(e instanceof NewsroomError)) throw e;
    query = `?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath(`/admin/mail/inbox/${threadId}`);
  redirect(`/admin/mail/inbox/${threadId}${query}`);
}
