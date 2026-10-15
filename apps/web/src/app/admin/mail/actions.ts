'use server';

import { eq, logAdminAction, mailDomains } from '@towncore/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** "Re-check": the worker's next mail tick (within 5 minutes) re-reads SES for this domain. */
export async function requestRecheck(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const name = String(form.get('name') ?? '');
  const [row] = await db()
    .update(mailDomains)
    .set({ recheckRequestedAt: new Date() })
    .where(eq(mailDomains.name, name))
    .returning({ id: mailDomains.id });
  if (!row) redirect('/admin/mail/domains');
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'mail_domain_recheck',
    target: { type: 'mail_domain', id: row.id },
  });
  revalidatePath(`/admin/mail/domains/${name}`);
  redirect(`/admin/mail/domains/${encodeURIComponent(name)}?recheck=1`);
}
