import {
  alertsForTown,
  beachConfig,
  fetchBeach,
  fetchWeather,
  fetchZoneAlerts,
  type BeachConfig,
  type Fetcher,
  type ZoneAlert,
} from '@towncore/adapters';
import type { WeatherSnapshot } from '@towncore/config';
import {
  and,
  eq,
  inArray,
  ne,
  saveTownWeather,
  saveTownWeatherAlerts,
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
// first, at most WEATHER_FORECASTS_PER_RUN a run, and a town's grid point is reused from its last
// snapshot, so a forecast is one request. The site picks the current hour from the stored hourly
// periods when it shows the tile.

/** A forecast younger than this isn't fetched again. */
export const WEATHER_FORECAST_EVERY_MS = 30 * 60_000;
/**
 * Forecasts fetched per run (the worker runs every 15 minutes): 500 a run is 48,000 a day, about
 * 0.56 requests a second, leaving room on api.weather.gov for alerts, surf forecasts and records.
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
  cached: { previous?: WeatherSnapshot | null; alerts?: ZoneAlert[] } = {},
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

/** Which towns' forecasts this run fetches: due ones, never fetched first, then oldest. */
export function forecastsDue(
  towns: Array<{ townId: string; fetchedAt: Date | null }>,
  now: Date,
  limit = WEATHER_FORECASTS_PER_RUN,
): string[] {
  return towns
    .filter(
      (t) => !t.fetchedAt || now.getTime() - t.fetchedAt.getTime() >= WEATHER_FORECAST_EVERY_MS,
    )
    .sort((a, b) => (a.fetchedAt?.getTime() ?? 0) - (b.fetchedAt?.getTime() ?? 0))
    .slice(0, limit)
    .map((t) => t.townId);
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

  const ages = targets.map((t) => ({
    townId: t.townId,
    fetchedAt: byTown.get(t.townId)?.fetchedAt ?? null,
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
