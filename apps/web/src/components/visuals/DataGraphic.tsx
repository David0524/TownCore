import type { DailyCountsSpec } from '@towncore/config';
import styles from './visuals.module.css';

/** "Mon" and "5" for an ISO calendar date (the date is already the town's local day). */
function dayParts(iso: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(d);
  return {
    weekday: f({ weekday: 'short' }),
    day: f({ day: 'numeric' }),
    month: f({ month: 'short' }),
  };
}

/**
 * A data graphic (CLAUDE.md §11c): counts per day, drawn from the story's own records in the
 * town's colors. The alt text, written from the same numbers, is the accessible name; the bars
 * and labels are hidden from screen readers so nothing is read twice.
 */
export function DataGraphic({ spec, alt }: { spec: DailyCountsSpec; alt: string }) {
  const max = Math.max(...spec.bars.map((b) => b.count), 1);
  const first = dayParts(spec.bars[0]!.date);
  const last = dayParts(spec.bars[spec.bars.length - 1]!.date);
  const range =
    first.month === last.month
      ? `${first.month} ${first.day}–${last.day}`
      : `${first.month} ${first.day}–${last.month} ${last.day}`;
  return (
    <div className={styles.chart} role="img" aria-label={alt} data-visual="data-graphic">
      <div className={styles.chartHead} aria-hidden="true">
        <span className={styles.chartTitle}>
          {spec.label.charAt(0).toUpperCase() + spec.label.slice(1)} by day
        </span>
        <span className="meta">
          {range} · {spec.total.toLocaleString('en-US')} total
        </span>
      </div>
      <ol className={styles.bars} aria-hidden="true">
        {spec.bars.map((bar) => {
          const { weekday, day } = dayParts(bar.date);
          return (
            <li key={bar.date} className={styles.barItem}>
              <span className={styles.barValue}>{bar.count}</span>
              <span className={styles.barTrack}>
                <span
                  className={styles.bar}
                  style={{ height: `${Math.max((bar.count / max) * 100, bar.count ? 3 : 0)}%` }}
                />
              </span>
              <span className={`meta ${styles.barLabel}`}>
                {weekday} {day}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
