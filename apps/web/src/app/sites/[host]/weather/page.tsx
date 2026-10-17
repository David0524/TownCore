import type { Metadata } from 'next';
import { apDate } from '@towncore/pipeline';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { BeachSources, BeachTiles } from '@/components/weather/BeachTiles';
import { TropicsPanel } from '@/components/weather/TropicsPanel';
import { townForecast, townTropics, townWeather } from '@/modules/data';
import styles from './weather.module.css';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Weather',
  alternates: { canonical: '/weather' },
  robots: THIN_PAGE,
};

/**
 * The 7-day forecast (the quick-links bar's Weather), as the National Weather Service wrote it
 * for the town's forecast zone, with its source and time. Nothing invented: no forecast in the
 * last two days, no periods. Towns a hurricane basin can reach also get the National Hurricane
 * Center's storms and outlook.
 */
export default async function WeatherPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [forecast, weather, tropics] = await Promise.all([
    townForecast(town.id),
    townWeather(town.id),
    townTropics(town.state),
  ]);
  const beach = weather?.kind === 'snapshot' ? weather.snapshot.beach : undefined;
  return (
    <StandardPage town={town}>
      <h1>{town.name} weather</h1>
      {forecast ? (
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
      {beach ? (
        <section aria-labelledby="beach-h" className={styles.beach}>
          <h2 id="beach-h">At the beach</h2>
          <BeachTiles town={town} beach={beach} sunset={null} />
          <BeachSources beach={beach} />
        </section>
      ) : null}
      {tropics ? <TropicsPanel town={town} tropics={tropics} /> : null}
    </StandardPage>
  );
}
