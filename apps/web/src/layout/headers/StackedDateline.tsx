import { Masthead } from '../Masthead';
import type { HeaderProps } from '../types';
import styles from './headers.module.css';

/** Masthead, then a dateline bar (date in the town's timezone; weather joins it in M2). */
export function StackedDateline({ town, theme, nav }: HeaderProps) {
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: town.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  return (
    <header className={styles.header} data-part="header:stacked-dateline">
      <div className={styles.inner}>
        <div className={styles.centered}>
          <Masthead town={town} theme={theme} size="large" />
        </div>
        <div className={styles.dateline}>
          <span data-testid="dateline-date">{today}</span>
          <span>
            {town.name}, {town.state}
          </span>
        </div>
        <div className={styles.navRow}>{nav}</div>
      </div>
    </header>
  );
}
