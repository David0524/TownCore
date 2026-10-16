import type { WeatherSnapshot } from '@towncore/config';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from './client';
import { townWeather } from './schema';

/** A snapshot older than this isn't shown: the tile falls back to "forecast unavailable". */
export const WEATHER_MAX_AGE_MS = 3 * 3_600_000;

export async function saveTownWeather(
  db: Db,
  townId: string,
  result: { snapshot: WeatherSnapshot } | { error: string },
  now = new Date(),
): Promise<void> {
  const values =
    'snapshot' in result
      ? { snapshot: result.snapshot, fetchedAt: now, lastError: null, lastAttemptAt: now }
      : { lastError: result.error.slice(0, 500), lastAttemptAt: now };
  await db
    .insert(townWeather)
    .values({ townId, ...values })
    .onConflictDoUpdate({ target: townWeather.townId, set: values });
}

/** The town's latest snapshot if it is fresh enough to show, else null. A failed refresh keeps
 * the last good snapshot until it ages out. */
export async function getTownWeather(
  db: Db,
  townId: string,
  now = new Date(),
): Promise<{ snapshot: WeatherSnapshot; fetchedAt: Date } | null> {
  const [row] = await db.select().from(townWeather).where(eq(townWeather.townId, townId));
  if (!row?.snapshot || !row.fetchedAt) return null;
  if (now.getTime() - row.fetchedAt.getTime() > WEATHER_MAX_AGE_MS) return null;
  return { snapshot: row.snapshot, fetchedAt: row.fetchedAt };
}

/**
 * Claims the right to refresh a town's snapshot (a town site's refresh-on-view): true when the
 * snapshot is missing or older than `staleMs` and nobody tried in the last `retryMs`. The claim
 * is one conditional write, so of many requests at once only one refreshes.
 */
export async function claimWeatherRefresh(
  db: Db,
  townId: string,
  now = new Date(),
  { staleMs = 30 * 60_000, retryMs = 10 * 60_000 }: { staleMs?: number; retryMs?: number } = {},
): Promise<boolean> {
  const claimed = await db
    .insert(townWeather)
    .values({ townId, lastAttemptAt: now })
    .onConflictDoUpdate({
      target: townWeather.townId,
      set: { lastAttemptAt: now },
      setWhere: and(
        or(
          isNull(townWeather.fetchedAt),
          lt(townWeather.fetchedAt, new Date(now.getTime() - staleMs)),
        ),
        lt(townWeather.lastAttemptAt, new Date(now.getTime() - retryMs)),
      ),
    })
    .returning({ townId: townWeather.townId });
  return claimed.length > 0;
}
