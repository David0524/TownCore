'use server';

import { loadEnv } from '@towncore/config';
import {
  DMARC_POLICIES,
  DmarcPolicyError,
  PlacementError,
  providersFromEnv,
  recordPlacement,
  sendPlacementTest,
  setDmarcPolicy,
  type DmarcPolicy,
  type Placement,
} from '@towncore/mail';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { bulkDeps } from '@/lib/newsletter';

// The inbox-placement test and DMARC policy step-up (owner, 2026-10-19). Both are audited in the
// mail package; errors come back to the page as a plain sentence.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const back = (path: string, params: { error?: string; done?: string }) =>
  `${path}?${new URLSearchParams(params).toString()}`;

async function attempt(path: string, ok: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof PlacementError || error instanceof DmarcPolicyError)
      redirect(back(path, { error: error.message }));
    throw error;
  }
  revalidatePath(path);
  redirect(back(path, { done: ok }));
}

const domainPath = (form: FormData) =>
  `/admin/mail/domains/${encodeURIComponent(str(form, 'name'))}`;

export async function sendPlacementAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const path = domainPath(form);
  const deps = bulkDeps();
  if (!deps) redirect(back(path, { error: 'Bulk sending isn’t configured here.' }));
  const seeds = loadEnv().PLACEMENT_SEED_ADDRESSES ?? [];
  await attempt(
    path,
    'Placement test sent. Check each seed inbox, then record where it landed.',
    () => sendPlacementTest({ ...deps, seeds }, me, str(form, 'domainId')),
  );
}

export async function recordPlacementAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await attempt(domainPath(form), 'Recorded.', () =>
    recordPlacement(db(), me, str(form, 'resultId'), str(form, 'placement') as Placement),
  );
}

export async function setDmarcPolicyAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const path = str(form, 'from') === 'health' ? '/admin/mail/health' : domainPath(form);
  const target = str(form, 'policy') as DmarcPolicy;
  if (!DMARC_POLICIES.includes(target)) redirect(back(path, { error: 'Unknown policy.' }));
  const providers = providersFromEnv(loadEnv());
  await attempt(path, `DMARC policy set to ${target}.`, () =>
    setDmarcPolicy(
      { db: db(), dns: providers.dns, offline: providers.offline },
      me,
      str(form, 'recordId'),
      target,
    ),
  );
}
