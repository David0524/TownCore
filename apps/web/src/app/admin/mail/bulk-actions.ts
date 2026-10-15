'use server';

import { logAdminAction } from '@towncore/db';
import {
  approveCampaign,
  CampaignError,
  cancelCampaign,
  createCampaign,
  createTemplate,
  fanOutTemplate,
  pauseCampaign,
  resumeCampaign,
  resumeNetworkBulk,
  setNewsletterApproval,
  testSendCampaign,
  unpauseDomainBulk,
  unsubscribeSubscriber,
} from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { bulkDeps } from '@/lib/newsletter';

// Staff actions for newsletters and campaigns (Mail-5). Every change is audited in the mail
// package; errors come back to the page as a plain sentence.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const back = (path: string, params: Record<string, string>) =>
  `${path}?${new URLSearchParams(params).toString()}`;

async function attempt(path: string, ok: Record<string, string>, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof CampaignError) redirect(back(path, { error: error.message }));
    throw error;
  }
  revalidatePath(path);
  redirect(back(path, ok));
}

export async function unsubscribeAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const id = str(form, 'subscriberId');
  const result = await unsubscribeSubscriber(db(), id);
  if (result)
    await logAdminAction(db(), {
      staffId: me.id,
      action: 'subscriber_unsubscribe',
      target: { type: 'subscriber', id },
    });
  revalidatePath('/admin/mail/subscribers');
  // Back to the same filtered list.
  const keep = new URLSearchParams(str(form, 'filters'));
  const params: Record<string, string> = { done: `Unsubscribed ${result?.email ?? 'nobody'}` };
  for (const key of ['town', 'status', 'q']) {
    const value = keep.get(key);
    if (value) params[key] = value;
  }
  redirect(back('/admin/mail/subscribers', params));
}

export async function createCampaignAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  let id: string;
  try {
    id = (
      await createCampaign(db(), me, {
        domainId: str(form, 'domainId'),
        subject: str(form, 'subject'),
        body: String(form.get('body') ?? ''),
      })
    ).id;
  } catch (error) {
    if (error instanceof CampaignError)
      redirect(back('/admin/mail/campaigns', { error: error.message }));
    throw error;
  }
  redirect(`/admin/mail/campaigns/${id}`);
}

export async function createTemplateAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await attempt('/admin/mail/campaigns', { done: 'Template saved' }, () =>
    createTemplate(db(), me, {
      name: str(form, 'name'),
      subject: str(form, 'subject'),
      body: String(form.get('body') ?? ''),
    }),
  );
}

export async function fanOutAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const domains = form.getAll('domainId').map(String).filter(Boolean);
  await attempt(
    '/admin/mail/campaigns',
    { done: `${domains.length} draft(s) created` },
    async () => {
      if (!domains.length) throw new CampaignError('Pick at least one town.');
      await fanOutTemplate(db(), me, str(form, 'templateId'), domains);
    },
  );
}

function campaignAction(
  run: (
    me: Awaited<ReturnType<typeof requireStaff>>,
    id: string,
    form: FormData,
  ) => Promise<unknown>,
  done: string,
) {
  return async (form: FormData) => {
    const me = await requireStaff();
    const id = str(form, 'id');
    await attempt(`/admin/mail/campaigns/${id}`, { done }, () => run(me, id, form));
  };
}

export async function approveAction(form: FormData): Promise<void> {
  await campaignAction(async (me, id) => {
    const when = str(form, 'when');
    const at = when ? new Date(when) : null;
    if (at && Number.isNaN(at.getTime())) throw new CampaignError('That send time isn’t a date.');
    await approveCampaign(db(), me, id, at);
  }, 'Approved and scheduled')(form);
}

export async function pauseAction(form: FormData): Promise<void> {
  await campaignAction((me, id) => pauseCampaign(db(), me, id), 'Paused')(form);
}

export async function resumeAction(form: FormData): Promise<void> {
  await campaignAction((me, id) => resumeCampaign(db(), me, id), 'Resumed')(form);
}

export async function cancelAction(form: FormData): Promise<void> {
  await campaignAction((me, id) => cancelCampaign(db(), me, id), 'Cancelled')(form);
}

export async function testSendAction(form: FormData): Promise<void> {
  await campaignAction(async (me, id) => {
    const deps = bulkDeps();
    if (!deps)
      throw new CampaignError(
        'Sending isn’t set up yet (transport, SES_CONFIG_SET_BULK, MAIL_TOKEN_SECRET).',
      );
    await testSendCampaign(deps, me, id);
  }, 'Test sent to you')(form);
}

export async function newsletterApprovalAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const name = str(form, 'name');
  await attempt(`/admin/mail/domains/${encodeURIComponent(name)}`, { done: 'Saved' }, () =>
    setNewsletterApproval(db(), me, str(form, 'domainId'), str(form, 'on') === 'yes'),
  );
}

export async function unpauseAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const name = str(form, 'name');
  await attempt(
    `/admin/mail/domains/${encodeURIComponent(name)}`,
    { done: 'Bulk mail unpaused' },
    () => unpauseDomainBulk(db(), me, str(form, 'domainId')),
  );
}

export async function networkResumeAction(): Promise<void> {
  const me = await requireStaff();
  await attempt('/admin/mail/campaigns', { done: 'Bulk mail resumed for every town' }, () =>
    resumeNetworkBulk(db(), me),
  );
}
