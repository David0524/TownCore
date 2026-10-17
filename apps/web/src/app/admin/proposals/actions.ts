'use server';

import { decideSourceProposal, ProposalRefused } from '@towncore/launcher/source-proposals';
import { decideProposal, ExperimentRefused, ProposalDecisionRefused } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Proposals (owner, 2026-10-17; docs/plans/agentic-ops.md): approve or reject in one
// click, audited. The learning loops' proposals are admin decisions; new sources may be decided
// by any staff member, like the rest of editorial sourcing.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const decision = (form: FormData) => {
  const d = str(form, 'decision');
  if (d !== 'approve' && d !== 'reject') throw new Error('bad decision');
  return d;
};

export async function decideProposalAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const d = decision(form);
  let title: string;
  try {
    ({ title } = await decideProposal(db(), {
      id: str(form, 'id'),
      staff: me,
      decision: d,
      note: str(form, 'note'),
    }));
  } catch (error) {
    if (error instanceof ProposalDecisionRefused || error instanceof ExperimentRefused)
      redirect(`/admin/proposals?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/proposals');
  redirect(
    `/admin/proposals?${new URLSearchParams({ done: `${d === 'approve' ? 'Approved' : 'Rejected'}: ${title!}` })}`,
  );
}

export async function decideSourceAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const d = decision(form);
  let label: string;
  try {
    const row = await decideSourceProposal(db(), { id: str(form, 'id'), staff: me, decision: d });
    label = `${row.siteName}: ${row.label}`;
  } catch (error) {
    if (error instanceof ProposalRefused)
      redirect(`/admin/proposals?${new URLSearchParams({ error: error.message })}#sources`);
    throw error;
  }
  revalidatePath('/admin/proposals');
  redirect(
    `/admin/proposals?${new URLSearchParams({
      done:
        d === 'approve'
          ? `Approved ${label!}. Run pnpm sources:export to add it to the town YAML.`
          : `Rejected ${label!}`,
    })}#sources`,
  );
}
