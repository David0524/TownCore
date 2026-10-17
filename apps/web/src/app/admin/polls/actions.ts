'use server';

import { createPoll, decidePoll, PollError } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

/** A draft poll for a town; it shows only once a staff member approves it. Audited. */
export async function addPoll(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const field = (k: string) => String(form.get(k) ?? '');
  let outcome: string;
  try {
    await createPoll(db(), {
      townId: field('townId'),
      staffId: staff.id,
      question: field('question'),
      options: [1, 2, 3, 4].map((i) => field(`option${i}`)),
      startsOn: field('startsOn'),
      endsOn: field('endsOn'),
    });
    outcome = 'done=created';
  } catch (error) {
    if (!(error instanceof PollError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/polls');
  redirect(`/admin/polls?${outcome}`);
}

/** Approves a draft or withdraws a poll. Audited. */
export async function decide(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const decision = form.get('decision') === 'approve' ? 'approve' : 'withdraw';
  let outcome: string;
  try {
    await decidePoll(db(), {
      pollId: String(form.get('pollId') ?? ''),
      staffId: staff.id,
      decision,
    });
    outcome = decision === 'approve' ? 'done=approved' : 'done=withdrawn';
  } catch (error) {
    if (!(error instanceof PollError)) throw error;
    outcome = `error=${encodeURIComponent(error.message)}`;
  }
  revalidatePath('/admin/polls');
  redirect(`/admin/polls?${outcome}`);
}
