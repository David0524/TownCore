'use server';

import { FixRequestRefused, updateFixRequest } from '@towncore/adapters';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Fixes: staff move an adapter fix request along (a session took it, it's fixed with
// its pull request, or it's dismissed). Audited.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function fixRequestAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const status = str(form, 'status');
  if (status !== 'in_progress' && status !== 'fixed' && status !== 'dismissed')
    throw new Error('bad status');
  try {
    await updateFixRequest(db(), {
      id: str(form, 'id'),
      status,
      staff: me,
      ...(str(form, 'prUrl') ? { prUrl: str(form, 'prUrl') } : {}),
      ...(str(form, 'note') ? { note: str(form, 'note') } : {}),
    });
  } catch (error) {
    if (error instanceof FixRequestRefused)
      redirect(`/admin/fixes?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/fixes');
  redirect(`/admin/fixes?${new URLSearchParams({ done: `Marked ${status.replace('_', ' ')}` })}`);
}
