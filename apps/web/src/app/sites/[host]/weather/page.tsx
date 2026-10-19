import type { Metadata } from 'next';
import { apDate } from '@towncore/pipeline';
import { StandardPage } from '@/lib/pages';
import { requireTown, resolveTown } from '@/lib/town';
import { AlertList } from '@/components/weather/AlertList';
import { BeachSources, BeachTiles } from '@/components/weather/BeachTiles';
import { CurrentConditions } from '@/components/weather/CurrentConditions';
import { ForecastDays } from '@/components/weather/ForecastDays';
import { HourlyRow, hoursFrom } from '@/components/weather/HourlyRow';
import { TropicsPanel } from '@/components/weather/TropicsPanel';
import { updatedLabel } from '@/components/weather/format';
import { townForecast, townTropics, townWeather, weatherPageHasForecast } from '@/modules/data';
import styles from './weather.module.css';
import { thinUnless } from '@/lib/indexing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  // A real forecast for the town is a page worth listing (owner, 2026-10-19); without one it's
  // empty, so noindex.
  const hasForecast = await weatherPageHasForecast(town.id);
  return {
    title: `${town.name} weather: forecast and alerts`,
    description: `The National Weather Service forecast for ${town.name}, ${town.state}: this hour, the next 7 days, hour by hour, and any active weather alerts.`,
    alternates: { canonical: '/weather' },
    robots: thinUnless(town, hasForecast ? 1 : 0, 1),
  };
}

/**
 * The Weather page (the quick-links bar's Weather): every active NWS alert, this hour's
 * forecast, the 7 days and the next 12 hours, all from the National Weather Service via the
 * worker's snapshot; then the beach and the tropics where they apply. Without the 7-day
 * forecast it shows the zone forecast as NWS wrote it. Nothing invented: no forecast, no rows.
 */
export default async function WeatherPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [weather, tropics] = await Promise.all([townWeather(town.id), townTropics(town.state)]);
  const snapshot = weather?.kind === 'snapshot' ? weather.snapshot : null;
  // The zone forecast only when the 7-day one is missing.
  const forecast = snapshot?.days ? null : await townForecast(town.id);
  const hours = snapshot ? hoursFrom(snapshot.upcoming, snapshot.now) : [];
  return (
    <StandardPage town={town}>
      <h1>{town.name} weather</h1>
      {snapshot ? <AlertList town={town} alerts={snapshot.alerts} /> : null}
      {snapshot ? <CurrentConditions town={town} snapshot={snapshot} /> : null}
      <section aria-labelledby="days-h" className={styles.section}>
        <h2 id="days-h">7-day forecast</h2>
        {snapshot?.days ? (
          <ForecastDays days={snapshot.days} />
        ) : forecast ? (
          <>
            <ol className={styles.periods} data-testid="forecast">
              {forecast.periods.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong>
                  <span>{p.text}</span>
                </li>
              ))}
            </ol>
            <p className="meta">
              {forecast.url ? (
                <a href={forecast.url} rel="noopener">
                  National Weather Service
                </a>
              ) : (
                'National Weather Service'
              )}{' '}
              zone forecast, issued {apDate(forecast.issuedAt, town.timezone)}.
            </p>
          </>
        ) : (
          <p>The latest forecast isn&rsquo;t available right now. Please check back soon.</p>
        )}
      </section>
      {hours.length > 1 ? (
        <section aria-labelledby="hours-h" className={styles.section}>
          <h2 id="hours-h">Hour by hour</h2>
          <HourlyRow town={town} hours={hours} />
        </section>
      ) : null}
      {snapshot && snapshot.alerts.length === 0 ? (
        <p className={`meta ${styles.noAlerts}`} data-testid="no-alerts">
          No active weather alerts for {town.name}.
        </p>
      ) : null}
      {snapshot ? (
        <p className={`meta ${styles.credit}`} data-testid="weather-credit">
          Forecast:{' '}
          <a href={snapshot.sourceUrl} rel="noopener">
            National Weather Service
          </a>
          , updated {updatedLabel(snapshot.updatedAt, town.timezone).replace(/\.$/, '')}.
        </p>
      ) : null}
      {snapshot?.beach ? (
        <section aria-labelledby="beach-h" className={styles.beach}>
          <h2 id="beach-h">At the beach</h2>
          <BeachTiles town={town} beach={snapshot.beach} sunset={null} />
          <BeachSources beach={snapshot.beach} />
        </section>
      ) : null}
      {tropics ? <TropicsPanel town={town} tropics={tropics} /> : null}
      <p className={`meta ${styles.emergency}`}>
        In an emergency, follow guidance from local officials and the National Weather Service.
      </p>
    </StandardPage>
  );
}
