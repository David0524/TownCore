'use server';

import { decidePhoto, PhotoDecisionError } from '@towncore/photos';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** Approves (with alt text written from the photo) or rejects a pending photo (M9). Audited. */
export async function decide(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = String(form.get('id') ?? '');
  const decision = form.get('decision') === 'approve' ? 'approve' : 'reject';
  let outcome: string;
  try {
    await decidePhoto(db(), {
      id,
      staff,
      decision,
      alt: String(form.get('alt') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    outcome = decision === 'approve' ? 'done=approved' : 'done=rejected';
  } catch (error) {
    if (!(error instanceof PhotoDecisionError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/photos');
  redirect(`/admin/photos?${outcome}`);
}
