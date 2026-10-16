import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadTo, Fetcher, parseCsvLine } from '@towncore/adapters';
import { Unzip, UnzipInflate } from 'fflate';

// Census bulk files for ranking towns (CLAUDE.md §10a; docs/plans/M7.md §1). All come from
// www2.census.gov, whose robots.txt allows us, and need no API key: the Data API now requires
// one, the published files don't. Each is downloaded once (1 request/second through the
// Fetcher) and cached on disk; nothing here is per-request.

export const CENSUS_ATTRIBUTION =
  'Source: U.S. Census Bureau: 2026 Gazetteer, Vintage 2025 population estimates, 2020–2024 American Community Survey 5-year estimates, 2023 ZIP Code Business Patterns and the 2020 ZCTA-to-place relationship file.';

const WWW2 = 'https://www2.census.gov';

export const censusFiles = {
  gazetteer: (fips: string) =>
    `${WWW2}/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_place_${fips}.txt`,
  popEstimates: `${WWW2}/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv`,
  acsTable: (table: string) =>
    `${WWW2}/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-${table}.dat`,
  zctaPlace: `${WWW2}/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt`,
  zipBusiness: `${WWW2}/programs-surveys/cbp/datasets/2023/zbp23detail.zip`,
  nationalPlaces: `${WWW2}/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_place_national.zip`,
  counties: (fips: string) =>
    `${WWW2}/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_counties_${fips}.txt`,
} as const;

export const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21',
  LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30',
  NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
  VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
}; // prettier-ignore

export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../../.cache/census', import.meta.url));
/** Cached files older than this are fetched again (the sources change yearly at most). */
const MAX_AGE_MS = 90 * 86_400_000;

/** The local path of a Census file, downloading it once into the cache. */
export async function cachedFile(
  url: string,
  opts: { cacheDir?: string; fetcher?: Fetcher; now?: Date } = {},
): Promise<string> {
  const dir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const path = join(dir, url.split('/').pop()!);
  const now = opts.now ?? new Date();
  if (existsSync(path) && now.getTime() - statSync(path).mtimeMs < MAX_AGE_MS) return path;
  mkdirSync(dirname(path), { recursive: true });
  const fetcher = opts.fetcher ?? new Fetcher({ timeoutMs: 15 * 60_000 });
  await downloadTo(fetcher, url, `${path}.part`);
  const { rename } = await import('node:fs/promises');
  await rename(`${path}.part`, path);
  return path;
}

/** Extracts one entry of a zip file to disk, streaming (the ZIP business file is ~290 MB). */
export async function extractZipEntry(zipPath: string, dest: string): Promise<string> {
  if (existsSync(dest)) return dest;
  const out = createWriteStream(`${dest}.part`);
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip((file) => {
      file.ondata = (error, chunk, final) => {
        if (error) return reject(error);
        out.write(chunk);
        if (final) out.end(resolve);
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    const input = createReadStream(zipPath);
    input.on('data', (chunk) => unzip.push(chunk as Uint8Array));
    input.on('end', () => unzip.push(new Uint8Array(0), true));
    input.on('error', reject);
  });
  const { rename } = await import('node:fs/promises');
  await rename(`${dest}.part`, dest);
  return dest;
}

async function* lines(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) yield line.replace(/^\uFEFF/, '');
}

export type Place = {
  geoid: string;
  /** Two-letter state (the Gazetteer's USPS column). */
  state?: string;
  /** "Delray Beach" (the Census name without its "city"/"town"/"village" suffix). */
  name: string;
  censusName: string;
  lat: number;
  lon: number;
  landSqMi: number;
};

const SUFFIX = /\s+(city|town|village|borough|municipality|township|city and borough)$/i;

/** Incorporated places (FUNCSTAT A) from a Gazetteer state file. */
export function parseGazetteerPlaces(text: string): Place[] {
  const [header, ...rows] = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  const col = Object.fromEntries(header!.split('|').map((h, i) => [h.trim(), i]));
  return rows
    .map((row) => row.split('|').map((v) => v.trim()))
    .filter((f) => f[col.FUNCSTAT!] === 'A')
    .map((f) => ({
      geoid: f[col.GEOID!]!,
      state: f[col.USPS!]!,
      censusName: f[col.NAME!]!,
      name: f[col.NAME!]!.replace(SUFFIX, ''),
      lat: Number(f[col.INTPTLAT!]),
      lon: Number(f[col.INTPTLONG!]),
      landSqMi: Number(f[col.ALAND_SQMI!]),
    }));
}

export type PopEstimate = { base2020: number; pop2025: number };

