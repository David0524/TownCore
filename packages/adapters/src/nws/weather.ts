import type { WeatherHour, WeatherSnapshot } from '@towncore/config';
import type { Fetcher } from '../http/fetcher';

// The Today weather tile (docs/plans/M4b.md; CLAUDE.md §11a "weather above the fold"). Unlike
// the zone forecast and alerts, which become records for stories, this is display data: a small
// snapshot per town, refreshed every 15 minutes by the worker. All of it comes from the
// documented NWS API (Rule 8 documented-API exception), through the polite Fetcher.

const API = 'https://api.weather.gov';
const GEOJSON = { accept: 'application/geo+json' };

/** How many hourly steps the tile shows, and how far apart (hours). */
export const HOURLY_STEPS = 6;
export const HOURLY_EVERY = 2;

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
  probabilityOfPrecipitation?: { value: number | null } | null;
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
const hour = (p: Period): WeatherHour => ({
  startTime: p.startTime,
  temperature: p.temperature,
  shortForecast: p.shortForecast,
  precipChance: precip(p),
});

/** Fetches the tile's data for one point and NWS zone. Four requests, all to api.weather.gov. */
export async function fetchWeather(
  fetcher: Fetcher,
  opts: { point: string; zone: string },
  now: Date = new Date(),
): Promise<WeatherSnapshot> {
  const [lat, lon] = parsePoint(opts.point);
  const points = await fetcher.getJson<Points>(`${API}/points/${lat},${lon}`, GEOJSON);
  const { gridId, gridX, gridY, relativeLocation } = points.properties;
  const hourly = await fetcher.getJson<Forecast>(points.properties.forecastHourly, GEOJSON);
  const daily = await fetcher.getJson<Forecast>(points.properties.forecast, GEOJSON);
  const alerts = await fetcher.getJson<ActiveAlerts>(
    `${API}/alerts/active?zone=${opts.zone}`,
    GEOJSON,
  );

  const periods = hourly.properties.periods;
  const current =
    periods.find((p) => new Date(p.endTime) > now && new Date(p.startTime) <= now) ??
    periods.find((p) => new Date(p.endTime) > now);
  if (!current) throw new Error('NWS hourly forecast has no current period');
  const start = periods.indexOf(current);
  const hours = Array.from(
    { length: HOURLY_STEPS },
    (_, i) => periods[start + i * HOURLY_EVERY],
  ).filter((p): p is Period => p !== undefined);

  const [first, second] = daily.properties.periods;
  const day = [first, second].find((p) => p?.isDaytime);
  const night = [first, second].find((p) => p && !p.isDaytime);

  const city = relativeLocation?.properties;
  return {
    place: city?.city ? `${city.city}, ${city.state}` : `${lat},${lon}`,
    grid: { office: gridId, x: gridX, y: gridY },
    updatedAt: hourly.properties.updateTime ?? hourly.properties.updated ?? now.toISOString(),
    now: {
      ...hour(current),
      windSpeed: current.windSpeed,
      windDirection: current.windDirection,
      unit: current.temperatureUnit,
    },
    hours: hours.map(hour),
    today: {
      name: first?.name ?? '',
      high: day?.temperature ?? null,
      low: night?.temperature ?? null,
      shortForecast: first?.shortForecast ?? current.shortForecast,
    },
    alerts: alerts.features
      .map((f) => f.properties)
      .filter((a) => a.status === 'Actual' && a.messageType !== 'Cancel')
      .filter((a) => {
        const until = a.ends ?? a.expires;
        return !until || new Date(until) > now;
      })
      .map((a) => ({
        id: a.id,
        event: a.event,
        headline: a.headline,
        severity: a.severity,
        until: a.ends ?? a.expires ?? null,
        url: a.web || pointPageUrl(lat, lon),
      })),
    sourceUrl: pointPageUrl(lat, lon),
  };
}

/** The human-readable NWS forecast page for a point. */
export function pointPageUrl(lat: number, lon: number): string {
  return `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
}
