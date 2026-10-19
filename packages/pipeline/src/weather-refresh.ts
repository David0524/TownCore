import {
  alertsForTown,
  beachConfig,
  fetchBeach,
  fetchTropics,
  fetchWeather,
  fetchZoneAlerts,
  type BeachConfig,
  type Fetcher,
  type ZoneAlert,
} from '@towncore/adapters';
import {
  daysDue,
  tropicsBasins,
  WEATHER_DAYS_EVERY_MS,
  WEATHER_DAYS_UNDER_LOAD_MS,
  type WeatherSnapshot,
} from '@towncore/config';
import {
  and,
  eq,
  inArray,
  ne,
  saveTownWeather,
  saveTownWeatherAlerts,
  saveTropics,
  sources,
  towns,
  townWeather,
  type Db,
} from '@towncore/db';

// The Today weather tile's data (docs/plans/M4b.md): each active town's NWS snapshot, with its
// beach panels. The worker refreshes towns on a schedule; a town site can also refresh one town
// when a reader finds it stale (apps/web/src/lib/weather.ts). Both use the polite Fetcher, so
// Rule 8's limits hold.
//
// Shared across towns (rollout plan, Phase 1): api.weather.gov is one host at 1 request a second
// (86,400 a day) for every town. Each run fetches alerts for all forecast zones in a few batched
// requests, so warnings are never more than a run old anywhere; forecasts take turns, oldest
// first, at most WEATHER_FORECASTS_PER_RUN requests a run, and a town's grid point is reused from
// its last snapshot, so a forecast is one request. The 7-day forecast (the Weather page's day
// list) is one more on the same grid, fetched hourly at most, and only every 6 hours when more
// towns are due than the run's budget, so the hourly forecasts keep their turns. The site picks
// the current hour and drops ended days from the stored periods when it shows them.

/** A forecast younger than this isn't fetched again. */
export const WEATHER_FORECAST_EVERY_MS = 30 * 60_000;
/**
 * Forecast requests per run (the worker runs every 15 minutes), hourly and 7-day together: 500 a
 * run is 48,000 a day, about 0.56 requests a second, leaving room on api.weather.gov for alerts,
 * surf forecasts and records.
 */
export const WEATHER_FORECASTS_PER_RUN = 500;

export type WeatherTarget = {
  townId: string;
  point: string;
  zone: string;
  beach: BeachConfig | null;
};

type Log = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

/** Towns that aren't paused and have an NWS source with a forecast point (or just one town). */
export async function weatherTargets(db: Db, townId?: string): Promise<WeatherTarget[]> {
  const rows = await db
    .select({ townId: sources.townId, config: sources.config })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .where(
      and(
        eq(sources.platform, 'nws'),
        ne(towns.status, 'paused'),
        townId ? eq(sources.townId, townId) : undefined,
      ),
    );
  return rows.flatMap(({ townId, config }) => {
    const all = (config ?? {}) as Record<string, unknown>;
    const { point, zone } = all;
    return typeof point === 'string' && typeof zone === 'string'
      ? [{ townId, point, zone, beach: beachConfig(all) }]
      : [];
  });
}

/**
 * Refreshes one town's snapshot; a failure is recorded and keeps the last good snapshot. Its
 * previous snapshot saves the grid-point lookup; alerts can come from a batched request.
 */
export async function refreshTownWeather(
  db: Db,
  fetcher: Fetcher,
  target: WeatherTarget,
  now = new Date(),
  cached: { previous?: WeatherSnapshot | null; alerts?: ZoneAlert[]; daysEveryMs?: number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    let previous = cached.previous;
    if (previous === undefined) {
      const [row] = await db
        .select({ snapshot: townWeather.snapshot })
        .from(townWeather)
        .where(eq(townWeather.townId, target.townId));
      previous = row?.snapshot ?? null;
    }
    const snapshot = await fetchWeather(fetcher, target, now, {
      previous,
      ...(cached.alerts ? { alerts: cached.alerts } : {}),
      ...(cached.daysEveryMs ? { daysEveryMs: cached.daysEveryMs } : {}),
    });
    // Beach parts fail on their own; the weather tile never waits on them.
    if (target.beach) snapshot.beach = await fetchBeach(fetcher, target.beach, now);
    await saveTownWeather(db, target.townId, { snapshot }, now);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveTownWeather(db, target.townId, { error: message }, now);
    return { ok: false, error: message };
  }
}

/**
 * Which towns' forecasts this run fetches: due ones, never fetched first, then oldest, while
 * their requests (`cost`, 1 by default: 2 with the 7-day forecast) fit in `limit`.
 */
