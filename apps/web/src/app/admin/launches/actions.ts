'use server';

import { CandidateDecisionError, decideCandidate } from '@towncore/launcher/candidates';
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
