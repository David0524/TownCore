import { motifSvg } from '@towncore/brand';
import Link from 'next/link';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

/**
 * community's compact tinted bar (docs/plans/M4b.md revision 6, canvas PineHome): the brand color
 * as a band with the motif and the name in the display face, this hour's temperature, and the
 * sign-up in the secondary color. The sections follow on a light row.
 */
export function TintedBar({ town, theme, nav, weather }: HeaderProps) {
  const temp = weather?.kind === 'snapshot' ? weather.snapshot : null;
  return (
    <header className={`${styles.header} ${styles.tinted}`} data-part="header:tinted-bar">
      <div className={styles.tintedBand}>
        <div className={styles.tintedInner}>
          <Link href="/" className={styles.tintedMark} data-testid="masthead">
            <span
              className={styles.tintedMotif}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: motifSvg(theme.motif, 30) }}
            />
            <span>{town.siteName}</span>
          </Link>
          <div className={styles.tintedEnd}>
            {temp ? (
              <a
                href={temp.sourceUrl}
                className={styles.tintedTemp}
                aria-label={`${town.name} weather: ${temp.now.temperature}° this hour, National Weather Service`}
                data-testid="header-weather"
              >
                {temp.now.temperature}°
              </a>
            ) : null}
            <Link href="/newsletter" className={styles.subscribeSecondary}>
              Get the morning email
            </Link>
          </div>
        </div>
      </div>
      <div className={styles.inner}>{nav}</div>
    </header>
  );
}
