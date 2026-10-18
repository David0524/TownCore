'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

// The admin sidebar (owner, 2026-10-18: "something like Resend's email software"): every page
// grouped by job, the current one marked.
type Item = { href: string; label: string; testId?: string };

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: 'Mail',
    items: [
      { href: '/admin/mail/inbox', label: 'Inbox', testId: 'nav-inbox' },
      { href: '/admin/mail/campaigns', label: 'Campaigns' },
      { href: '/admin/mail/subscribers', label: 'Subscribers' },
      { href: '/admin/mail/domains', label: 'Mail domains' },
      { href: '/admin/mail/health', label: 'Mail health' },
    ],
  },
  {
    title: 'Network',
    items: [
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/health', label: 'Health' },
      { href: '/admin/digest', label: 'Digest' },
      { href: '/admin/proposals', label: 'Proposals' },
      { href: '/admin/fixes', label: 'Fixes' },
      { href: '/admin/launches', label: 'Launches' },
      { href: '/admin/directory', label: 'Directory' },
    ],
  },
  {
    title: 'Newsroom',
    items: [
      { href: '/admin/review', label: 'Review queue' },
      { href: '/admin/skipped', label: 'Skip log' },
      { href: '/admin/pins', label: 'Pins' },
      { href: '/admin/photos', label: 'Photos' },
      { href: '/admin/scores', label: 'Scores' },
      { href: '/admin/polls', label: 'Polls' },
      { href: '/admin/facebook', label: 'Facebook' },
      { href: '/admin/newsletter', label: 'Newsletter' },
    ],
  },
];

export function AdminNav({ unread }: { unread: number }) {
  const path = usePathname() ?? '';
  const current = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav className={styles.nav} aria-label="Admin">
      {GROUPS.map((g) => (
        <div key={g.title} className={styles.navGroup}>
          <p className={styles.navTitle}>{g.title}</p>
          <ul>
            {g.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  data-testid={item.testId}
                  aria-current={current(item.href) ? 'page' : undefined}
                >
                  {item.label}
                  {item.testId === 'nav-inbox' && unread ? (
                    <>
                      <span className={styles.visuallyHidden}> (</span>
                      <span className={styles.navCount}>{unread}</span>
                      <span className={styles.visuallyHidden}>)</span>
                    </>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
