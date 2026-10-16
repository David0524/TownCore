import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { documentedApi } from '../src/http/policy';
import { replayFetch, type FixtureFile } from '../src/http/fixtures';
import { beachConfig, fetchBeach, parseSurfSegment, ugcCovers } from '../src/nws/beach';

// Recorded live on 2026-10-16 00:02 UTC (8:02 p.m. Oct. 15 in Boca Raton): NWS Miami's surf zone
// forecast, NOAA CO-OPS station 8722670 (Lake Worth Pier) and the EPA UV index for ZIP 33432.
const fixture: FixtureFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/nws/boca-beach.json', import.meta.url)), 'utf8'),
);
const config = {
  zone: 'FLZ168',
  surfOffice: 'MFL',
  tideStation: '8722670',
  uvZip: '33432',
  timezone: 'America/New_York',
};
const NOW = new Date('2026-10-16T00:00:00Z');
const UV_URL = 'https://data.epa.gov/dmapservice/getEnvirofactsUVDAILY/ZIP/33432/JSON';

const fetcherFor = (file: FixtureFile) =>
  new Fetcher({
    fetchImpl: replayFetch(file),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
const srfText = () =>
  JSON.parse(fixture.exchanges.find((e) => e.url.includes('/products/3'))!.body!).productText;

describe('surf zone forecast parsing', () => {
  it('matches UGC zone lists and ranges', () => {
    expect(ugcCovers('FLZ168-160900-', 'FLZ168')).toBe(true);
    expect(ugcCovers('FLZ172-173-168-160900-', 'FLZ168')).toBe(true);
    expect(ugcCovers('FLZ165>170-160900-', 'FLZ168')).toBe(true);
    expect(ugcCovers('FLZ172-173-160900-', 'FLZ168')).toBe(false);
    expect(ugcCovers('GAZ168-160900-', 'FLZ168')).toBe(false);
  });

  it("reads the zone's first period as NWS wrote it", () => {
    expect(parseSurfSegment(srfText(), 'FLZ168')).toEqual({
      period: 'Rest of today',
      ripRisk: 'Moderate',
      surfHeight: 'Around 1 foot',
    });
    expect(parseSurfSegment(srfText(), 'FLZ999')).toBeNull();
  });
});

describe('beach conditions', () => {
  it('reads the options from an NWS source and skips towns without beach sources', () => {
    expect(
      beachConfig({
        zone: 'FLZ168',
        surf_office: 'MFL',
        tide_station: '8722670',
        uv_zip: '33432',
        timezone: 'America/New_York',
      }),
    ).toEqual(config);
    expect(beachConfig({ zone: 'FLZ168', timezone: 'America/New_York' })).toBeNull();
  });

  it('builds every part from the recorded sources', async () => {
    const beach = await fetchBeach(fetcherFor(fixture), config, NOW);
    expect(beach.surf).toMatchObject({
      ripRisk: 'Moderate',
      surfHeight: 'Around 1 foot',
      office: 'MFL',
    });
    expect(beach.water).toEqual({
      fahrenheit: 86,
      at: '2026-10-15T23:54:00.000Z',
      station: '8722670',
      stationName: 'Lake Worth Pier, Atlantic Ocean',
    });
    expect(beach.tides?.next).toHaveLength(2);
    expect(beach.tides!.next.every((t) => new Date(t.at) > NOW)).toBe(true);
    expect(beach.tides!.next.map((t) => t.type).sort()).toEqual(['high', 'low']);
  });

  it("shows UV only for the town's local today (EPA rolls over in the evening)", async () => {
    // Recorded at 8 p.m. local, when EPA already served Oct. 16.
    expect((await fetchBeach(fetcherFor(fixture), config, NOW)).uv).toBeNull();
    const today: FixtureFile = {
      ...fixture,
      exchanges: fixture.exchanges.map((e) =>
        e.url === UV_URL
          ? {
              ...e,
              body: JSON.stringify([{ ZIP_CODE: '33432', UV_INDEX: '8', DATE: 'Oct/15/2026' }]),
            }
          : e,
      ),
    };
    expect((await fetchBeach(fetcherFor(today), config, NOW)).uv).toEqual({
      index: 8,
      zip: '33432',
      date: '2026-10-15',
    });
  });

  it('drops a stale water reading and a surf forecast from an earlier day', async () => {
    const nextMorning = new Date('2026-10-16T13:00:00Z');
    const beach = await fetchBeach(fetcherFor(fixture), config, nextMorning);
    expect(beach.water).toBeNull();
    expect(beach.surf).toBeNull();
  });

  it('one failing source leaves the others', async () => {
    const noNoaa: FixtureFile = {
      ...fixture,
      exchanges: fixture.exchanges.filter((e) => !e.url.includes('tidesandcurrents')),
    };
    const beach = await fetchBeach(fetcherFor(noNoaa), config, NOW);
    expect(beach.water).toBeNull();
    expect(beach.tides).toBeNull();
    expect(beach.surf?.ripRisk).toBe('Moderate');
  });

  it('every host it calls is on the documented-API allowlist (owner approved 2026-10-16)', () => {
    for (const e of fixture.exchanges) expect(documentedApi(new URL(e.url)), e.url).not.toBeNull();
  });
});