export function forecastsDue(
  towns: Array<{ townId: string; fetchedAt: Date | null; cost?: number }>,
  now: Date,
  limit = WEATHER_FORECASTS_PER_RUN,
): string[] {
  const due = towns
    .filter(
      (t) => !t.fetchedAt || now.getTime() - t.fetchedAt.getTime() >= WEATHER_FORECAST_EVERY_MS,
    )
    .sort((a, b) => (a.fetchedAt?.getTime() ?? 0) - (b.fetchedAt?.getTime() ?? 0));
  const out: string[] = [];
  let spent = 0;
  for (const t of due) {
    spent += t.cost ?? 1;
    if (spent > limit) break;
    out.push(t.townId);
  }
  return out;
}

/**
 * How often this run fetches 7-day forecasts: hourly, unless the due towns' requests wouldn't fit
 * in the budget that way; then every WEATHER_DAYS_UNDER_LOAD_MS.
 */
export function daysCadence(
  towns: Array<{ townId: string; fetchedAt: Date | null; snapshot: WeatherSnapshot | null }>,
  now: Date,
  limit = WEATHER_FORECASTS_PER_RUN,
): number {
  const withDays = towns.map((t) => ({
    ...t,
    cost: daysDue(t.snapshot, now, WEATHER_DAYS_EVERY_MS) ? 2 : 1,
  }));
  const due = forecastsDue(withDays, now, Infinity);
  const cost = withDays.filter((t) => due.includes(t.townId)).reduce((sum, t) => sum + t.cost, 0);
  return cost <= limit ? WEATHER_DAYS_EVERY_MS : WEATHER_DAYS_UNDER_LOAD_MS;
}

/**
 * One run: alerts for every town, and forecasts for the towns whose turn it is. One town's
 * failure is logged and kept; the others go on.
 */
export async function refreshWeather(
  db: Db,
  fetcher: Fetcher,
  logger: Log,
  now = new Date(),
  limit = WEATHER_FORECASTS_PER_RUN,
): Promise<{ ok: number; failed: number; deferred: number; alertsOnly: number }> {
  const targets = await weatherTargets(db);
  const stored = targets.length
    ? await db
        .select({
          townId: townWeather.townId,
          snapshot: townWeather.snapshot,
          fetchedAt: townWeather.fetchedAt,
        })
        .from(townWeather)
        .where(
          inArray(
            townWeather.townId,
            targets.map((t) => t.townId),
          ),
        )
    : [];
  const byTown = new Map(stored.map((r) => [r.townId, r]));

  let zoneAlerts: Map<string, ZoneAlert[]> | null = null;
  try {
    zoneAlerts = await fetchZoneAlerts(
      fetcher,
      targets.map((t) => t.zone),
      now,
    );
  } catch (error) {
    // Forecasts still refresh (each then asks for its own zone's alerts).
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'weather alerts failed',
    );
  }

  const towns = targets.map((t) => ({
    townId: t.townId,
    fetchedAt: byTown.get(t.townId)?.fetchedAt ?? null,
    snapshot: byTown.get(t.townId)?.snapshot ?? null,
  }));
  const daysEveryMs = daysCadence(towns, now, limit);
  const ages = towns.map((t) => ({
    ...t,
    cost: daysDue(t.snapshot, now, daysEveryMs) ? 2 : 1,
  }));
  const due = new Set(forecastsDue(ages, now, limit));
  // Due but over this run's budget: they're first in line next run.
  const deferred = forecastsDue(ages, now, Infinity).length - due.size;
  let ok = 0;
  let failed = 0;
  let alertsOnly = 0;
  for (const target of targets) {
    const row = byTown.get(target.townId);
    const alerts = zoneAlerts?.get(target.zone);
    if (due.has(target.townId)) {
      const result = await refreshTownWeather(db, fetcher, target, now, {
        previous: row?.snapshot ?? null,
        ...(alerts ? { alerts } : {}),
        daysEveryMs,
      });
      if (result.ok) ok++;
      else {
        logger.warn({ townId: target.townId, err: result.error }, 'weather refresh failed');
        failed++;
      }
    } else if (alerts && row?.snapshot) {
      await saveTownWeatherAlerts(db, target.townId, alertsForTown(alerts, row.snapshot.sourceUrl));
      alertsOnly++;
    }
  }
  logger.info({ ok, failed, alertsOnly, deferred }, 'weather refresh');
  return { ok, failed, deferred, alertsOnly };
}

/**
 * The tropics panel's hourly run: NHC's two shared files give every basin, once for the whole
 * network. A failure is recorded per basin and keeps the last good snapshot until it ages out.
 */
export async function refreshTropics(
  db: Db,
  fetcher: Fetcher,
  logger: Log,
  now = new Date(),
): Promise<{ ok: boolean; storms: number }> {
  try {
    const basins = await fetchTropics(fetcher);
    for (const snapshot of basins) await saveTropics(db, snapshot.basin, { snapshot }, now);
    const storms = basins.reduce((n, b) => n + b.storms.length, 0);
    logger.info({ storms }, 'tropics refresh');
    return { ok: true, storms };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const basin of tropicsBasins) await saveTropics(db, basin, { error: message }, now);
    logger.warn({ err: message }, 'tropics refresh failed');
    return { ok: false, storms: 0 };
  }
}
