// The Today weather tile's data (docs/plans/M4b.md): built by the worker from the NWS API
// (packages/adapters/src/nws/weather.ts), stored per town, rendered by the web app.

export type WeatherHour = {
  startTime: string;
  temperature: number;
  shortForecast: string;
  precipChance: number | null;
};

/** One hourly forecast period, as stored for the view-time "now" (see advanceSnapshot). */
export type WeatherPeriod = WeatherHour & {
  windSpeed: string;
  windDirection: string;
  unit: string;
};

export type WeatherAlert = {
  id: string;
  event: string;
  headline: string | null;
  severity: string;
  /** When it ends (or expires, if NWS gives no end time). */
  until: string | null;
  url: string;
};

export type WeatherSnapshot = {
  /** Where the forecast is for, as NWS names it ("Boca Raton, FL"). */
  place: string;
  grid: { office: string; x: number; y: number };
  /** When NWS last updated the hourly forecast. */
  updatedAt: string;
  /** The forecast for the current hour. It's a forecast, not an observation, and is labeled so. */
  now: WeatherPeriod;
  hours: WeatherHour[];
  /**
   * The next ~36 hourly periods. The worker refreshes a town's forecast every half hour or less
   * often (Rule 8 pace, shared by thousands of towns), so the site picks the current hour from
   * these when it shows the tile (advanceSnapshot). Snapshots stored before 2026-10-17 lack it.
   */
  upcoming?: WeatherPeriod[];
  /** Today's (or tonight's) high and low from the hourly forecast; either can be missing. */
  today: { name: string; high: number | null; low: number | null; shortForecast: string };
  alerts: WeatherAlert[];
  /** The NWS page for this point, linked as the source. */
  sourceUrl: string;
  /** Coastal towns with beach sources configured (see BeachConditions). */
  beach?: BeachConditions;
};

/**
 * Beach conditions for coastal towns (D-M4b-3; owner approved the sources 2026-10-16). Each part
 * comes from its own public source and is missing when that source failed or is stale.
 */
export type BeachConditions = {
  /** NWS surf zone forecast (SRF) for the town's zone: the first period's rip current risk. */
  surf: {
    period: string;
    ripRisk: string;
    surfHeight: string | null;
    issuedAt: string;
    office: string;
    url: string;
  } | null;
  /** NOAA CO-OPS: latest water temperature at the station (preliminary data). */
  water: { fahrenheit: number; at: string; station: string; stationName: string } | null;
  /** NOAA CO-OPS: the next high and low tide predictions. */
  tides: {
    next: Array<{ type: 'high' | 'low'; at: string }>;
    station: string;
    stationName: string;
  } | null;
  /** EPA Envirofacts: today's UV index forecast for the ZIP code. */
  uv: { index: number; zip: string; date: string } | null;
};

/** How many hourly steps the tile shows, and how far apart (hours). */
export const HOURLY_STEPS = 6;
export const HOURLY_EVERY = 2;

const HOUR_MS = 3_600_000;

/** The local date ("2026-10-17") and hour of an NWS period start ("2026-10-17T14:00:00-04:00"). */
const localDay = (startTime: string) => startTime.slice(0, 10);
const localHour = (startTime: string) => Number(startTime.slice(11, 13));

/** True when the snapshot's hourly periods still reach `now`. */
export function snapshotCovers(snapshot: WeatherSnapshot, now: Date): boolean {
  const last = snapshot.upcoming?.at(-1);
  return !!last && new Date(last.startTime).getTime() + HOUR_MS > now.getTime();
}

/**
 * The snapshot as of `now`: the current hour, the hourly row and today's (or tonight's) high and
 * low recomputed from the stored hourly periods, and alerts that have ended dropped. A snapshot
 * without hourly periods (stored before they were kept) is returned as it is.
 */
export function advanceSnapshot(snapshot: WeatherSnapshot, now: Date): WeatherSnapshot {
  const periods = snapshot.upcoming;
  if (!periods?.length) return snapshot;
  const t = now.getTime();
  let start = periods.findLastIndex((p) => new Date(p.startTime).getTime() <= t);
  if (start < 0) start = 0;
  const current = periods[start]!;
  const ahead = periods.slice(start);
  const hours = Array.from({ length: HOURLY_STEPS }, (_, i) => periods[start + i * HOURLY_EVERY])
    .filter((p): p is WeatherPeriod => p !== undefined)
    .map(({ startTime, temperature, shortForecast, precipChance }) => ({
      startTime,
      temperature,
      shortForecast,
      precipChance,
    }));
  const day = localDay(current.startTime);
  const tonight = localHour(current.startTime) >= 15;
  const temps = (keep: (p: WeatherPeriod) => boolean) =>
    ahead.filter(keep).map((p) => p.temperature);
  // Daytime: 6 a.m. to 7 p.m. today. Overnight: 7 p.m. today to 8 a.m. tomorrow.
  const daytime = temps((p) => localDay(p.startTime) === day && localHour(p.startTime) < 19);
  const overnight = temps(
    (p) =>
      (localDay(p.startTime) === day && localHour(p.startTime) >= 19) ||
      (localDay(p.startTime) > day &&
        localHour(p.startTime) < 8 &&
        new Date(p.startTime).getTime() - t < 24 * HOUR_MS),
  );
  return {
    ...snapshot,
    now: current,
    hours,
    today: {
      name: tonight ? 'Tonight' : 'Today',
      high: !tonight && daytime.length ? Math.max(...daytime) : null,
      low: overnight.length ? Math.min(...overnight) : null,
      shortForecast: current.shortForecast,
    },
    alerts: snapshot.alerts.filter((a) => !a.until || new Date(a.until).getTime() > t),
  };
}
