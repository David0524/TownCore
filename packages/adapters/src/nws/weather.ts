import {
  advanceSnapshot,
  daysDue,
  WEATHER_DAYS_EVERY_MS,
  type ForecastPeriod,
  type SevenDayForecast,
  type WeatherAlert,
  type WeatherPeriod,
  type WeatherSnapshot,
} from '@towncore/config';
import type { Fetcher } from '../http/fetcher';

// The Today weather tile (docs/plans/M4b.md; CLAUDE.md §11a "weather above the fold"). Unlike
// the zone forecast and alerts, which become records for stories, this is display data: a small
// snapshot per town, refreshed by the worker (alerts every run, forecasts in turn under a
// per-run budget: pipeline/weather-refresh.ts). All of it comes from the
// documented NWS API (Rule 8 documented-API exception), through the polite Fetcher.

const API = 'https://api.weather.gov';
const GEOJSON = { accept: 'application/geo+json' };

/** How many hourly steps the tile shows, and how far apart (hours): from @towncore/config. */
export { HOURLY_EVERY, HOURLY_STEPS } from '@towncore/config';

type Points = {
  properties: {
    gridId: string;
    gridX: number;
    gridY: number;
    forecast: string;
    forecastHourly: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
};
type Period = {
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast?: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
  relativeHumidity?: { value: number | null } | null;
};
type Forecast = { properties: { updateTime?: string; updated?: string; periods: Period[] } };
type ActiveAlerts = {
  features: Array<{
    properties: {
      id: string;
      event: string;
      headline: string | null;
      severity: string;
      status: string;
      messageType: string;
      onset?: string | null;
      ends?: string | null;
      expires?: string | null;
      web?: string | null;
      affectedZones?: string[];
      geocode?: { UGC?: string[] };
    };
  }>;
};

/** "26.3587,-80.0831" → [lat, lon], rounded to 4 decimals as the NWS API requires. */
export function parsePoint(point: unknown): [number, number] {
  const match = typeof point === 'string' && point.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`NWS weather needs config.point like "26.3587,-80.0831"`);
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(`Point out of range: ${point}`);
  return [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4];
}

const precip = (p: Period) => p.probabilityOfPrecipitation?.value ?? null;
const period = (p: Period): WeatherPeriod => ({
  startTime: p.startTime,
  temperature: p.temperature,
  shortForecast: p.shortForecast,
  precipChance: precip(p),
  windSpeed: p.windSpeed,
  windDirection: p.windDirection,
  unit: p.temperatureUnit,
  humidity: p.relativeHumidity?.value ?? null,
  isDaytime: p.isDaytime,
});

/**
 * The 7-day forecast's 12-hour periods (`/gridpoints/.../forecast`), still running at `now`.
 * Periods without a numeric temperature are dropped. NWS's icon URLs are never kept: the site
 * draws its own (Rule 9).
 */
export function parseForecastPeriods(body: unknown, now: Date): ForecastPeriod[] {
  const raw = (body as Partial<Forecast> | null)?.properties?.periods;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => Number.isFinite(p.temperature) && new Date(p.endTime) > now)
    .map((p) => ({
      name: p.name,
      startTime: p.startTime,
      endTime: p.endTime,
      isDaytime: Boolean(p.isDaytime),
      temperature: p.temperature,
      shortForecast: p.shortForecast ?? '',
      detailedForecast: p.detailedForecast ?? '',
      precipChance: precip(p),
      windSpeed: p.windSpeed ?? '',
      windDirection: p.windDirection ?? '',
    }));
}

/** How many hourly periods a snapshot keeps (advanceSnapshot picks "now" from them). */
export const UPCOMING_HOURS = 36;
/** Zones per alerts request (the API takes a comma list). */
export const ALERT_ZONES_PER_REQUEST = 50;

/** An active alert, before it is given a town's forecast page as its fallback link. */
export type ZoneAlert = Omit<WeatherAlert, 'url'> & { url: string | null };

/** The alerts that matter for the tile: actual, not cancelled, not yet over. */
function tileAlerts(features: ActiveAlerts['features'], now: Date) {
  return features.filter(({ properties: a }) => {
    if (a.status !== 'Actual' || a.messageType === 'Cancel') return false;
    const until = a.ends ?? a.expires;
    return !until || new Date(until) > now;
  });
}

const toAlert = (a: ActiveAlerts['features'][number]['properties']): ZoneAlert => ({
  id: a.id,
  event: a.event,
  headline: a.headline,
  severity: a.severity,
  until: a.ends ?? a.expires ?? null,
  url: a.web || null,
});

/**
 * Active alerts for many forecast zones in a few requests (zones are shared by many towns): one
 * request per 50 zones, each alert filed under every requested zone it covers.
 */
