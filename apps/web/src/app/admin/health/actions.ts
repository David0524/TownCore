'use server';

import { GoLiveRefused, setSearchHidden } from '@towncore/launcher/golive';
import {
  decideExperiment,
  ExperimentRefused,
  startExperiment,
  stopExperiment,
} from '@towncore/pipeline';
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

// Experiments (owner, 2026-10-17): start one (each town or cohort gets a variant), roll out the
// winner network-wide, or stop it. Admins only; audited.
export async function experimentAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const key = str(form, 'key');
  const op = str(form, 'op');
  let done: string;
  try {
    if (op === 'start') {
      const unit = str(form, 'unit') === 'cohort' ? 'cohort' : 'town';
      const { assigned } = await startExperiment(db(), { key, unit, staff: me });
      done = `${key} started by ${unit} (${assigned} towns assigned)`;
    } else if (op === 'decide') {
      const winner = str(form, 'winner');
      await decideExperiment(db(), { key, winner, staff: me });
      done = `${key}: ${winner} now shows in every town`;
    } else {
      await stopExperiment(db(), { key, staff: me });
      done = `${key} stopped`;
    }
  } catch (error) {
    if (error instanceof ExperimentRefused)
      redirect(`/admin/health?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/health');
  redirect(`/admin/health?${new URLSearchParams({ done: done! })}`);
}
