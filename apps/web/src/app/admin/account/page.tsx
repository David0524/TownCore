import { eq, logAdminAction, staff as staffTable } from '@towncore/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';

export const metadata = { title: 'Account' };

// Bylines read "Reviewed by {name}" (Rule 2). Saving a real name ends placeholder status.
async function saveName(form: FormData): Promise<void> {
  'use server';
  const member = await requireStaff();
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) redirect('/admin/account?error=name');
  await db()
    .update(staffTable)
    .set({ name, placeholder: false })
    .where(eq(staffTable.id, member.id));
  await logAdminAction(db(), {
    staffId: member.id,
    action: 'set_name',
    detail: { before: member.name, after: name },
  });
  revalidatePath('/admin', 'layout');
  redirect('/admin/account?done=1');
}

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function Account({ searchParams }: Props) {
  const member = await requireStaff();
  const { done, error } = await searchParams;
  return (
    <main>
      <h1>Account</h1>
      <p>
        {member.email} · {member.role}
      </p>
      {member.placeholder ? (
        <p className={styles.notice}>
          You&apos;re signing stories as the placeholder reviewer &ldquo;{member.name}&rdquo;.
          Stories on a live site must carry the reviewer&apos;s real name.
        </p>
      ) : null}
      {done ? <p role="status">Saved.</p> : null}
      {error ? <p role="alert">Enter the name to show in bylines.</p> : null}
      <form action={saveName} className={styles.form}>
        <label htmlFor="name">Name in bylines (&ldquo;Reviewed by …&rdquo;)</label>
        <input
          id="name"
          name="name"
          defaultValue={member.placeholder ? '' : member.name}
          required
        />
        <div>
          <button className={styles.button} type="submit">
            Save my real name
          </button>
        </div>
      </form>
    </main>
  );
}