export async function fetchZoneAlerts(
  fetcher: Fetcher,
  zones: string[],
  now: Date = new Date(),
): Promise<Map<string, ZoneAlert[]>> {
  const unique = [...new Set(zones)].sort();
  const out = new Map<string, ZoneAlert[]>(unique.map((z) => [z, []]));
  for (let i = 0; i < unique.length; i += ALERT_ZONES_PER_REQUEST) {
    const chunk = unique.slice(i, i + ALERT_ZONES_PER_REQUEST);
    const body = await fetcher.getJson<ActiveAlerts>(
      `${API}/alerts/active?zone=${chunk.join(',')}`,
      GEOJSON,
    );
    for (const feature of tileAlerts(body.features, now)) {
      const a = feature.properties;
      const covered = new Set([
        ...(a.geocode?.UGC ?? []),
        ...(a.affectedZones ?? []).map((u) => u.split('/').pop()!),
      ]);
      // A single-zone request names its zone, whatever the alert lists.
      const hit = chunk.length === 1 ? chunk : chunk.filter((z) => covered.has(z));
      for (const z of hit) out.get(z)!.push(toAlert(a));
    }
  }
  return out;
}

/** A zone's alerts for one town: the town's forecast page stands in for a missing link. */
export const alertsForTown = (alerts: ZoneAlert[], sourceUrl: string): WeatherAlert[] =>
  alerts.map((a) => ({ ...a, url: a.url ?? sourceUrl }));

/**
 * Fetches the tile's data for one point and NWS zone, from api.weather.gov. With the town's
 * previous snapshot its grid point and place are reused, so it's one request (the hourly
 * forecast); alerts can be passed in from fetchZoneAlerts, else they cost one more. The 7-day
 * forecast (one more request on the same grid) is fetched only when the previous one is at least
 * `daysEveryMs` old, else carried over; when it fails, the previous one is kept.
 */
export async function fetchWeather(
  fetcher: Fetcher,
  opts: { point: string; zone: string },
  now: Date = new Date(),
  cached: { previous?: WeatherSnapshot | null; alerts?: ZoneAlert[]; daysEveryMs?: number } = {},
): Promise<WeatherSnapshot> {
  const [lat, lon] = parsePoint(opts.point);
  let grid = cached.previous?.grid;
  let place = cached.previous?.place;
  if (!grid || !place) {
    const points = await fetcher.getJson<Points>(`${API}/points/${lat},${lon}`, GEOJSON);
    const { gridId, gridX, gridY, relativeLocation } = points.properties;
    grid = { office: gridId, x: gridX, y: gridY };
    const city = relativeLocation?.properties;
    place = city?.city ? `${city.city}, ${city.state}` : `${lat},${lon}`;
  }
  const hourly = await fetcher.getJson<Forecast>(
    `${API}/gridpoints/${grid.office}/${grid.x},${grid.y}/forecast/hourly`,
    GEOJSON,
  );
  const sourceUrl = pointPageUrl(lat, lon);
  const alerts =
    cached.alerts ?? (await fetchZoneAlerts(fetcher, [opts.zone], now)).get(opts.zone) ?? [];

  const upcoming = hourly.properties.periods
    .filter((p) => new Date(p.endTime) > now)
    .slice(0, UPCOMING_HOURS)
    .map(period);
  const current = upcoming[0];
  if (!current) throw new Error('NWS hourly forecast has no current period');
  let days = cached.previous?.days;
  if (daysDue(cached.previous, now, cached.daysEveryMs ?? WEATHER_DAYS_EVERY_MS)) {
    days = (await fetchSevenDay(fetcher, grid, now)) ?? days;
  }
  return advanceSnapshot(
    {
      place,
      grid,
      updatedAt: hourly.properties.updateTime ?? hourly.properties.updated ?? now.toISOString(),
      now: current,
      hours: [],
      upcoming,
      today: { name: '', high: null, low: null, shortForecast: current.shortForecast },
      alerts: alertsForTown(alerts, sourceUrl),
      sourceUrl,
      ...(days ? { days } : {}),
    },
    now,
  );
}

/** The 7-day forecast for a grid point, or null when NWS fails or sends no usable periods. */
async function fetchSevenDay(
  fetcher: Fetcher,
  grid: WeatherSnapshot['grid'],
  now: Date,
): Promise<SevenDayForecast | null> {
  try {
    const body = await fetcher.getJson<Forecast>(
      `${API}/gridpoints/${grid.office}/${grid.x},${grid.y}/forecast`,
      GEOJSON,
    );
    const periods = parseForecastPeriods(body, now);
    if (!periods.length) return null;
    return {
      updatedAt: body.properties.updateTime ?? body.properties.updated ?? now.toISOString(),
      fetchedAt: now.toISOString(),
      periods,
    };
  } catch {
    // The 7-day forecast is often briefly unavailable on NWS; the tile never waits on it.
    return null;
  }
}

/** The human-readable NWS forecast page for a point. */
export function pointPageUrl(lat: number, lon: number): string {
  return `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
}
