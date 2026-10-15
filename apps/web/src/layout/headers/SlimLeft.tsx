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
              {temp.value}
            </a>
          ) : null}
          <Link href="/newsletter" className={styles.subscribe}>
            Subscribe free
          </Link>
        </div>
      </div>
    </header>
  );
}
