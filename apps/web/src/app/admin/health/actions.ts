'use server';

import { GoLiveRefused, setSearchHidden } from '@towncore/launcher/golive';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Health → the search kill switch (owner, 2026-10-17): hide a town, or a whole launch
// cohort, from search engines fast, or show it again. Admins only; audited with the reason.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function searchSwitchAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const hidden = str(form, 'hidden') === 'true';
  const reason = str(form, 'reason');
  const townId = str(form, 'townId');
  const cohort = str(form, 'cohort');
  let names: string[];
  try {
    const changed = await setSearchHidden(
      db(),
      townId ? { staff: me, hidden, reason, townId } : { staff: me, hidden, reason, cohort },
    );
    names = changed.map((t) => t.siteName);
  } catch (error) {
    if (error instanceof GoLiveRefused)
      redirect(`/admin/health?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/health');
  redirect(
    `/admin/health?${new URLSearchParams({
      done: `${names!.join(', ')} ${hidden ? 'hidden from' : 'shown in'} search`,
    })}`,
  );
}
