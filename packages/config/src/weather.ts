// The Today weather tile's data (docs/plans/M4b.md): built by the worker from the NWS API
// (packages/adapters/src/nws/weather.ts), stored per town, rendered by the web app.

export type WeatherHour = {
  startTime: string;
  temperature: number;
  shortForecast: string;
  precipChance: number | null;
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
  now: WeatherHour & { windSpeed: string; windDirection: string; unit: string };
  hours: WeatherHour[];
  /** Today's (or tonight's) high and low from the 12-hour forecast; either can be missing. */
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
