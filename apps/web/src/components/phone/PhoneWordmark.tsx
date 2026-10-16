import { motifSvg } from '@towncore/brand';
import type { Theme } from '@towncore/config';
import type { Town } from '@towncore/db';
import Link from 'next/link';
import { townLogo } from '@/lib/logo';
import styles from './phone.module.css';

/**
 * The wordmark in the phone navigation bar: the town's motif and its name set as live text in
 * New York semibold (canvas HomePhone), linking home. Text rather than the fitted SVG
 * masthead, so it stays sharp and true to the system serif at 17pt. A town with its own logo
 * shows that instead, at the bar's height.
 */
export function PhoneWordmark({ town, theme }: { town: Town; theme: Theme }) {
  const logo = townLogo(town);
  if (logo) {
    return (
      <Link href="/" className={styles.wordmark} data-testid="phone-masthead">
        <img
          src={logo.src}
          width={logo.width}
          height={logo.height}
          alt={town.siteName}
          className={styles.wordmarkLogo}
        />
      </Link>
    );
  }
  return (
    <Link href="/" className={styles.wordmark} data-testid="phone-masthead">
      <span
        className={styles.wordmarkMotif}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: motifSvg(theme.motif, 20) }}
      />
      <span>{town.siteName}</span>
    </Link>
  );
}
