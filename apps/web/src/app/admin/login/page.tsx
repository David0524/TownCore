import { loadEnv } from '@towncore/config';
import { redirect } from 'next/navigation';
import { signInMode } from '@/lib/admin/google';
import { currentStaff } from '@/lib/admin/session';
import styles from '../admin.module.css';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  if (await currentStaff()) redirect('/admin/review');
  const { error } = await searchParams;
  const mode = signInMode(loadEnv());
  return (
    <main>
      <h1>Sign in</h1>
      {error === 'link' ? (
        <p className={styles.notice} role="alert">
          That sign-in link is invalid, used or expired. Ask for a new one.
        </p>
      ) : null}
      {error === 'google' ? (
        <p className={styles.notice} role="alert">
          Google sign-in didn&apos;t work. Use your company Google account. If it still fails, ask
          an admin to add you to the staff list.
        </p>
      ) : null}
      {mode.kind === 'google' ? (
        <>
          <p className={styles.muted}>Staff only. Use your company Google account.</p>
          <a className={styles.button} href="/admin/auth/google">
            Sign in with Google
          </a>
        </>
      ) : mode.kind === 'email' ? (
        <>
          <p className={styles.muted}>Staff only. We&apos;ll email you a one-time sign-in link.</p>
          <LoginForm />
        </>
      ) : (
        <p className={styles.notice} role="alert">
          Sign-in is not set up. Missing: {mode.missing.join(', ')}.
        </p>
      )}
    </main>
  );
}
