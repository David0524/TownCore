import {
  beachConfig,
  fetchBeach,
  fetchWeather,
  type BeachConfig,
  type Fetcher,
} from '@towncore/adapters';
import { and, eq, ne, saveTownWeather, sources, towns, type Db } from '@towncore/db';
import type { Logger } from 'pino';

// The Today weather tile (docs/plans/M4b.md): every 15 minutes, refresh each active town's NWS
// snapshot. Uses the shared polite Fetcher, so Rule 8's limits hold across jobs.

/** Towns that aren't paused and have an NWS source with a forecast point. */
export async function weatherTargets(
  db: Db,
): Promise<Array<{ townId: string; point: string; zone: string; beach: BeachConfig | null }>> {
  const rows = await db
    .select({ townId: sources.townId, config: sources.config })
    .from(sources)
    .innerJoin(towns, eq(sources.townId, towns.id))
    .where(and(eq(sources.platform, 'nws'), ne(towns.status, 'paused')));
  return rows.flatMap(({ townId, config }) => {
    const all = (config ?? {}) as Record<string, unknown>;
    const { point, zone } = all;
    return typeof point === 'string' && typeof zone === 'string'
      ? [{ townId, point, zone, beach: beachConfig(all) }]
      : [];
  });
}

/** Refreshes every town's snapshot. One town's failure is logged and kept; the others go on. */
export async function refreshWeather(
  db: Db,
  fetcher: Fetcher,
  logger: Logger,
  now = new Date(),
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const target of await weatherTargets(db)) {
    try {
      const snapshot = await fetchWeather(fetcher, target, now);
      // Beach parts fail on their own; the weather tile never waits on them.
      if (target.beach) snapshot.beach = await fetchBeach(fetcher, target.beach, now);
      await saveTownWeather(db, target.townId, { snapshot }, now);
      ok++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveTownWeather(db, target.townId, { error: message }, now);
      logger.warn({ townId: target.townId, err: message }, 'weather refresh failed');
      failed++;
    }
  }
  logger.info({ ok, failed }, 'weather refresh');
  return { ok, failed };
}
