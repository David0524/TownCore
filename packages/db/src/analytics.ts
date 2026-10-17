import { MAX_ENGAGED_SECONDS, type PageKind } from '@towncore/config';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { articles, articleStatsDaily, pageStatsDaily } from './schema';

// Page and time-on-page counters for Admin → Analytics (owner, 2026-10-17). Aggregate only, like
// every counter (D-M4-3): a count per town, day and kind of page, and per story.

/** Adds one page view to a town's daily count for that kind of page. */
export async function countPageView(
  db: Db,
  townId: string,
  day: string,
  kind: PageKind,
): Promise<void> {
  await db
    .insert(pageStatsDaily)
    .values({ townId, day, kind, views: 1 })
    .onConflictDoUpdate({
      target: [pageStatsDaily.townId, pageStatsDaily.day, pageStatsDaily.kind],
      set: { views: sql`${pageStatsDaily.views} + 1` },
    });
}

/**
 * Adds the seconds one visit kept a page visible, capped at MAX_ENGAGED_SECONDS, to the town's
 * count for that kind of page, and to the story's when the page was a published story.
 */
export async function countEngagedTime(
  db: Db,
  townId: string,
  day: string,
  kind: PageKind,
  seconds: number,
  articleSlug?: string,
): Promise<void> {
  const s = Math.round(Math.min(Math.max(seconds, 0), MAX_ENGAGED_SECONDS));
  if (s < 1) return;
  await db
    .insert(pageStatsDaily)
    .values({ townId, day, kind, engagedSeconds: s, engagedSamples: 1 })
    .onConflictDoUpdate({
      target: [pageStatsDaily.townId, pageStatsDaily.day, pageStatsDaily.kind],
      set: {
        engagedSeconds: sql`${pageStatsDaily.engagedSeconds} + ${s}`,
        engagedSamples: sql`${pageStatsDaily.engagedSamples} + 1`,
      },
    });
  if (kind !== 'article' || !articleSlug) return;
  const [story] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        eq(articles.slug, articleSlug),
        or(eq(articles.status, 'published'), eq(articles.status, 'corrected')),
      ),
    );
  if (!story) return;
  await db
    .insert(articleStatsDaily)
    .values({ articleId: story.id, townId, day, engagedSeconds: s, engagedSamples: 1 })
    .onConflictDoUpdate({
      target: [articleStatsDaily.articleId, articleStatsDaily.day],
      set: {
        engagedSeconds: sql`${articleStatsDaily.engagedSeconds} + ${s}`,
        engagedSamples: sql`${articleStatsDaily.engagedSamples} + 1`,
      },
    });
}
