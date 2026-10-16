import { readFileSync } from 'node:fs';
import { tierForPopulation } from '@towncore/config';
import { Fetcher } from '@towncore/adapters';
import {
  cachedFile,
  censusFiles,
  extractZipEntry,
  parseGazetteerCounties,
  parseGazetteerPlaces,
  readPlaceCounties,
  readPopEstimates,
  type Place,
} from './census';
import { findPlace, stateFips, statePlaces, type FileOpts } from './towns-rank';

// Launch step 1 (CLAUDE.md §10): resolve the town — Census ID, county, timezone, NWS zone,
// tier, and same-name places elsewhere for the wrong-town checks. All from Census files and the
// NWS points API (both on the documented-API list); nothing is guessed.

export type ResolvedTown = {
  slug: string;
  name: string;
  state: string;
  censusId: string;
  censusName: string;
  county: string;
  timezone: string;
  tier: 'small' | 'mid' | 'large';
  population2025: number;
  lat: number;
  lon: number;
  nws: { zone: string; office: string; point: string };
  sameNameElsewhere: string[];
  /** The town government, named as the Census does ("Delray Beach city" → City of Delray Beach). */
  agencies: string[];
};

export function townSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "Delray Beach city" → "City of Delray Beach"; "Lake Park town" → "Town of Lake Park". */
export function governmentName(censusName: string, name: string): string {
  const kind = censusName.slice(name.length).trim().toLowerCase();
  const word = { city: 'City', town: 'Town', village: 'Village', borough: 'Borough' }[kind];
  return word ? `${word} of ${name}` : name;
}

export type NwsPoint = { zone: string; office: string; timezone: string };

/** The NWS forecast zone, office and timezone for a point (api.weather.gov `/points`). */
export async function nwsPoint(fetcher: Fetcher, lat: number, lon: number): Promise<NwsPoint> {
  const url = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const json = (await fetcher.getJson(url)) as {
    properties?: { forecastZone?: string; gridId?: string; timeZone?: string };
  };
  const p = json.properties;
  const zone = p?.forecastZone?.split('/').pop();
  if (!zone || !p?.gridId || !p.timeZone)
    throw new Error(`NWS has no forecast zone for ${lat},${lon}`);
  return { zone, office: p.gridId, timezone: p.timeZone };
}

export function resolveFrom(input: {
  place: Place;
  state: string;
  county: string;
  population2025: number;
  nws: NwsPoint;
  sameName: Place[];
}): ResolvedTown {
  const { place } = input;
  const point = `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  return {
    slug: townSlug(place.name),
    name: place.name,
    state: input.state,
    censusId: place.geoid,
    censusName: place.censusName,
    county: input.county,
    timezone: input.nws.timezone,
    tier: tierForPopulation(input.population2025),
    population2025: input.population2025,
    lat: place.lat,
    lon: place.lon,
    nws: { zone: input.nws.zone, office: input.nws.office, point },
    sameNameElsewhere: input.sameName
      .filter((p) => p.geoid !== place.geoid && p.name.toLowerCase() === place.name.toLowerCase())
      .map((p) => `${p.name}, ${p.state}`)
      .sort(),
    agencies: [governmentName(place.censusName, place.name)],
  };
}

/** Loads everything step 1 needs and resolves "Delray Beach, FL". */
export async function resolveTown(
  town: string,
  opts: FileOpts & { fetcher?: Fetcher } = {},
): Promise<ResolvedTown> {
  const state = town.split(',')[1]?.trim().toUpperCase();
  if (!state) throw new Error(`Give the town as "Name, ST" (got "${town}").`);
  const fips = stateFips(state);
  const fetcher = opts.fetcher ?? new Fetcher({ timeoutMs: 15 * 60_000 });
  const files = { ...opts, fetcher };
  const place = findPlace(await statePlaces(state, files), town);
  const popPath = await cachedFile(censusFiles.popEstimates, files);
  const population = (await readPopEstimates(popPath, fips)).get(place.geoid)?.pop2025;
  if (population == null) throw new Error(`No population estimate for ${place.censusName}.`);
  const countyGeoid = (await readPlaceCounties(popPath, fips)).get(place.geoid);
  const counties = parseGazetteerCounties(
    readFileSync(await cachedFile(censusFiles.counties(fips), files), 'utf8'),
  );
  const county = countyGeoid ? counties.get(countyGeoid) : undefined;
  if (!county) throw new Error(`No county found for ${place.censusName}.`);
  const national = await cachedFile(censusFiles.nationalPlaces, files);
  const nationalText = await extractZipEntry(national, national.replace(/\.zip$/, '.txt'));
  const sameName = parseGazetteerPlaces(readFileSync(nationalText, 'utf8')).filter(
    (p) => p.name.toLowerCase() === place.name.toLowerCase(),
  );
  const nws = await nwsPoint(fetcher, place.lat, place.lon);
  return resolveFrom({
    place: { ...place, state },
    state,
    county,
    population2025: population,
    nws,
    sameName,
  });
}
