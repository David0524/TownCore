import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bboxAround,
  downloadTo,
  extractBasemaps,
  Fetcher,
  geofabrikStateUrl,
  pbfFileFrames,
} from '@towncore/adapters';
import {
  and,
  articles,
  eq,
  gte,
  images,
  inArray,
  isNull,
  ne,
  sources,
  townBasemaps,
  towns,
  type Db,
} from '@towncore/db';
import { assignArticleImage, imageOptions } from '@towncore/pipeline';
import type { Logger } from 'pino';

// Maps (CLAUDE.md §11c; docs/plans/M4.md §3, D-M4-1).
// - Monthly: download each state's OpenStreetMap extract from Geofabrik once, clip it to every
//   town in that state (a box around the town's forecast point), store the lines, delete the file.
// - Every 30 minutes: give recent stories on map beats (development, public safety) a
//   block-level map when their text has a street address and the town has a base map.

/** Half the side of the box a town's base map covers, in kilometers. */
export const BASEMAP_RADIUS_KM = 12;
/** A state extract can be hundreds of megabytes: allow the download time to match. */
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

/** Towns that aren't paused and have a forecast point, by state. */
async function townsWithPoints(db: Db, slug?: string) {
  const rows = await db
    .select({ id: towns.id, slug: towns.slug, state: towns.state, config: sources.config })
    .from(towns)
    .innerJoin(sources, eq(sources.townId, towns.id))
    .where(and(eq(sources.platform, 'nws'), ne(towns.status, 'paused')));
  const byState = new Map<string, Array<{ id: string; slug: string; lat: number; lon: number }>>();
  for (const r of rows) {
    if (slug && r.slug !== slug) continue;
    const point = (r.config as { point?: unknown } | null)?.point;
    const m = typeof point === 'string' && point.match(/^(-?[\d.]+),(-?[\d.]+)$/);
    if (!m) continue;
    const list = byState.get(r.state) ?? [];
    if (!list.some((t) => t.id === r.id))
      list.push({ id: r.id, slug: r.slug, lat: +m[1]!, lon: +m[2]! });
    byState.set(r.state, list);
  }
  return byState;
}

export async function refreshBasemaps(
  db: Db,
  logger: Logger,
  opts: {
    slug?: string;
    fetcher?: Fetcher;
    now?: Date;
    /** A state extract downloaded by hand (same file as the Geofabrik URL), instead of fetching. */
    file?: string;
  } = {},
): Promise<{ towns: number; failed: number }> {
  const fetcher = opts.fetcher ?? new Fetcher({ timeoutMs: DOWNLOAD_TIMEOUT_MS });
  let done = 0;
  let failed = 0;
  for (const [state, list] of await townsWithPoints(db, opts.slug)) {
    const dir = await mkdtemp(join(tmpdir(), 'osm-'));
    try {
      const url = geofabrikStateUrl(state);
      const file = opts.file ?? join(dir, 'extract.osm.pbf');
      if (!opts.file) await downloadTo(fetcher, url, file);
      // One pass over the state's file for all its towns.
      const boxes = list.map((t) => bboxAround(t.lat, t.lon, BASEMAP_RADIUS_KM));
      const all = await extractBasemaps(pbfFileFrames(file), boxes);
      for (const [i, town] of list.entries()) {
        const [bbox, lines] = [boxes[i]!, all[i]!];
        const values = { bbox, lines, sourceUrl: url, extractedAt: opts.now ?? new Date() };
        await db
          .insert(townBasemaps)
          .values({ townId: town.id, ...values })
          .onConflictDoUpdate({ target: townBasemaps.townId, set: values });
        logger.info({ town: town.slug, lines: lines.length }, 'base map refreshed');
        done++;
      }
    } catch (error) {
      failed += list.length;
      logger.warn(
        { state, err: error instanceof Error ? error.message : String(error) },
        'base map refresh failed',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { towns: done, failed };
}

/** Stories published in the last 30 days that could have a map and haven't been tried. */
export async function drawMaps(
  db: Db,
  fetcher: Fetcher,
  logger: Logger,
  { limit = 20, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ maps: number; tried: number }> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .select({ id: articles.id, beat: articles.beat, kind: articles.kind })
    .from(articles)
    .innerJoin(images, eq(images.articleId, articles.id))
    .innerJoin(townBasemaps, eq(townBasemaps.townId, articles.townId))
    .where(
      and(
        inArray(articles.status, ['published', 'corrected']),
        gte(articles.publishedAt, since),
        isNull(images.mapCheckedAt),
        ne(images.kind, 'map'),
      ),
    )
    .limit(limit * 5);
  let maps = 0;
  let tried = 0;
  for (const row of rows.filter((r) => imageOptions(r).includes('map')).slice(0, limit)) {
    const choice = await assignArticleImage(db, row.id, { fetcher });
    tried++;
    if (choice.kind === 'map') maps++;
  }
  logger.info({ maps, tried }, 'maps drawn');
  return { maps, tried };
}
