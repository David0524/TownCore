import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { unreadCount } from '@towncore/mail';
import { currentStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { networkCssVariables } from '@/lib/theme';
import styles from './admin.module.css';
import { signOut } from './actions';
import { AdminNav } from './AdminNav';

// Staff-only admin (CLAUDE.md §3). Network brand, never indexed, never on a town domain.
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · TownCore admin' },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  const unread = staff ? await unreadCount(db(), staff.id) : 0;
  return (
    <div className={staff ? styles.shell : `${styles.shell} ${styles.signedOut}`}>
      <style dangerouslySetInnerHTML={{ __html: networkCssVariables() }} />
      <aside className={styles.sidebar}>
        <Link href="/admin" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            T
          </span>
          TownCore admin
        </Link>
        {staff ? (
          <>
            <AdminNav unread={unread} />
            <div className={styles.account}>
              <Link href="/admin/account" className={styles.accountName}>
                <span className={styles.avatar} aria-hidden="true">
                  {staff.name.slice(0, 1).toUpperCase()}
                </span>
                {staff.name}
              </Link>
              <form action={signOut}>
                <button type="submit">Sign out</button>
              </form>
            </div>
          </>
        ) : null}
      </aside>
      <div className={styles.page}>{children}</div>
    </div>
  );
}
