import Link from 'next/link';
import { formatTownDate } from '@/lib/town';
import { Masthead } from '../Masthead';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

/**
 * heritage's nameplate (docs/plans/M4b.md revision 6, canvas HarborHome): an ear row with the
 * date and "Subscribe free", the wordmark centered between a double rule above and a single
 * rule below with the paper's tagline, then the section row closed by another double rule.
 */
export function NameplateDoubleRule({ town, theme, nav, weather }: HeaderProps) {
  const temp = weather?.kind === 'snapshot' ? weather.snapshot : null;
  return (
    <header
      className={`${styles.header} ${styles.nameplate}`}
      data-part="header:nameplate-double-rule"
    >
      <div className={styles.nameplateInner}>
        <div className={styles.ear}>
          <span className="meta">
            {new Intl.DateTimeFormat('en-US', {
              timeZone: town.timezone,
              weekday: 'long',
            }).format(new Date())}
            , {formatTownDate(new Date(), town)}
          </span>
          <span className={styles.earEnd}>
            {temp ? (
              <a
                href={temp.sourceUrl}
                className={styles.earTemp}
                aria-label={`${town.name} weather: ${temp.now.temperature}° this hour, National Weather Service`}
                data-testid="header-weather"
              >
                {temp.now.temperature}°
              </a>
            ) : null}
            <Link href="/newsletter" className={styles.subscribeSecondary}>
              Subscribe free
            </Link>
          </span>
        </div>
        <div className={styles.plate}>
          <Masthead town={town} theme={theme} size="large" />
          {theme.tagline ? <p className={styles.tagline}>{theme.tagline}</p> : null}
        </div>
        <div className={styles.plateNav}>{nav}</div>
      </div>
    </header>
  );
}
