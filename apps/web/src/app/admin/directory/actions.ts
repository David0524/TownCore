'use server';

import {
  CardNotWaiting,
  ClaimNotPending,
  decideClaim,
  decideNameChange,
  decideSponsorCard,
  dismissOutreach,
  OutreachError,
  sendOutreach,
} from '@towncore/directory';
import { SendError, SuppressedRecipientsError } from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sendDeps } from '@/lib/admin/mail-send';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { directoryMailDeps } from '@/lib/owner';

// Admin → Directory (M6 PR C): approve or reject verified claims (D-M6-4) and owners' new
// business names. Every decision is audited in admin_actions.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const done = (params: Record<string, string>) =>
  redirect(`/admin/directory?${new URLSearchParams(params).toString()}`);

export async function decideClaimAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad decision');
  // Without sending set up, decisions still record; the approval email is just not sent.
  const deps = directoryMailDeps() ?? {
    db: db(),
    transport: {
      name: 'log' as const,
      async send() {
        return { sesMessageId: 'not-sent' };
      },
    },
    configurationSet: 'none',
  };
  try {
    await decideClaim(deps, {
      claimId: str(form, 'claimId'),
      staffId: me.id,
      decision,
      note: str(form, 'note'),
    });
  } catch (error) {
    if (error instanceof ClaimNotPending) done({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory');
  done({ done: decision === 'approve' ? 'Claim approved' : 'Claim rejected' });
}

export async function decideNameAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad decision');
  await decideNameChange(db(), { businessId: str(form, 'businessId'), staffId: me.id, decision });
  revalidatePath('/admin/directory');
  done({ done: decision === 'approve' ? 'New name approved' : 'New name rejected' });
}

export async function decideCardAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad decision');
  try {
    await decideSponsorCard(db(), {
      campaignId: str(form, 'campaignId'),
      staffId: me.id,
      decision,
      note: str(form, 'note'),
    });
  } catch (error) {
    if (error instanceof CardNotWaiting) done({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory');
  done({ done: decision === 'approve' ? 'Card approved and live' : 'Card rejected' });
}

/**
 * Sends an outreach draft (§11 business triggers). Pressing Send is the human approval Rule 10
 * needs; the message goes out through the inbox like any staff message, from sales@.
 */
export async function sendOutreachAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const draftId = str(form, 'draftId');
  if (form.get('decision') === 'dismiss') {
    try {
      await dismissOutreach(db(), { draftId, staffId: me.id });
    } catch (error) {
      if (error instanceof OutreachError) done({ error: error.message });
      throw error;
    }
    revalidatePath('/admin/directory');
    done({ done: 'Draft dismissed' });
  }
  const deps = sendDeps();
  if ('unavailable' in deps) done({ error: deps.unavailable });
  let result: Awaited<ReturnType<typeof sendOutreach>>;
  try {
    result = await sendOutreach(deps as Exclude<typeof deps, { unavailable: string }>, me, {
      draftId,
      to: str(form, 'to'),
      subject: str(form, 'subject'),
      body: String(form.get('body') ?? ''),
      confirmSuppressed: form.get('confirmSuppressed') === 'on',
    });
  } catch (error) {
    if (error instanceof SuppressedRecipientsError)
      done({ error: error.message, confirm: draftId });
    if (error instanceof OutreachError || error instanceof SendError)
      done({ error: (error as Error).message });
    throw error;
  }
  revalidatePath('/admin/directory');
  // A failed delivery stays in its inbox conversation, where it can be sent again.
  redirect(
    `/admin/mail/inbox/${result!.threadId}${result!.status === 'failed' ? '?error=' + encodeURIComponent(`Not sent: ${result!.error}`) : '?sent=1'}`,
  );
}
