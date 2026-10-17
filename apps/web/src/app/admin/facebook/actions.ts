'use server';

import { FacebookPostError, markFacebookPost, postToFacebook } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/**
 * Marks a queued post as posted by hand or skipped, or posts it through the Graph API when the
 * town's page has a token. Only ever on a staff member's press (Rule 10). Audited.
 */
export async function decideFacebookPost(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const postId = String(form.get('postId') ?? '');
  const action = String(form.get('action') ?? '');
  let outcome: string;
  try {
    if (action === 'post') {
      await postToFacebook(db(), { postId, staffId: staff.id });
      outcome = 'done=posted';
    } else {
      await markFacebookPost(db(), {
        postId,
        staffId: staff.id,
        outcome: action === 'skip' ? 'skipped' : 'posted',
      });
      outcome = action === 'skip' ? 'done=skipped' : 'done=marked';
    }
  } catch (error) {
    if (!(error instanceof FacebookPostError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/facebook');
  redirect(`/admin/facebook?${outcome}`);
}
