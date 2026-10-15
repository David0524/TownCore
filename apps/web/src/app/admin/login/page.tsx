import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/admin/session';
import styles from '../admin.module.css';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  if (await currentStaff()) redirect('/admin/review');
  const { error } = await searchParams;
  return (
    <main>
      <h1>Sign in</h1>
      {error === 'link' ? (
        <p className={styles.notice} role="alert">
          That sign-in link is invalid, used or expired. Ask for a new one.
        </p>
      ) : null}
      <p className={styles.muted}>Staff only. We&apos;ll email you a one-time sign-in link.</p>
      <LoginForm />
    </main>
  );
}
