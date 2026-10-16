import type { BeachConditions } from '@towncore/config';
import type { Fetcher } from '../http/fetcher';

// Beach conditions for coastal towns' Today tiles (docs/plans/M4b.md; D-M4b-3, owner approved
// the sources 2026-10-16). Three public sources, each fetched and failing independently:
// - NWS surf zone forecast (api.weather.gov, already on the documented-API allowlist):
//   rip current risk and surf height for the town's zone.
// - NOAA CO-OPS (api.tidesandcurrents.noaa.gov): water temperature and tide predictions.
//   Public domain; NOAA asks for attribution and an `application` name on each request.
// - EPA Envirofacts (data.epa.gov): today's UV index for a ZIP code.

export type BeachConfig = {
  /** NWS office issuing the surf zone forecast, e.g. "MFL". */
  surfOffice?: string;
  /** NWS zone the forecast segment is for, e.g. "FLZ168". */
  zone: string;
  /** NOAA CO-OPS station for water temperature and tides, e.g. "8722670". */
  tideStation?: string;
  /** ZIP code for the EPA UV index, e.g. "33432". */
  uvZip?: string;
  /** The town's IANA timezone: UV and surf forecasts count only for the town's local today. */
  timezone: string;
};

const NWS = 'https://api.weather.gov';
const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const UV = 'https://data.epa.gov/dmapservice/getEnvirofactsUVDAILY/ZIP';
const APPLICATION = 'TownCore';
/** Water temperature older than this is dropped. */
const WATER_MAX_AGE_MS = 3 * 3_600_000;

/** Reads the beach options from an NWS source's config; null when the town has none. */
export function beachConfig(config: Record<string, unknown>): BeachConfig | null {
  const str = (key: string) =>
    typeof config[key] === 'string' ? (config[key] as string) : undefined;
  const zone = str('zone');
  const surfOffice = str('surf_office');
  const tideStation = str('tide_station');
  const uvZip = str('uv_zip');
  if (!zone || (!surfOffice && !tideStation && !uvZip)) return null;
  return { zone, surfOffice, tideStation, uvZip, timezone: str('timezone') ?? 'UTC' };
}

export async function fetchBeach(
  fetcher: Fetcher,
  config: BeachConfig,
  now: Date = new Date(),
): Promise<BeachConditions> {
  const settle = async <T>(job: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await job();
    } catch {
      return null;
    }
  };
  // Sequential on purpose: the Fetcher paces requests per host anyway.
  const surf = config.surfOffice ? await settle(() => fetchSurf(fetcher, config, now)) : null;
  const water = config.tideStation
    ? await settle(() => fetchWater(fetcher, config.tideStation!, now))
    : null;
  const tides = config.tideStation
    ? await settle(() => fetchTides(fetcher, config.tideStation!, now))
    : null;
  const uv = config.uvZip
    ? await settle(() => fetchUv(fetcher, config.uvZip!, now, config.timezone))
    : null;
  return { surf, water, tides, uv };
}

// --- NWS surf zone forecast -------------------------------------------------------------------

type ProductList = { '@graph': Array<{ id: string; issuanceTime: string }> };
type Product = { id: string; issuanceTime: string; productText: string };

async function fetchSurf(fetcher: Fetcher, config: BeachConfig, now: Date) {
  const list = await fetcher.getJson<ProductList>(
    `${NWS}/products/types/SRF/locations/${config.surfOffice}`,
    { accept: 'application/ld+json' },
  );
  const latest = list['@graph'][0];
  if (!latest) return null;
  // Only a forecast issued on the town's local today describes today.
  if (localDate(new Date(latest.issuanceTime), config.timezone) !== localDate(now, config.timezone))
    return null;
  const product = await fetcher.getJson<Product>(`${NWS}/products/${latest.id}`, {
    accept: 'application/ld+json',
  });
  const segment = parseSurfSegment(product.productText, config.zone);
  if (!segment) return null;
  return {
    ...segment,
    issuedAt: product.issuanceTime,
    office: config.surfOffice!,
    url: `https://forecast.weather.gov/product.php?site=${config.surfOffice}&issuedby=${config.surfOffice}&product=SRF`,
  };
}

/** True when a UGC zone line ("FLZ168-172-", "FLZ168>170-") covers the zone ("FLZ168"). */
export function ugcCovers(ugc: string, zone: string): boolean {
  const state = zone.slice(0, 3);
  const number = Number(zone.slice(3));
  if (!ugc.startsWith(state)) return false;
  const body = ugc
    .slice(3)
    .split('-')
    .filter((part) => /^\d{3}(>\d{3})?$/.test(part));
  return body.some((part) => {
    const [from, to] = part.split('>').map(Number);
    return to === undefined ? from === number : number >= from! && number <= to;
  });
}

