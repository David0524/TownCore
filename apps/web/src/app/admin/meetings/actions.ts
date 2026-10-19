'use server';

import { attachCaptions, CAPTION_MAX_BYTES, CaptionUploadError } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** Stores a meeting's caption file as its transcript and adds it to its recap. Audited. */
export async function uploadCaptions(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const file = form.get('captions');
  let outcome: string;
  try {
    if (!(file instanceof File) || file.size === 0) {
      throw new CaptionUploadError('Choose a caption file.');
    }
    if (form.get('allowed') !== 'yes') {
      throw new CaptionUploadError(
        'Confirm the captions are the town’s own or the meeting’s own recording.',
      );
    }
    if (file.size > CAPTION_MAX_BYTES) {
      throw new CaptionUploadError('That file is too large (5 MB at most).');
    }
    const out = await attachCaptions(db(), {
      meetingRecordId: String(form.get('meeting') ?? ''),
      fileName: file.name,
      content: await file.text(),
      staffId: staff.id,
    });
    outcome = `done=${encodeURIComponent(
      `${out.chars.toLocaleString('en-US')} characters${out.cues ? `, ${out.cues} timed captions` : ''}`,
    )}`;
  } catch (error) {
    if (!(error instanceof CaptionUploadError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/meetings');
  redirect(`/admin/meetings?${outcome}`);
}
