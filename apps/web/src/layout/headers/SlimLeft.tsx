import Link from 'next/link';
import { Masthead } from '../Masthead';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

/**
 * coastal-modern's slim header (docs/plans/M4b.md, revision 4): a small wordmark on the left,
 * section links, then the weather and one dark "Subscribe free" button. It carries the weather
 * itself, so the page skips the separate weather line.
 */
export function SlimLeft({ town, theme, nav, weather }: HeaderProps) {
  const temp =
    weather?.kind === 'snapshot'
      ? { value: `${weather.snapshot.now.temperature}°`, href: weather.snapshot.sourceUrl }
      : null;
  return (
    <header className={`${styles.header} ${styles.slim}`} data-part="header:slim-left">
      <div className={styles.slimInner}>
        <div className={styles.slimMark}>
          <Masthead town={town} theme={{ ...theme, masthead: 'left-motif' }} size="slim" />
        </div>
        <div className={styles.slimNav}>{nav}</div>
        <div className={styles.slimEnd}>
          {temp ? (
            <a
              href={temp.href}
              className={styles.slimTemp}
              aria-label={`${town.name} weather: ${temp.value} this hour, National Weather Service`}
              data-testid="header-weather"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
              {temp.value}
            </a>
          ) : null}
          <Link href="/search" className={styles.slimSearch} aria-label="Search">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          </Link>
          <Link href="/newsletter" className={styles.subscribe}>
            Subscribe free
          </Link>
        </div>
      </div>
    </header>
  );
}
