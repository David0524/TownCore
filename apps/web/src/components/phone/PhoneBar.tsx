'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BackChevron } from './icons';
import { backTarget, phonePath } from './path';
import styles from './phone.module.css';

/**
 * The phone navigation bar: the town's wordmark on a tab's own page; a back button ("‹ Today",
 * "‹ Sections") with the wordmark centered on pages deeper in. This hour's temperature sits
 * at the trailing edge.
 */
export function PhoneBar({
  wordmark,
  weather,
  action,
}: {
  wordmark: ReactNode;
  /** Trailing control on a tab's own page ("Your Boca"). */
  action?: ReactNode;
  /** This hour's temperature, linked to the NWS forecast (weather above the fold, §11a). */
  weather: { value: string; href: string; label: string } | null;
}) {
  const back = backTarget(phonePath(usePathname()));
  return (
    <div className={`${styles.bar} phone-only`} data-testid="phone-bar">
      {back ? (
        <>
          <Link href={back.href} className={styles.back}>
            <BackChevron />
            <span>{back.label}</span>
          </Link>
          <span className={styles.barTitle}>{wordmark}</span>
        </>
      ) : (
        <span className={styles.barMark}>{wordmark}</span>
      )}
      <span className={styles.barEnd}>
        {back ? null : action}
        {weather ? (
          <a
            href={weather.href}
            className={styles.barTemp}
            aria-label={weather.label}
            data-testid="phone-weather"
          >
            {weather.value}
          </a>
        ) : null}
      </span>
    </div>
  );
}
