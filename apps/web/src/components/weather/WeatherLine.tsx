import type { Town } from '@towncore/db';
import type { TownWeather } from '@/modules/data';
import { sentenceCase } from './format';
import styles from './weather.module.css';

/** One line of weather under the header on every page (§11a: weather above the fold). */
export function WeatherLine({ town, weather }: { town: Town; weather: TownWeather | null }) {
  if (!weather) return null;
  const href = weather.kind === 'snapshot' ? weather.snapshot.sourceUrl : weather.url;
  const text =
    weather.kind === 'snapshot'
      ? [
          `${weather.snapshot.now.temperature}°`,
          sentenceCase(weather.snapshot.now.shortForecast),
          weather.snapshot.today.high !== null ? `High ${weather.snapshot.today.high}°` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${weather.period}: ${weather.text.split('. ')[0]}`;
  return (
    <div className={styles.line} data-testid="weather-line">
      <div className={styles.lineInner}>
        <span className="meta">{town.name} weather</span>
        {href ? (
          <a href={href} className={styles.lineText}>
            {text}
          </a>
        ) : (
          <span className={styles.lineText}>{text}</span>
        )}
      </div>
    </div>
  );
}