/** Incorporated-place totals (SUMLEV 162) from the Vintage 2025 subcounty estimates. */
export async function readPopEstimates(path: string, fips: string) {
  const out = new Map<string, PopEstimate>();
  let col: Record<string, number> | null = null;
  for await (const line of lines(path)) {
    const f = parseCsvLine(line);
    if (!col) {
      col = Object.fromEntries(f.map((h, i) => [h, i]));
      continue;
    }
    if (f[col.SUMLEV!] !== '162' || f[col.STATE!] !== fips) continue;
    out.set(`${fips}${f[col.PLACE!]}`, {
      base2020: Number(f[col.ESTIMATESBASE2020!]),
      pop2025: Number(f[col.POPESTIMATE2025!]),
    });
  }
  return out;
}

/**
 * One ACS summary-file table for a state's places: GEO_ID `1600000US{geoid}` → estimate columns.
 * Census writes negative sentinels (−666666666 and the like) for unavailable values; those read
 * as null.
 */
export async function readAcsPlaces(path: string, fips: string, columns: string[]) {
  const prefix = `1600000US${fips}`;
  const out = new Map<string, Array<number | null>>();
  let idx: number[] | null = null;
  for await (const line of lines(path)) {
    const f = line.split('|');
    if (!idx) {
      idx = columns.map((c) => {
        const i = f.indexOf(c);
        if (i < 0) throw new Error(`ACS column ${c} not in ${path}`);
        return i;
      });
      continue;
    }
    if (!f[0]!.startsWith(prefix)) continue;
    out.set(
      f[0]!.slice('1600000US'.length),
      idx.map((i) => {
        const n = Number(f[i]);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }),
    );
  }
  return out;
}

export type ZctaPart = { zcta: string; place: string; zctaLand: number; partLand: number };

/** ZIP areas (ZCTAs) overlapping a state's places, with the land each shares. */
export async function readZctaPlaces(path: string, fips: string): Promise<ZctaPart[]> {
  const out: ZctaPart[] = [];
  let col: Record<string, number> | null = null;
  for await (const line of lines(path)) {
    const f = line.split('|');
    if (!col) {
      col = Object.fromEntries(f.map((h, i) => [h, i]));
      continue;
    }
    const zcta = f[col.GEOID_ZCTA5_20!];
    const place = f[col.GEOID_PLACE_20!];
    if (!zcta || !place?.startsWith(fips)) continue;
    out.push({
      zcta,
      place,
      zctaLand: Number(f[col.AREALAND_ZCTA5_20!]),
      partLand: Number(f[col.AREALAND_PART!]),
    });
  }
  return out;
}

/** Establishments by ZIP for the given 4-digit NAICS codes, for one state. */
export async function readZipBusiness(path: string, state: string, naics: string[]) {
  const wanted = new Set(naics.map((n) => `${n}//`));
  const out = new Map<string, Map<string, number>>();
  let col: Record<string, number> | null = null;
  for await (const line of lines(path)) {
    // A cheap pre-filter before parsing: every wanted row names the state and a code.
    if (col && !line.includes(`"${state}"`)) continue;
    const f = parseCsvLine(line);
    if (!col) {
      col = Object.fromEntries(f.map((h, i) => [h, i]));
      continue;
    }
    if (f[col.stabbr!] !== state || !wanted.has(f[col.naics!]!)) continue;
    const zip = f[col.zip!]!;
    const byCode = out.get(zip) ?? new Map<string, number>();
    byCode.set(f[col.naics!]!.slice(0, 4), Number(f[col.est!]) || 0);
    out.set(zip, byCode);
  }
  return out;
}

/** County GEOID → name without "County"/"Parish" (Gazetteer counties file: "Palm Beach County"). */
export function parseGazetteerCounties(text: string): Map<string, string> {
  const [header, ...rows] = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  const col = Object.fromEntries(header!.split('|').map((h, i) => [h.trim(), i]));
  return new Map(
    rows.map((row) => {
      const f = row.split('|').map((v) => v.trim());
      return [f[col.GEOID!]!, f[col.NAME!]!.replace(/\s+(County|Parish|Borough|Census Area)$/, '')];
    }),
  );
}

/**
 * The county holding most of a place's people, from the population estimates' place-by-county
 * rows (SUMLEV 157): place GEOID → county GEOID.
 */
export async function readPlaceCounties(path: string, fips: string) {
  const best = new Map<string, { county: string; pop: number }>();
  let col: Record<string, number> | null = null;
  for await (const line of lines(path)) {
    const f = parseCsvLine(line);
    if (!col) {
      col = Object.fromEntries(f.map((h, i) => [h, i]));
      continue;
    }
    if (f[col.SUMLEV!] !== '157' || f[col.STATE!] !== fips) continue;
    const place = `${fips}${f[col.PLACE!]}`;
    const pop = Number(f[col.POPESTIMATE2025!]);
    if ((best.get(place)?.pop ?? -1) < pop)
      best.set(place, { county: `${fips}${f[col.COUNTY!]}`, pop });
  }
  return new Map([...best].map(([place, v]) => [place, v.county]));
}
