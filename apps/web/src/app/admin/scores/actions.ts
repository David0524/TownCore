'use server';

import { decideScore, ScoreDecisionError } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** Approves (writing the game) or rejects a reader's score report. Audited. */
export async function decide(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const approve = form.get('decision') === 'approve';
  let outcome: string;
  try {
    await decideScore(db(), {
      reportId: String(form.get('id') ?? ''),
      staffId: staff.id,
      approve,
      home: String(form.get('home') ?? ''),
      away: String(form.get('away') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    outcome = approve ? 'done=approved' : 'done=rejected';
  } catch (error) {
    if (!(error instanceof ScoreDecisionError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/scores');
  redirect(`/admin/scores?${outcome}`);
}
