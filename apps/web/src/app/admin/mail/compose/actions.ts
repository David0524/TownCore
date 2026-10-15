'use server';

import { sendNew, sendReply, SendError, SuppressedRecipientsError } from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readDraft, sendDeps, type ComposeState } from '@/lib/admin/mail-send';
import { requireStaff } from '@/lib/admin/session';

// Send a reply or a new message (Mail-4). Pressing Send is the human approval Rule 10 needs.

async function send(
  form: FormData,
  run: (
    draft: Awaited<ReturnType<typeof readDraft>>,
  ) => Promise<{ threadId: string; status: string; error: string | null }>,
): Promise<ComposeState> {
  const draft = await readDraft(form);
  const values = draft.values;
  if (draft.to.bad.length || draft.cc.bad.length)
    return {
      error: `Not an email address: ${[...draft.to.bad, ...draft.cc.bad].join(', ')}`,
      values,
    };
  if (draft.tooBig) return { error: 'Attachments are limited to 10 MB in total.', values };
  let result;
  try {
    result = await run(draft);
  } catch (error) {
    if (error instanceof SuppressedRecipientsError)
      return { error: error.message, suppressed: error.addresses, values };
    if (error instanceof SendError) return { error: error.message, values };
    throw error;
  }
  revalidatePath(`/admin/mail/inbox/${result.threadId}`);
  redirect(
    `/admin/mail/inbox/${result.threadId}${result.status === 'failed' ? '?error=' + encodeURIComponent(`Not sent: ${result.error}`) : '?sent=1'}`,
  );
}

export async function sendReplyAction(_prev: ComposeState, form: FormData): Promise<ComposeState> {
  const me = await requireStaff();
  const deps = sendDeps();
  if ('unavailable' in deps) return { error: deps.unavailable };
  const threadId = String(form.get('threadId') ?? '');
  return send(form, (d) =>
    sendReply(deps, me, threadId, {
      to: d.to.ok,
      cc: d.cc.ok,
      subject: d.subject,
      body: d.body,
      attachments: d.attachments,
      confirmSuppressed: d.confirmSuppressed,
    }),
  );
}

export async function sendNewAction(_prev: ComposeState, form: FormData): Promise<ComposeState> {
  const me = await requireStaff();
  const deps = sendDeps();
  if ('unavailable' in deps) return { error: deps.unavailable };
  return send(form, (d) =>
    sendNew(deps, me, {
      domainId: String(form.get('domainId') ?? ''),
      localPart: String(form.get('localPart') ?? '')
        .trim()
        .toLowerCase(),
      to: d.to.ok,
      cc: d.cc.ok,
      subject: d.subject,
      body: d.body,
      attachments: d.attachments,
      confirmSuppressed: d.confirmSuppressed,
    }),
  );
}
