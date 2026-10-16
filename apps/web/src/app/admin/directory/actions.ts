'use server';

import {
  CardNotWaiting,
  ClaimNotPending,
  decideClaim,
  decideNameChange,
  decideSponsorCard,
} from '@towncore/directory';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
