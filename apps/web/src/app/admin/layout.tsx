import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentStaff } from '@/lib/admin/session';
import { networkCssVariables } from '@/lib/theme';
import styles from './admin.module.css';
import { signOut } from './actions';

// Staff-only admin (CLAUDE.md §3). Network brand, never indexed, never on a town domain.
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · TownCore admin' },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  return (
    <div className={styles.shell}>
      <style dangerouslySetInnerHTML={{ __html: networkCssVariables() }} />
      <nav className={styles.bar} aria-label="Admin">
        <span className={styles.brand}>TownCore admin</span>
        {staff ? (
          <>
            <Link href="/admin/review">Review queue</Link>
            <Link href="/admin/skipped">Skip log</Link>
            <Link href="/admin/account">{staff.name}</Link>
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </>
        ) : null}
      </nav>
      <div className={styles.page}>{children}</div>
    </div>
  );
}
