import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch, type FixtureFile } from '../src/http/fixtures';
import {
  fetchWeather,
  fetchZoneAlerts,
  HOURLY_STEPS,
  parsePoint,
  UPCOMING_HOURS,
} from '../src/nws/weather';

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

const fetcherFor = (file: FixtureFile, urls: string[] = []) =>
  new Fetcher({
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      return replayFetch(file)(url, init);
    },
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
  it('builds the tile from the hourly forecast alone', async () => {
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
    // The next 36 hours are kept, so the site can pick the current hour when it shows the tile.
    expect(w.upcoming).toHaveLength(UPCOMING_HOURS);
    expect(w.upcoming![0]!.startTime).toBe(w.now.startTime);
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

  it('reuses the grid point from the previous snapshot: one request with batched alerts', async () => {
    const first = await fetchWeather(fetcherFor(fixture), opts, recordedNow);
    const urls: string[] = [];
    const again = await fetchWeather(fetcherFor(fixture, urls), opts, recordedNow, {
      previous: first,
      alerts: [],
    });
    expect(urls.filter((u) => u.startsWith('https://api.weather.gov/'))).toEqual([hourlyUrl]);
    expect(again.place).toBe('Boca Raton, FL');
    expect(again.grid).toEqual(first.grid);
  });

  it('fetches alerts for many zones in batches and files each under the zones it covers', async () => {
    const zones = Array.from({ length: 60 }, (_, i) => `FLZ${String(100 + i)}`);
    const urls: string[] = [];
    const fetcher = new Fetcher({
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
        const asked = new URL(String(url)).searchParams.get('zone')!.split(',');
        const features = asked.includes('FLZ101')
          ? [
              alert({ id: 'a', geocode: { UGC: ['FLZ101', 'FLZ102'] } }),
              alert({
                id: 'b',
                affectedZones: ['https://api.weather.gov/zones/forecast/FLZ120'],
              }),
              alert({ id: 'gone', messageType: 'Cancel', geocode: { UGC: ['FLZ101'] } }),
            ]
          : [];
        return new Response(JSON.stringify({ features }), {
          headers: { 'content-type': 'application/geo+json' },
        });
      },
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    const byZone = await fetchZoneAlerts(fetcher, [...zones, 'FLZ101'], recordedNow);
    const alertCalls = urls.filter((u) => u.includes('/alerts/active'));
    expect(alertCalls).toHaveLength(2);
    expect(new URL(alertCalls[0]!).searchParams.get('zone')!.split(',')).toHaveLength(50);
    expect(byZone.get('FLZ101')!.map((a) => a.id)).toEqual(['a']);
    expect(byZone.get('FLZ102')!.map((a) => a.id)).toEqual(['a']);
    expect(byZone.get('FLZ120')!.map((a) => a.id)).toEqual(['b']);
    expect(byZone.get('FLZ103')).toEqual([]);
    // No link in the alert: the town's forecast page is used later (alertsForTown).
    expect(byZone.get('FLZ101')![0]!.url).toBeNull();
  });

  it('parses and validates the point', () => {
    expect(parsePoint('26.35871,-80.08312')).toEqual([26.3587, -80.0831]);
    expect(() => parsePoint('Boca Raton')).toThrow(/point/);
    expect(() => parsePoint(undefined)).toThrow(/point/);
    expect(() => parsePoint('126,-80')).toThrow(/range/);
  });
});
