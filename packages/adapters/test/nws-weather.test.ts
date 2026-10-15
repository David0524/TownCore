import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch, type FixtureFile } from '../src/http/fixtures';
import { fetchWeather, HOURLY_STEPS, parsePoint } from '../src/nws/weather';

// Recorded live from api.weather.gov for Boca Raton (point 26.3587,-80.0831, zone FLZ168).
const fixture: FixtureFile = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/nws/boca-weather.json', import.meta.url)),
    'utf8',
  ),
);
const opts = { point: '26.3587,-80.0831', zone: 'FLZ168' };
const hourlyUrl = 'https://api.weather.gov/gridpoints/MFL/111,77/forecast/hourly';
const alertsUrl = 'https://api.weather.gov/alerts/active?zone=FLZ168';

/** The fixture's first hourly period start: "now" for the tests. */
const recordedNow = (() => {
  const hourly = fixture.exchanges.find((e) => e.url === hourlyUrl)!;
  const first = JSON.parse(hourly.body!).properties.periods[0];
  return new Date(new Date(first.startTime).getTime() + 10 * 60_000);
})();

const fetcherFor = (file: FixtureFile) =>
  new Fetcher({
    fetchImpl: replayFetch(file),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });

function withAlerts(features: unknown[]): FixtureFile {
  return {
    ...fixture,
    exchanges: fixture.exchanges.map((e) =>
      e.url === alertsUrl ? { ...e, body: JSON.stringify({ features }) } : e,
    ),
  };
}

const alert = (props: Record<string, unknown>) => ({
  properties: {
    id: 'urn:oid:test',
    event: 'Rip Current Statement',
    headline: 'Rip Current Statement issued for Palm Beach County beaches',
    severity: 'Moderate',
    status: 'Actual',
    messageType: 'Alert',
    ends: new Date(recordedNow.getTime() + 3_600_000).toISOString(),
    web: null,
    ...props,
  },
});

describe('NWS weather snapshot', () => {
  it('builds the tile from the hourly and 12-hour forecasts', async () => {
    const w = await fetchWeather(fetcherFor(fixture), opts, recordedNow);
    expect(w.place).toBe('Boca Raton, FL');
    expect(w.grid).toEqual({ office: 'MFL', x: 111, y: 77 });
    expect(w.now.unit).toBe('F');
    expect(Number.isInteger(w.now.temperature)).toBe(true);
    expect(w.now.shortForecast).toBeTruthy();
    expect(w.hours).toHaveLength(HOURLY_STEPS);
    // Two hours apart, starting with the current hour.
    expect(w.hours[0]!.startTime).toBe(w.now.startTime);
    const gap =
      new Date(w.hours[1]!.startTime).getTime() - new Date(w.hours[0]!.startTime).getTime();
    expect(gap).toBe(2 * 3_600_000);
    expect(w.today.high ?? w.today.low).not.toBeNull();
    expect(w.sourceUrl).toBe('https://forecast.weather.gov/MapClick.php?lat=26.3587&lon=-80.0831');
  });

  it('keeps only actual, unexpired, uncancelled alerts', async () => {
    const past = new Date(recordedNow.getTime() - 60_000).toISOString();
    const w = await fetchWeather(
      fetcherFor(
        withAlerts([
          alert({ id: 'active' }),
          alert({ id: 'ended', ends: past }),
          alert({ id: 'cancel', messageType: 'Cancel' }),
          alert({ id: 'test', status: 'Test' }),
          alert({ id: 'no-end', ends: null, expires: null }),
        ]),
      ),
      opts,
      recordedNow,
    );
    expect(w.alerts.map((a) => a.id)).toEqual(['active', 'no-end']);
    expect(w.alerts[0]).toMatchObject({ event: 'Rip Current Statement', severity: 'Moderate' });
    expect(w.alerts[0]!.url).toBe(w.sourceUrl);
  });

  it('parses and validates the point', () => {
    expect(parsePoint('26.35871,-80.08312')).toEqual([26.3587, -80.0831]);
    expect(() => parsePoint('Boca Raton')).toThrow(/point/);
    expect(() => parsePoint(undefined)).toThrow(/point/);
    expect(() => parsePoint('126,-80')).toThrow(/range/);
  });
});
