import Link from 'next/link';
import type { Town } from '@towncore/db';
import type { TownWeather } from '@/modules/data';
import { clockTime, sentenceCase, shortHour } from './format';
import styles from './weather.module.css';

/**
 * The Today weather tile (docs/plans/M4b.md): this hour's forecast in large light numerals,
 * today's high and low, and an hourly row, with the National Weather Service named as the
 * source (no outside link: the full forecast is our own Weather page). It's a forecast for the
 * hour, not a measurement, and says so.
 */
export function WeatherTile({ town, weather }: { town: Town; weather: TownWeather }) {
  if (weather.kind === 'zone') {
    return (
      <section className={styles.tile} aria-labelledby="weather-h" data-testid="weather-tile">
        <div className={styles.tileTop}>
          <h2 id="weather-h" className={styles.place}>
            {town.name} weather
          </h2>
        </div>
        <p className={styles.zonePeriod}>{weather.period}</p>
        <p className={styles.zoneText}>{weather.text}</p>
        <p className={`meta ${styles.source}`}>
          National Weather Service forecast, issued {clockTime(weather.issuedAt, town.timezone)} ·{' '}
          <Link href="/weather">Full forecast</Link>
        </p>
      </section>
    );
  }
  const w = weather.snapshot;
  const { high, low } = w.today;
  return (
    <section className={styles.tile} aria-labelledby="weather-h" data-testid="weather-tile">
      <div className={styles.tileTop}>
        <h2 id="weather-h" className={styles.place}>
          {town.name}
        </h2>
        <Link className="meta" href="/weather">
          Full forecast →
        </Link>
      </div>
      <div className={styles.now}>
        <p className={styles.temp}>
          <span className="sr-only">Forecast for this hour: </span>
          {w.now.temperature}°
        </p>
        <p className={styles.condition}>
          <span className={styles.short}>{sentenceCase(w.now.shortForecast)}</span>
          {high !== null || low !== null ? (
            <span className={styles.hilo}>
              {[high !== null ? `H ${high}°` : null, low !== null ? `L ${low}°` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </p>
      </div>
      <ol className={`meta ${styles.hours}`} aria-label="Hourly forecast">
        {w.hours.map((h, i) => (
          <li key={h.startTime}>
            <span>{i === 0 ? 'Now' : shortHour(h.startTime, town.timezone)}</span>
            <span className={styles.hourTemp}>{h.temperature}°</span>
          </li>
        ))}
      </ol>
      <p className={`meta ${styles.source}`}>
        Forecast: National Weather Service, updated {clockTime(w.updatedAt, town.timezone)}
      </p>
    </section>
  );
}
