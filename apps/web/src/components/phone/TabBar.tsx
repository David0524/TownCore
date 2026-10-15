'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { EventsIcon, SearchIcon, SectionsIcon, TodayIcon } from './icons';
import { phonePath } from './path';
import styles from './phone.module.css';

type Tab = {
  href: string;
  label: string;
  icon: (props: { filled?: boolean }) => ReactElement;
  /** Which pages belong to this tab, so it stays selected deeper in. */
  owns: (path: string) => boolean;
};

// Places (the directory) joins as the fourth tab when the directory ships (M6).
const tabs: Tab[] = [
  {
    href: '/',
    label: 'Today',
    icon: TodayIcon,
    owns: (p) => p === '/' || p.startsWith('/news/'),
  },
  {
    href: '/sections',
    label: 'Sections',
    icon: SectionsIcon,
    owns: (p) =>
      ['/sections', '/beat/', '/about', '/methods', '/corrections', '/privacy'].some((s) =>
        p.startsWith(s),
      ),
  },
  { href: '/events', label: 'Events', icon: EventsIcon, owns: (p) => p.startsWith('/events') },
  { href: '/search', label: 'Search', icon: SearchIcon, owns: (p) => p.startsWith('/search') },
];

/** The phone's bottom tab bar (below 600px, every town): primary navigation, never a hamburger. */
export function TabBar() {
  const path = phonePath(usePathname());
  return (
    <nav className={`${styles.tabBar} phone-only`} aria-label="Main" data-testid="tab-bar">
      <ul>
        {tabs.map((tab) => {
          const current = tab.owns(path);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={styles.tab}
                aria-current={current ? 'page' : undefined}
              >
                <Icon filled={current} />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
