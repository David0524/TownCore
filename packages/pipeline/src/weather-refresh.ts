import {
  beachConfig,
  fetchBeach,
  fetchWeather,
  type BeachConfig,
  type Fetcher,
} from '@towncore/adapters';
import { and, eq, ne, saveTownWeather, sources, towns, type Db } from '@towncore/db';

// The Today weather tile's data (docs/plans/M4b.md): each active town's NWS snapshot, with its
// beach panels. The worker refreshes every town on a schedule; a town site can also refresh one
// town when a reader finds it stale (apps/web/src/lib/weather.ts). Both use the polite Fetcher,
// so Rule 8's limits hold.

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

/** Refreshes one town's snapshot; a failure is recorded and keeps the last good snapshot. */
export async function refreshTownWeather(
  db: Db,
  fetcher: Fetcher,
  target: WeatherTarget,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const snapshot = await fetchWeather(fetcher, target, now);
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

/** Refreshes every town's snapshot. One town's failure is logged and kept; the others go on. */
export async function refreshWeather(
  db: Db,
  fetcher: Fetcher,
  logger: Log,
  now = new Date(),
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const target of await weatherTargets(db)) {
    const result = await refreshTownWeather(db, fetcher, target, now);
    if (result.ok) ok++;
    else {
      logger.warn({ townId: target.townId, err: result.error }, 'weather refresh failed');
      failed++;
    }
  }
  logger.info({ ok, failed }, 'weather refresh');
  return { ok, failed };
}
