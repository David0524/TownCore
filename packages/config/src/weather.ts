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
  /** Relative humidity in percent, for the heat index (feelsLike). Missing before 2026-10-19. */
  humidity?: number | null;
  /** NWS's day or night flag for the hour (the icon's sun or moon). Missing before 2026-10-19. */
  isDaytime?: boolean;
};

/**
 * One 12-hour period of the NWS 7-day forecast (`/gridpoints/{office}/{x},{y}/forecast`), as NWS
 * wrote it: "Tonight", "Monday", "Monday Night".
 */
export type ForecastPeriod = {
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  shortForecast: string;
  detailedForecast: string;
  precipChance: number | null;
  windSpeed: string;
  windDirection: string;
};

/** The stored 7-day forecast: its 12-hour periods, fetched less often than the hourly one. */
export type SevenDayForecast = {
  /** When NWS last updated it. */
  updatedAt: string;
  /** When we fetched it (the refresh cadence: WEATHER_DAYS_EVERY_MS). */
  fetchedAt: string;
  periods: ForecastPeriod[];
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
  /**
   * The 7-day forecast's 12-hour periods (the Weather page's day list). Snapshots stored before
   * 2026-10-19, and those whose 7-day request failed every time, lack it; advanceSnapshot drops
   * ended periods and the whole forecast once it's older than WEATHER_DAYS_MAX_AGE_MS.
   */
  days?: SevenDayForecast;
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
  const days = advanceDays(snapshot.days, now);
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
  const { days: _stored, ...rest } = snapshot;
  return {
    ...rest,
    ...(days ? { days } : {}),
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

/** The 7-day forecast is fetched at most this often (pipeline/weather-refresh.ts). */
export const WEATHER_DAYS_EVERY_MS = 60 * 60_000;
/**
 * When more towns are due than a run's request budget allows, the 7-day forecast waits this
 * long instead, so the hourly forecasts (the tile's "now") keep their turns.
 */
export const WEATHER_DAYS_UNDER_LOAD_MS = 6 * HOUR_MS;
/** A 7-day forecast older than this isn't shown (the page falls back to the zone forecast). */
export const WEATHER_DAYS_MAX_AGE_MS = 12 * HOUR_MS;

/** True when a town's stored 7-day forecast is missing or at least `everyMs` old. */
export function daysDue(
  snapshot: Pick<WeatherSnapshot, 'days'> | null | undefined,
  now: Date,
  everyMs = WEATHER_DAYS_EVERY_MS,
): boolean {
  const fetched = snapshot?.days?.fetchedAt;
  return !fetched || now.getTime() - new Date(fetched).getTime() >= everyMs;
}

/** The stored 7-day forecast as of `now`: ended periods dropped; none once it's too old. */
export function advanceDays(
  days: SevenDayForecast | undefined,
  now: Date,
): SevenDayForecast | undefined {
  if (!days) return undefined;
  const t = now.getTime();
  if (t - new Date(days.fetchedAt).getTime() > WEATHER_DAYS_MAX_AGE_MS) return undefined;
  const periods = days.periods.filter((p) => new Date(p.endTime).getTime() > t);
  return periods.length ? { ...days, periods } : undefined;
}

/** One row of the Weather page's day list: a day and the night after it, or "Tonight" alone. */
export type ForecastDay = {
  name: string;
  /** False for a row that starts at night ("Tonight"): there's only a low. */
  isDaytime: boolean;
  high: number | null;
  low: number | null;
  shortForecast: string;
  /** The period's NWS text, then the night's, as NWS wrote them. */
  detail: string[];
  /** The higher of the day's and the night's chance of precipitation, in percent. */
  precipChance: number | null;
  kind: ConditionKind;
};

/**
 * Pairs the 12-hour periods into up to `max` days. A forecast that starts at night leads with
 * that night alone ("Tonight", a low and no high).
 */
export function daysFromPeriods(periods: ForecastPeriod[], max = 7): ForecastDay[] {
  const days: ForecastDay[] = [];
  for (let i = 0; i < periods.length && days.length < max; i++) {
    const p = periods[i]!;
    const next = periods[i + 1];
    const night = p.isDaytime && next && !next.isDaytime ? next : undefined;
    if (night) i++;
    const chances = [p.precipChance, night?.precipChance].filter(
      (c): c is number => typeof c === 'number',
    );
    days.push({
      name: p.name,
      isDaytime: p.isDaytime,
      high: p.isDaytime ? p.temperature : null,
      low: p.isDaytime ? (night?.temperature ?? null) : p.temperature,
      shortForecast: p.shortForecast,
      detail: [p.detailedForecast, night?.detailedForecast ?? ''].filter(Boolean),
      precipChance: chances.length ? Math.max(...chances) : null,
      kind: conditionKind(p.shortForecast),
    });
  }
  return days;
}

/** The kinds of weather our icons draw (apps/web/src/components/weather/WeatherIcon.tsx). */
export const conditionKinds = ['clear', 'partly-cloudy', 'cloudy', 'fog', 'wind', 'rain', 'showers', 'thunder', 'snow'] as const; // prettier-ignore
export type ConditionKind = (typeof conditionKinds)[number];

/**
 * What an NWS short forecast ("Slight Chance Rain Showers then Mostly Sunny") looks like, as one
 * kind. The most serious weather it names wins, whatever its chance: thunder, then snow and
 * ice, showers, rain, fog, wind, then the sky.
 */
export function conditionKind(shortForecast: string): ConditionKind {
  const s = shortForecast.toLowerCase();
  if (/thunder|t-storm|tstorm/.test(s)) return 'thunder';
  if (/snow|sleet|flurr|\bice\b|freezing|wintry|blizzard/.test(s)) return 'snow';
  if (/shower/.test(s)) return 'showers';
  if (/rain|drizzle/.test(s)) return 'rain';
  if (/fog|haze|smoke|mist|dust/.test(s)) return 'fog';
  if (/wind|breez|blustery|gust/.test(s)) return 'wind';
  if (/partly|mostly sunny|mostly clear|few clouds/.test(s)) return 'partly-cloudy';
  if (/cloud|overcast/.test(s)) return 'cloudy';
  return 'clear';
}

/** The first number in an NWS wind speed ("10 mph", "10 to 15 mph"); null when there's none. */
export function windMph(windSpeed: string): number | null {
  const m = windSpeed.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * What the hour's forecast feels like, by the NWS formulas: the heat index from 80°F when the
 * humidity is known, the wind chill at 50°F or below with wind of 3 mph or more. Null otherwise,
 * or when it rounds to the temperature itself.
 */
export function feelsLike(
  p: Pick<WeatherPeriod, 'temperature' | 'humidity' | 'windSpeed' | 'unit'>,
): number | null {
  if (p.unit !== 'F') return null;
  const t = p.temperature;
  let value: number | null = null;
  if (t >= 80 && typeof p.humidity === 'number') value = heatIndex(t, p.humidity);
  else if (t <= 50) {
    const v = windMph(p.windSpeed);
    if (v !== null && v >= 3) value = windChill(t, v);
  }
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded === t ? null : rounded;
}

/** The NWS wind chill, in °F, for a temperature in °F and wind in mph. */
export const windChill = (t: number, mph: number) =>
  35.74 + 0.6215 * t - 35.75 * mph ** 0.16 + 0.4275 * t * mph ** 0.16;

/** The NWS heat index (the Rothfusz regression with its two adjustments), in °F. */
export function heatIndex(t: number, rh: number): number {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return simple;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  if (rh < 13 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  else if (rh > 85 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}
