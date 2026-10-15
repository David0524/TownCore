'use server';

import { getTownBySlug, logAdminAction } from '@towncore/db';
import {
  gatherIssue,
  NewsletterError,
  renderIssue,
  setNewsletterMode,
  setNewsletterTester,
  type NewsletterMode,
} from '@towncore/email';
import { bulkFromAddress, buildBulkMime, domainBrand } from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { bulkDeps } from '@/lib/newsletter';

// Admin → Newsletter (M5): the off → test → live switch (D-M5-2, D-MAIL-11), the test list,
// and a test send of the next issue to yourself.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const page = (slug: string, params: Record<string, string>) =>
  `/admin/newsletter/${encodeURIComponent(slug)}?${new URLSearchParams(params).toString()}`;

async function attempt(slug: string, done: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof NewsletterError) redirect(page(slug, { error: error.message }));
    throw error;
  }
  revalidatePath(`/admin/newsletter/${slug}`);
  redirect(page(slug, { done }));
}

export async function setModeAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const mode = str(form, 'mode') as NewsletterMode;
  if (!['off', 'test', 'live'].includes(mode)) throw new Error('bad mode');
  await attempt(str(form, 'slug'), `Newsletter is now ${mode}`, () =>
    setNewsletterMode(db(), me, str(form, 'domainId'), mode),
  );
}

export async function setTesterAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const on = str(form, 'on') === 'yes';
  await attempt(
    str(form, 'slug'),
    on ? 'Added to the test list' : 'Removed from the test list',
    () => setNewsletterTester(db(), me, str(form, 'domainId'), str(form, 'staffId'), on),
  );
}

/** Sends tomorrow's issue as it would look now, to the person pressing the button only. */
export async function testSendNextAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const slug = str(form, 'slug');
  await attempt(slug, 'Test sent to you', async () => {
    const deps = bulkDeps();
    if (!deps)
      throw new NewsletterError(
        'Sending isn’t set up yet (transport, SES_CONFIG_SET_BULK, MAIL_TOKEN_SECRET).',
      );
    const town = await getTownBySlug(db(), slug);
    if (!town) throw new NewsletterError('No such town.');
    const domainId = str(form, 'domainId');
    const brand = await domainBrand(db(), domainId, deps.postalAddress);
    if (!brand.postalAddress)
      throw new NewsletterError('Set a postal address first (MAIL_POSTAL_ADDRESS).');
    const issue = renderIssue(await gatherIssue(db(), town));
    await deps.transport.send({
      raw: await buildBulkMime({
        brand,
        to: me.email,
        subject: `[Preview] ${issue.subject}`,
        html: issue.html,
        text: issue.text,
        unsubscribeToken: 'preview',
        campaignId: domainId,
        kind: 'newsletter',
      }),
      from: bulkFromAddress(brand.domain),
      to: [me.email],
      cc: [],
      configurationSet: deps.configurationSet,
      tags: {
        domain: brand.domain,
        domain_id: domainId,
        stream: 'bulk',
        kind: 'newsletter_preview',
      },
    });
    await logAdminAction(db(), {
      staffId: me.id,
      action: 'newsletter_preview_send',
      target: { type: 'mail_domain', id: domainId },
    });
  });
}
