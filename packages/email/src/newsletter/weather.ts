// Weather for the top of an issue (§11), from the NWS records M2 already ingests: the latest
// zone forecast's first two periods, and any alert that hasn't expired.

export type IssueWeather = {
  periods: { name: string; text: string }[];
  alerts: { headline: string; url: string }[];
  url: string;
};

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
  if (!periods.length && !active.length) return null;
  return { periods, alerts: active, url: forecast?.url ?? active[0]?.url ?? '' };
}
