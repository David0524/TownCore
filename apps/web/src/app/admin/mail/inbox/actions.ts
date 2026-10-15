'use server';

import {
  addNote,
  assignThread,
  InboxActionError,
  moveThreadToTeam,
  setThreadStatus,
  threadStatuses,
  type ThreadStatus,
} from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
