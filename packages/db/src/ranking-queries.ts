import { and, desc, eq, gt, gte, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { articles, articleStatsDaily, pins, storyCandidates } from './schema';

// Inputs for homepage and section ranking (CLAUDE.md §6a; packages/pipeline/src/ranking.ts).

export type RankableArticle = typeof articles.$inferSelect & {
  newsworthiness: number | null;
  publishedAt: Date;
  reviewed: boolean;
};

/** Published articles with their story-finder score, newest first. */
export async function listRankableArticles(
  db: Db,
  townId: string,
  opts: {
    beat?: string;
    limit?: number;
    search?: string;
    /** Include evergreen guides (search does; home, beat lists and the newsletter don't). */
    guides?: boolean;
  } = {},
): Promise<RankableArticle[]> {
  const rows = await db
    .select({ article: articles, newsworthiness: storyCandidates.newsworthiness })
    .from(articles)
    .leftJoin(storyCandidates, eq(articles.candidateId, storyCandidates.id))
    .where(
      and(
        eq(articles.townId, townId),
        or(eq(articles.status, 'published'), eq(articles.status, 'corrected')),
        opts.beat ? eq(articles.beat, opts.beat) : undefined,
        opts.guides ? undefined : ne(articles.kind, 'guide'),
        ...searchTerms(opts.search).map((term) =>
          or(ilike(articles.headline, term), ilike(articles.dek, term)),
        ),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(opts.limit ?? 120);
  return rows
    .filter((r) => r.article.publishedAt !== null)
    .map((r) => ({
      ...r.article,
      publishedAt: r.article.publishedAt!,
      newsworthiness: r.newsworthiness,
      reviewed: r.article.reviewerId !== null,
    }));
}

/** Reader search: every word must appear in the headline or dek (case-insensitive, literal). */
function searchTerms(search: string | undefined): string[] {
  return (search ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/** IDs of articles pinned right now. */
export async function activePinIds(db: Db, townId: string, now = new Date()): Promise<Set<string>> {
  const rows = await db
    .select({ articleId: pins.articleId })
    .from(pins)
    .where(and(eq(pins.townId, townId), gt(pins.expiresAt, now)));
  return new Set(rows.map((r) => r.articleId));
}

/** List impressions and clicks per article over the last `days` days. */
export async function engagementByArticle(
  db: Db,
  townId: string,
  days = 14,
  now = new Date(),
): Promise<Map<string, { impressions: number; clicks: number }>> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      articleId: articleStatsDaily.articleId,
      impressions: sql<number>`sum(${articleStatsDaily.listImpressions})::int`,
      clicks: sql<number>`sum(${articleStatsDaily.listClicks})::int`,
    })
    .from(articleStatsDaily)
    .where(and(eq(articleStatsDaily.townId, townId), gte(articleStatsDaily.day, since)))
    .groupBy(articleStatsDaily.articleId);
  return new Map(rows.map((r) => [r.articleId, { impressions: r.impressions, clicks: r.clicks }]));
}

export type CounterKind = 'view' | 'impression' | 'click';

/** Adds one to a counter for each article (by slug) on the given local day. */
export async function countEngagement(
  db: Db,
  townId: string,
  slugs: string[],
  kind: CounterKind,
  day: string,
): Promise<number> {
  if (slugs.length === 0) return 0;
  const found = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        inArray(articles.slug, slugs.slice(0, 100)),
        or(eq(articles.status, 'published'), eq(articles.status, 'corrected')),
      ),
    );
  const column =
    kind === 'view' ? 'views' : kind === 'impression' ? 'listImpressions' : 'listClicks';
  for (const { id } of found) {
    await db
      .insert(articleStatsDaily)
      .values({ articleId: id, townId, day, [column]: 1 })
      .onConflictDoUpdate({
        target: [articleStatsDaily.articleId, articleStatsDaily.day],
        set: { [column]: sql`${articleStatsDaily[column]} + 1` },
      });
  }
  return found.length;
}