/**
 * The first forecast period of the zone's segment in an SRF product: its name ("Rest of
 * today"), rip current risk and surf height, as NWS wrote them.
 */
export function parseSurfSegment(
  text: string,
  zone: string,
): { period: string; ripRisk: string; surfHeight: string | null } | null {
  const segments = text.split(/^\$\$\s*$/m);
  const segment = segments.find((s) => {
    const ugc = s
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^[A-Z]{2}Z\d{3}/.test(l));
    return ugc ? ugcCovers(ugc, zone) : false;
  });
  if (!segment) return null;
  const periodMatch = segment.match(/^\.([A-Z][A-Z .]+?)\.\.\.\s*$/m);
  if (!periodMatch) return null;
  const firstPeriod =
    segment.slice(periodMatch.index!).split(/^\.[A-Z][A-Z .]+?\.\.\.\s*$/m)[1] ?? '';
  const field = (label: string) =>
    firstPeriod
      .match(new RegExp(`^${label}\\*?\\.+(.+)$`, 'm'))?.[1]
      ?.trim()
      .replace(/\.$/, '') ?? null;
  const ripRisk = field('Rip Current Risk');
  if (!ripRisk) return null;
  return {
    period: sentence(periodMatch[1]!.trim()),
    ripRisk,
    surfHeight: field('Surf Height'),
  };
}

/** "2026-10-15" in the given timezone. */
export const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// --- NOAA CO-OPS ------------------------------------------------------------------------------

type CoopsMeta = { id: string; name: string };
type WaterResponse = {
  metadata?: CoopsMeta;
  data?: Array<{ t: string; v: string }>;
  error?: unknown;
};
type TideResponse = {
  predictions?: Array<{ t: string; v: string; type: 'H' | 'L' }>;
  error?: unknown;
};

/** CO-OPS times with time_zone=gmt look like "2026-10-15 23:54". */
const coopsTime = (t: string) => new Date(`${t.replace(' ', 'T')}:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function fetchWater(fetcher: Fetcher, station: string, now: Date) {
  const res = await fetcher.getJson<WaterResponse>(
    `${COOPS}?product=water_temperature&station=${station}&date=latest&units=english&time_zone=gmt&format=json&application=${APPLICATION}`,
  );
  const latest = res.data?.[0];
  if (!latest || !res.metadata) return null;
  const at = coopsTime(latest.t);
  const fahrenheit = Number(latest.v);
  if (!Number.isFinite(fahrenheit) || now.getTime() - at.getTime() > WATER_MAX_AGE_MS) return null;
  return {
    fahrenheit: Math.round(fahrenheit),
    at: at.toISOString(),
    station,
    stationName: res.metadata.name,
  };
}

async function fetchTides(fetcher: Fetcher, station: string, now: Date) {
  const begin = new Date(now.getTime() - 24 * 3_600_000);
  const res = await fetcher.getJson<TideResponse>(
    `${COOPS}?product=predictions&interval=hilo&datum=MLLW&begin_date=${ymd(begin)}&range=72&station=${station}&time_zone=gmt&units=english&format=json&application=${APPLICATION}`,
  );
  const next = (res.predictions ?? [])
    .map((p) => ({
      type: p.type === 'H' ? ('high' as const) : ('low' as const),
      at: coopsTime(p.t),
    }))
    .filter((p) => p.at > now)
    .slice(0, 2)
    .map((p) => ({ type: p.type, at: p.at.toISOString() }));
  if (next.length === 0) return null;
  // The water temperature response carries the station name; predictions don't.
  return { next, station, stationName: STATION_NAMES[station] ?? `NOAA station ${station}` };
}

/** Names of the stations in use, as NOAA lists them (the predictions API omits them). */
const STATION_NAMES: Record<string, string> = {
  '8722670': 'Lake Worth Pier, Atlantic Ocean',
};

// --- EPA UV index -----------------------------------------------------------------------------

type UvRow = { ZIP_CODE: string; UV_INDEX: string; DATE: string };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function fetchUv(fetcher: Fetcher, zip: string, now: Date, timezone: string) {
  const rows = await fetcher.getJson<UvRow[]>(`${UV}/${zip}/JSON`);
  const row = rows[0];
  if (!row) return null;
  // "Oct/15/2026". EPA rolls over to tomorrow's forecast in the US evening; only the town's
  // local today counts.
  const [mon, day, year] = row.DATE.split('/');
  const date = `${year}-${String(MONTHS.indexOf(mon!) + 1).padStart(2, '0')}-${day}`;
  const index = Number(row.UV_INDEX);
  if (!Number.isFinite(index) || date !== localDate(now, timezone)) return null;
  return { index, zip, date };
}
