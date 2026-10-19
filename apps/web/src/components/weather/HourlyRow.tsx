import { conditionKind, type WeatherPeriod } from '@towncore/config';
import type { Town } from '@towncore/db';
import { isNight, sentenceCase, shortHour } from './format';
import { WeatherIcon } from './WeatherIcon';
import styles from './weather.module.css';

/** How many hours the Weather page's hourly row shows. */
export const PAGE_HOURS = 12;

/**
 * The next hours of the hourly forecast, from the current one: the hour, our icon, the
 * temperature and any chance of precipitation. One row; it scrolls sideways on phones.
 */
export function HourlyRow({ town, hours }: { town: Town; hours: WeatherPeriod[] }) {
  if (hours.length === 0) return null;
  return (
    <ol className={styles.hourly} aria-label="Hourly forecast" data-testid="hourly-row">
      {hours.map((h, i) => (
        <li key={h.startTime} title={sentenceCase(h.shortForecast)}>
          <span className={styles.hourlyTime}>
            {i === 0 ? 'Now' : shortHour(h.startTime, town.timezone)}
          </span>
          <WeatherIcon
            kind={conditionKind(h.shortForecast)}
            night={isNight(h, town.timezone)}
            size={24}
            className={styles.hourlyIcon}
          />
          <span className={styles.hourlyTemp}>{h.temperature}°</span>
          <span className={styles.hourlyPrecip}>
            {h.precipChance && h.precipChance >= 20 ? `${h.precipChance}%` : ' '}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The hourly periods from the current hour on (the snapshot keeps the next 36). */
export function hoursFrom(upcoming: WeatherPeriod[] | undefined, now: WeatherPeriod) {
  const all = upcoming ?? [];
  const start = all.findIndex((p) => p.startTime === now.startTime);
  return start < 0 ? [] : all.slice(start, start + PAGE_HOURS);
}
