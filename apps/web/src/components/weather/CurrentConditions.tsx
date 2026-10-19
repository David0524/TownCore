import { conditionKind, feelsLike, type WeatherSnapshot } from '@towncore/config';
import type { Town } from '@towncore/db';
import { isNight, sentenceCase } from './format';
import { WeatherIcon } from './WeatherIcon';
import styles from './weather.module.css';

/**
 * The Weather page's card for this hour: our icon, the temperature in large numerals, the NWS
 * short forecast, today's high and low, what it feels like (heat index or wind chill, by the NWS
 * formulas) and the wind. It's the hourly forecast, not a measurement, and says so. Same
 * treatment as the Today tile: the town's tint, the brand color on phones and for `community`.
 */
export function CurrentConditions({ town, snapshot }: { town: Town; snapshot: WeatherSnapshot }) {
  const { now, today } = snapshot;
  const feels = feelsLike(now);
  const wind =
    now.windSpeed && !/^0\b/.test(now.windSpeed)
      ? `Wind ${[now.windDirection, now.windSpeed].filter(Boolean).join(' ')}`
      : null;
  const facts = [
    today.high !== null ? `High ${today.high}°` : null,
    today.low !== null ? `Low ${today.low}°` : null,
    feels !== null ? `Feels like ${feels}°` : null,
  ].filter(Boolean);
  const more = [
    wind,
    now.precipChance && now.precipChance >= 10
      ? `${now.precipChance}% chance of precipitation`
      : null,
  ].filter(Boolean);
  return (
    <section
      className={`${styles.tile} ${styles.conditions}`}
      aria-labelledby="now-h"
      data-testid="current-conditions"
    >
      <h2 id="now-h" className={styles.place}>
        This hour in {town.name}
      </h2>
      <div className={styles.nowRow}>
        <WeatherIcon
          kind={conditionKind(now.shortForecast)}
          night={isNight(now, town.timezone)}
          size={60}
          className={styles.nowIcon}
        />
        <p className={styles.temp}>
          <span className="sr-only">Forecast for this hour: </span>
          {now.temperature}°
        </p>
        <div className={styles.nowText}>
          <p className={styles.short}>{sentenceCase(now.shortForecast)}</p>
          {facts.length ? <p className={styles.hilo}>{facts.join(' · ')}</p> : null}
          {more.length ? <p className={styles.hilo}>{more.join(' · ')}</p> : null}
        </div>
      </div>
    </section>
  );
}
