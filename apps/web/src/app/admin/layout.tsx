import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { unreadCount } from '@towncore/mail';
import { currentStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
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
  const unread = staff ? await unreadCount(db(), staff.id) : 0;
  return (
    <div className={styles.shell}>
      <style dangerouslySetInnerHTML={{ __html: networkCssVariables() }} />
      <nav className={styles.bar} aria-label="Admin">
        <span className={styles.brand}>TownCore admin</span>
        {staff ? (
          <>
            <Link href="/admin/mail/inbox" data-testid="nav-inbox">
              Inbox{unread ? ` (${unread})` : ''}
            </Link>
            <Link href="/admin/health">Health</Link>
            <Link href="/admin/review">Review queue</Link>
            <Link href="/admin/skipped">Skip log</Link>
            <Link href="/admin/pins">Pins</Link>
            <Link href="/admin/newsletter">Newsletter</Link>
            <Link href="/admin/directory">Directory</Link>
            <Link href="/admin/launches">Launches</Link>
            <Link href="/admin/mail/subscribers">Subscribers</Link>
            <Link href="/admin/mail/campaigns">Campaigns</Link>
            <Link href="/admin/mail/domains">Mail domains</Link>
            <Link href="/admin/mail/health">Mail health</Link>
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
