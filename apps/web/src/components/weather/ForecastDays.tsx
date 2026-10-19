import { daysFromPeriods, type SevenDayForecast } from '@towncore/config';
import { RowChevron } from '@/components/phone/icons';
import { sentenceCase } from './format';
import { WeatherIcon } from './WeatherIcon';
import styles from './weather.module.css';

/**
 * The 7-day forecast as one row per day (NWS's 12-hour periods paired by daysFromPeriods): the
 * day, our icon, the short forecast and its chance of rain or snow, the high and the low. A
 * forecast that starts at night leads with "Tonight". Each row opens to NWS's own words.
 */
export function ForecastDays({ days }: { days: SevenDayForecast }) {
  const rows = daysFromPeriods(days.periods);
  return (
    <ol className={styles.days} data-testid="forecast-days">
      {rows.map((d) => (
        <li key={d.name} data-testid="forecast-day">
          <details className={styles.day}>
            <summary className={styles.dayRow}>
              <span className={styles.dayName}>{d.name}</span>
              <WeatherIcon kind={d.kind} night={!d.isDaytime} className={styles.dayIcon} />
              <span className={styles.daySummary}>
                <span>{sentenceCase(d.shortForecast)}</span>
                {d.precipChance ? (
                  <span className={styles.precip}>
                    {d.precipChance}% {d.kind === 'snow' ? 'snow' : 'rain'}
                  </span>
                ) : null}
              </span>
              <span className={styles.temps}>
                {d.high !== null ? (
                  <span className={styles.high}>
                    <span className="sr-only">High </span>
                    {d.high}°
                  </span>
                ) : null}
                {d.low !== null ? (
                  <span className={styles.low}>
                    <span className="sr-only">Low </span>
                    {d.low}°
                  </span>
                ) : null}
              </span>
              <span className={styles.dayChevron}>
                <RowChevron />
              </span>
            </summary>
            {d.detail.length ? (
              <div className={styles.dayDetail}>
                {d.detail.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            ) : null}
          </details>
        </li>
      ))}
    </ol>
  );
}
