import type { Metadata } from 'next';
import { apDate } from '@towncore/pipeline';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { townForecast } from '@/modules/data';
import styles from './weather.module.css';

export const metadata: Metadata = { title: 'Weather', alternates: { canonical: '/weather' } };

/**
 * The 7-day forecast (the quick-links bar's Weather), as the National Weather Service wrote it
 * for the town's forecast zone, with its source and time. Nothing invented: no forecast in the
 * last two days, no periods.
 */
export default async function WeatherPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const forecast = await townForecast(town.id);
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
    </StandardPage>
  );
}
