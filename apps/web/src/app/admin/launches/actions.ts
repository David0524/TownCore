'use server';

import { CandidateDecisionError, decideCandidate } from '@towncore/launcher/candidates';
import { approveLaunch, GoLiveRefused, setTownPaused } from '@towncore/launcher/golive';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Launches (M7): approve or reject a ranked town (CLAUDE.md §10a). Admins only; audited.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function decideCandidateAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'reopen')
    throw new Error('bad decision');
  const state = str(form, 'state');
  const back = (params: Record<string, string>) =>
    redirect(`/admin/launches?${new URLSearchParams({ ...(state ? { state } : {}), ...params })}`);
  let name: string;
  try {
    ({ name } = await decideCandidate(db(), {
      candidateId: str(form, 'candidateId'),
      staff: me,
      decision,
      note: str(form, 'note'),
    }));
  } catch (error) {
    if (error instanceof CandidateDecisionError) back({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/launches');
  back({
    done:
      decision === 'approve'
        ? `${name!} approved for launch`
        : decision === 'reject'
          ? `${name!} rejected`
          : `${name!} back to proposed`,
  });
}

/** Approve launch: the town goes live (admin only; every check re-run; audited). */
export async function approveLaunchAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  let siteName: string;
  try {
    ({ siteName } = await approveLaunch(db(), { launchId: str(form, 'launchId'), staff: me }));
  } catch (error) {
    if (error instanceof GoLiveRefused)
      redirect(`/admin/launches?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/launches');
  redirect(`/admin/launches?${new URLSearchParams({ done: `${siteName!} is live` })}`);
}

/** Pause a live town, or resume a paused one (admin only; audited). */
export async function pauseTownAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const paused = str(form, 'paused') === 'true';
  let siteName: string;
  try {
    ({ siteName } = await setTownPaused(db(), { townId: str(form, 'townId'), staff: me, paused }));
  } catch (error) {
    if (error instanceof GoLiveRefused)
      redirect(`/admin/launches?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/launches');
  redirect(
    `/admin/launches?${new URLSearchParams({ done: `${siteName!} ${paused ? 'paused' : 'resumed'}` })}`,
  );
}
