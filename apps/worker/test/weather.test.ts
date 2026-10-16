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
import { refreshTownWeather } from '@towncore/pipeline';
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
    expect(await refreshWeather(db, fetcher(fixture), logger, NOW)).toEqual({ ok: 1, failed: 0 });
    const weather = await getTownWeather(db, townId, NOW);
    expect(weather?.snapshot.place).toBe('Boca Raton, FL');
    expect(weather?.snapshot.hours.length).toBeGreaterThan(0);
  });

  it('keeps the last good snapshot when a refresh fails, until it is too old', async () => {
    const broken: FixtureFile = { ...fixture, exchanges: [] };
    const later = new Date(NOW.getTime() + 15 * 60_000);
    expect(await refreshWeather(db, fetcher(broken), logger, later)).toEqual({ ok: 0, failed: 1 });
    const [row] = await db.select().from(townWeather).where(eq(townWeather.townId, townId));
    expect(row?.lastError).toMatch(/No recorded fixture/);
    expect(row?.fetchedAt).toEqual(NOW);
    expect(await getTownWeather(db, townId, later)).not.toBeNull();
    const stale = new Date(NOW.getTime() + WEATHER_MAX_AGE_MS + 1);
    expect(await getTownWeather(db, townId, stale)).toBeNull();
  });

  it('lets one page view refresh a stale town, at most every 10 minutes', async () => {
    const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
    // The snapshot from NOW is fresh for 30 minutes; the failed try above was at +15.
    expect(await claimWeatherRefresh(db, townId, minutes(20))).toBe(false);
    expect(await claimWeatherRefresh(db, townId, minutes(31))).toBe(true);
    // Many requests at once: only the first claims it.
    expect(await claimWeatherRefresh(db, townId, minutes(32))).toBe(false);
    expect(await weatherTargets(db, townId)).toHaveLength(1);
    const [target] = await weatherTargets(db, townId);
    expect(await refreshTownWeather(db, fetcher(fixture), target!, minutes(32))).toEqual({
      ok: true,
    });
    // Fresh again: no refresh until it ages past 30 minutes.
    expect(await claimWeatherRefresh(db, townId, minutes(50))).toBe(false);
    expect(await claimWeatherRefresh(db, townId, minutes(63))).toBe(true);
  });
});
