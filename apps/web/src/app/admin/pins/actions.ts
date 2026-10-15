'use server';

import { articles, eq, logAdminAction, pins } from '@towncore/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** Pins a published story to the top of its town's homepage until it expires (§6a). */
export async function pinArticle(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const articleId = String(form.get('articleId') ?? '');
  const hours = Number(form.get('hours'));
  const reason = String(form.get('reason') ?? '').trim() || 'staff pin';
  if (!/^[0-9a-f-]{36}$/.test(articleId) || !(hours >= 1 && hours <= 24 * 14)) {
    redirect('/admin/pins?error=input');
  }
  const [article] = await db().select().from(articles).where(eq(articles.id, articleId));
  if (!article || !['published', 'corrected'].includes(article.status)) {
    redirect('/admin/pins?error=input');
  }
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  await db()
    .insert(pins)
    .values({ articleId, townId: article!.townId, reason, createdBy: staff.id, expiresAt });
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'pin',
    articleId,
    detail: { reason, expiresAt: expiresAt.toISOString() },
  });
  revalidatePath('/admin/pins');
  redirect('/admin/pins?done=pinned');
}

export async function unpin(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const pinId = String(form.get('pinId') ?? '');
  const [pin] = await db().select().from(pins).where(eq(pins.id, pinId));
  if (!pin) redirect('/admin/pins?error=input');
  // Expire it now rather than delete, so the history stays.
  await db().update(pins).set({ expiresAt: new Date() }).where(eq(pins.id, pinId));
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'unpin',
    articleId: pin!.articleId,
    detail: { pinId, reason: pin!.reason },
  });
  revalidatePath('/admin/pins');
  redirect('/admin/pins?done=unpinned');
}
