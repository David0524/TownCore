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
};
