import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Fetcher, replayFetch, type FixtureFile } from '@towncore/adapters';
import { loadTowns } from '@towncore/config';
import {
  claimWeatherRefresh,
  eq,
  getTownBySlug,
  getTownWeather,
  syncTowns,
  townWeather,
  WEATHER_MAX_AGE_MS,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forecastsDue, refreshTownWeather, WEATHER_FORECAST_EVERY_MS } from '@towncore/pipeline';
import { refreshWeather, weatherTargets } from '../src/weather';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const fixture: FixtureFile = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../packages/adapters/fixtures/nws/boca-weather.json', import.meta.url),
    ),
    'utf8',
  ),
);
// "Now" inside the recording: just after its first hourly period starts.
const NOW = (() => {
  const hourly = fixture.exchanges.find((e) => e.url.endsWith('/forecast/hourly'))!;
  const first = JSON.parse(hourly.body!).properties.periods[0];
  return new Date(new Date(first.startTime).getTime() + 10 * 60_000);
})();

const logger = pino({ level: 'silent' });
const fetcher = (file: FixtureFile) =>
  new Fetcher({
    fetchImpl: replayFetch(file),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });

let db: Db;
let drop: () => Promise<void>;
let townId: string;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  // Boca as configured in towns/, NWS source and its forecast point included.
  await syncTowns(
    db,
    loadTowns(townsDir).filter((t) => t.config.slug === 'boca-raton'),
  );
  townId = (await getTownBySlug(db, 'boca-raton'))!.id;
});
afterAll(async () => drop());

describe('weather refresh', () => {
  it('finds Boca by its NWS source and forecast point', async () => {
    expect(await weatherTargets(db)).toEqual([
      {
        townId,
        point: '26.3587,-80.0831',
        zone: 'FLZ168',
        beach: {
          zone: 'FLZ168',
          surfOffice: 'MFL',
          tideStation: '8722670',
          uvZip: '33432',
          timezone: 'America/New_York',
        },
      },
    ]);
  });

  it('stores a snapshot the web app can read', async () => {
    expect(await refreshWeather(db, fetcher(fixture), logger, NOW)).toEqual({
      ok: 1,
      failed: 0,
      deferred: 0,
      alertsOnly: 0,
    });
    const weather = await getTownWeather(db, townId, NOW);
    expect(weather?.snapshot.place).toBe('Boca Raton, FL');
    expect(weather?.snapshot.hours.length).toBeGreaterThan(0);
  });

  it('updates only the alerts while the forecast is fresh', async () => {
    const soon = new Date(NOW.getTime() + 15 * 60_000);
    expect(await refreshWeather(db, fetcher(fixture), logger, soon)).toEqual({
      ok: 0,
      failed: 0,
      deferred: 0,
      alertsOnly: 1,
    });
    const [row] = await db.select().from(townWeather).where(eq(townWeather.townId, townId));
    expect(row?.fetchedAt).toEqual(NOW);
    // The tile moves on with the clock: the current hour comes from the stored periods.
    const twoHours = new Date(NOW.getTime() + 2 * 3_600_000);
    const shown = await getTownWeather(db, townId, twoHours);
    expect(new Date(shown!.snapshot.now.startTime).getTime()).toBeLessThanOrEqual(
      twoHours.getTime(),
    );
    expect(new Date(shown!.snapshot.now.startTime).getTime()).toBeGreaterThan(
      twoHours.getTime() - 3_600_000,
    );
  });

  it('keeps the last good snapshot when a refresh fails, until it is too old', async () => {
    const broken: FixtureFile = { ...fixture, exchanges: [] };
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect(await refreshWeather(db, fetcher(broken), logger, later)).toEqual({
      ok: 0,
      failed: 1,
      deferred: 0,
      alertsOnly: 0,
    });
    const [row] = await db.select().from(townWeather).where(eq(townWeather.townId, townId));
    expect(row?.lastError).toMatch(/No recorded fixture/);
    expect(row?.snapshot?.upcoming?.length).toBeGreaterThan(0);
    expect(row?.fetchedAt).toEqual(NOW);
    expect(await getTownWeather(db, townId, later)).not.toBeNull();
    const stale = new Date(NOW.getTime() + WEATHER_MAX_AGE_MS + 1);
    expect(await getTownWeather(db, townId, stale)).toBeNull();
  });

  it('lets one page view refresh a stale town, at most every 10 minutes', async () => {
    const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
    // The snapshot from NOW is fresh for 30 minutes; the failed try above was at +31.
    expect(await claimWeatherRefresh(db, townId, minutes(20))).toBe(false);
    expect(await claimWeatherRefresh(db, townId, minutes(41))).toBe(false);
    expect(await claimWeatherRefresh(db, townId, minutes(42))).toBe(true);
    // Many requests at once: only the first claims it.
    expect(await claimWeatherRefresh(db, townId, minutes(43))).toBe(false);
    expect(await weatherTargets(db, townId)).toHaveLength(1);
    const [target] = await weatherTargets(db, townId);
    expect(await refreshTownWeather(db, fetcher(fixture), target!, minutes(43))).toEqual({
      ok: true,
    });
    // Fresh again: no refresh until it ages past 30 minutes.
    expect(await claimWeatherRefresh(db, townId, minutes(60))).toBe(false);
    expect(await claimWeatherRefresh(db, townId, minutes(74))).toBe(true);
  });
});

describe('forecast turns', () => {
  it('takes due towns, never fetched first, then oldest, up to the run budget', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    const towns = [
      { townId: 'fresh', fetchedAt: ago(10) },
      { townId: 'old', fetchedAt: ago(200) },
      { townId: 'new', fetchedAt: null },
      { townId: 'older', fetchedAt: ago(300) },
      { townId: 'due', fetchedAt: ago(WEATHER_FORECAST_EVERY_MS / 60_000) },
    ];
    expect(forecastsDue(towns, now, 3)).toEqual(['new', 'older', 'old']);
    expect(forecastsDue(towns, now)).toEqual(['new', 'older', 'old', 'due']);
  });
});
