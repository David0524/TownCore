'use server';

import {
  CardNotWaiting,
  ClaimNotPending,
  decideBusinessRequest,
  decideClaim,
  decideNameChange,
  decidePriceProposal,
  decideSponsorCard,
  decideTestimonial,
  dismissOutreach,
  FollowupError,
  OutreachError,
  overridePrice,
  PricingError,
  RequestNotPending,
  sendFollowup,
  sendOutreach,
  setFollowupApproval,
  skipFollowup,
  TestimonialNotPending,
} from '@towncore/directory';
import type { DirectoryProduct, FeaturedRank } from '@towncore/config';
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

export async function decideRequestAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'add' && decision !== 'reject') throw new Error('bad decision');
  try {
    await decideBusinessRequest(db(), {
      requestId: str(form, 'requestId'),
      staffId: me.id,
      decision,
    });
  } catch (error) {
    if (error instanceof RequestNotPending) done({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory');
  done({ done: decision === 'add' ? 'Business added to Places' : 'Request rejected' });
}

/**
 * The per-town standing approval for automatic owner follow-ups (Rule 10): admins only, and
 * audited. Off by default; while off, follow-ups wait below for someone to press Send.
 */
export async function followupApprovalAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  if (me.role !== 'admin') done({ error: 'Only an admin can change the standing approval.' });
  const on = str(form, 'on') === 'yes';
  await setFollowupApproval(db(), { townId: str(form, 'townId'), staffId: me.id, on });
  revalidatePath('/admin/directory');
  done({
    done: on ? 'Follow-ups now send automatically in this town' : 'Automatic follow-ups are off',
  });
}

/** Staff send or skip one owner follow-up. Pressing Send is the approval for that message. */
export async function followupAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const followupId = str(form, 'followupId');
  let message = 'Follow-up skipped';
  try {
    if (form.get('decision') === 'send') {
      const deps = directoryMailDeps();
      if (!deps) done({ error: 'Mail sending isn’t set up.' });
      const result = await sendFollowup(deps!, { followupId, staffId: me.id });
      message =
        result === 'sent' ? 'Follow-up sent' : 'Not sent: the owner unsubscribed or is suppressed';
    } else {
      await skipFollowup(db(), { followupId, staffId: me.id });
    }
  } catch (error) {
    if (error instanceof FollowupError) done({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory');
  done({ done: message });
}

/** Staff approve or reject an owner's testimonial (audited). */
export async function decideTestimonialAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad decision');
  try {
    await decideTestimonial(db(), {
      testimonialId: str(form, 'testimonialId'),
      staffId: me.id,
      decision,
    });
  } catch (error) {
    if (error instanceof TestimonialNotPending) done({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory');
  done({ done: decision === 'approve' ? 'Testimonial approved' : 'Testimonial rejected' });
}

const pricingDone = (params: Record<string, string>) =>
  redirect(`/admin/directory/pricing?${new URLSearchParams(params).toString()}`);

/** An admin approves or rejects a proposed price change (audited). */
export async function decidePriceAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  if (me.role !== 'admin') pricingDone({ error: 'Only an admin can decide price changes.' });
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad decision');
  try {
    await decidePriceProposal(db(), { changeId: str(form, 'changeId'), staffId: me.id, decision });
  } catch (error) {
    if (error instanceof PricingError) pricingDone({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory/pricing');
  pricingDone({ done: decision === 'approve' ? 'New price set' : 'Proposal rejected' });
}

/** An admin sets one category's price by hand, with a reason (audited). */
export async function overridePriceAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  if (me.role !== 'admin') pricingDone({ error: 'Only an admin can override a price.' });
  const [product, rank] = str(form, 'offer').split(':') as [DirectoryProduct, string | undefined];
  try {
    await overridePrice(db(), {
      townId: str(form, 'townId'),
      category: str(form, 'category'),
      product,
      rank: rank ? (Number(rank) as FeaturedRank) : null,
      dollars: Number(str(form, 'dollars')),
      staffId: me.id,
      reason: str(form, 'reason'),
    });
  } catch (error) {
    if (error instanceof PricingError) pricingDone({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/directory/pricing');
  pricingDone({ done: 'Price set for new bookings' });
}
