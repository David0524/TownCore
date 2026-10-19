import type { ForecastDay } from '@towncore/config';

// Weather for the top of an issue (§11), from the NWS records M2 already ingests: the latest
// zone forecast's first two periods, and any alert that hasn't expired. In hurricane country, the
// National Hurricane Center's one line when a storm is active or likely (config/tropics.ts).

export type IssueWeather = {
  periods: { name: string; text: string }[];
  alerts: { headline: string; url: string }[];
  url: string;
  /** "Hurricane Ana, 90 mph winds", linking to the site's tropics panel. */
  tropics?: { line: string; url: string };
  /** The next days' highs and lows from the NWS 7-day forecast: "Monday 84°/73°, …". */
  outlook?: { label: string; line: string };
};

/**
 * The next three days with a high (a leading "Tonight" row is skipped), from the stored 7-day
 * forecast, as one compact line; null without any.
 */
export function outlookLine(
  days: ForecastDay[] | null | undefined,
): IssueWeather['outlook'] | null {
  const rows = (days ?? []).filter((d) => d.high !== null).slice(0, 3);
  if (!rows.length) return null;
  return {
    label: rows.length === 3 ? 'Next 3 days' : 'Coming days',
    line: rows.map((d) => `${d.name} ${d.high}°${d.low !== null ? `/${d.low}°` : ''}`).join(', '),
  };
}

type ForecastRaw = { periods?: { name?: string; detailedForecast?: string }[] };
type AlertRaw = {
  ends?: string | null;
  expires?: string | null;
  headline?: string | null;
  event?: string;
};

export function issueWeather(
  forecast: { raw: unknown; url: string | null } | null,
  alerts: { title: string | null; url: string | null; raw: unknown }[],
  now: Date,
  tropics?: { line: string; url: string } | null,
  days?: ForecastDay[] | null,
): IssueWeather | null {
  const periods = ((forecast?.raw as ForecastRaw | null)?.periods ?? [])
    .filter((p) => p.name && p.detailedForecast)
    .slice(0, 2)
    .map((p) => ({ name: p.name!, text: p.detailedForecast! }));
  const active = alerts
    .filter((a) => {
      const raw = a.raw as AlertRaw;
      const end = raw.ends ?? raw.expires;
      return end ? new Date(end) > now : false;
    })
    .map((a) => ({
      headline: a.title ?? (a.raw as AlertRaw).event ?? 'Weather alert',
      url: a.url ?? forecast?.url ?? '',
    }));
  const outlook = outlookLine(days);
  if (!periods.length && !active.length && !tropics && !outlook) return null;
  return {
    periods,
    alerts: active,
    url: forecast?.url ?? active[0]?.url ?? '',
    ...(tropics ? { tropics } : {}),
    ...(outlook ? { outlook } : {}),
  };
}
