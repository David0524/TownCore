import type { Fetcher } from '@towncore/adapters';
import { loadEnv } from '@towncore/config';
import { and, articles, eq, images, inArray, isNull, ne, type Db } from '@towncore/db';
import { assignArticleImage } from '@towncore/pipeline';
import type { Logger } from 'pino';

// Stock photos for evergreen guides (CLAUDE.md §11c; Unsplash, owner approved 2026-10-16). Every
// 30 minutes, guides the router hasn't run on with its network options get one: new guides, and
// guides rewritten since (a rewrite clears the check). Off until UNSPLASH_ACCESS_KEY is set.

/**
 * Guides per run. Each costs two Unsplash requests (search, then the download ping), and a new
 * app may make 50 an hour, so two runs an hour stay under it.
 */
const PER_RUN = 10;

export function unsplashFromEnv(): { accessKey: string } | null {
  const accessKey = loadEnv().UNSPLASH_ACCESS_KEY;
  return accessKey ? { accessKey } : null;
}

export async function drawStockPhotos(
  db: Db,
  fetcher: Fetcher,
  unsplash: { accessKey: string } | null,
  logger: Logger,
  { limit = PER_RUN, townId }: { limit?: number; townId?: string } = {},
): Promise<{ photos: number; tried: number }> {
  if (!unsplash) return { photos: 0, tried: 0 };
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(images, eq(images.articleId, articles.id))
    .where(
      and(
        eq(articles.kind, 'guide'),
        inArray(articles.status, ['published', 'corrected', 'in_review']),
        isNull(images.mapCheckedAt),
        ne(images.kind, 'stock'),
        townId ? eq(articles.townId, townId) : undefined,
      ),
    )
    .limit(limit);
  let photos = 0;
  for (const row of rows) {
    const choice = await assignArticleImage(db, row.id, { fetcher, unsplash });
    if (choice.kind === 'stock') photos++;
  }
  logger.info({ photos, tried: rows.length }, 'stock photos');
  return { photos, tried: rows.length };
}
