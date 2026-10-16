import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from './client';
import { articles, campaigns, corrections, placements, records, towns } from './schema';

export type Town = typeof towns.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type SourceRecord = typeof records.$inferSelect;
export type Correction = typeof corrections.$inferSelect;

/**
 * Strips port, trailing dot and a leading "www." and lowercases. Returns null for anything
 * that isn't a plausible hostname so garbage Host headers never reach the database.
 */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const bare = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const withoutWww = bare.startsWith('www.') ? bare.slice(4) : bare;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(withoutWww) && withoutWww.length <= 253
    ? withoutWww
    : null;
}

/** Finds the town whose domain (or an extra domain) matches the normalized host. */
export async function getTownByHost(db: Db, host: string): Promise<Town | null> {
  const [town] = await db
    .select()
    .from(towns)
    .where(or(eq(towns.domain, host), arrayContains(towns.extraDomains, [host])))
    .limit(1);
  return town ?? null;
}

export async function getTownBySlug(db: Db, slug: string): Promise<Town | null> {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug)).limit(1);
  return town ?? null;
}

export async function listLiveTowns(db: Db): Promise<Town[]> {
  return db.select().from(towns).where(eq(towns.status, 'live')).orderBy(towns.name);
}

/** Published (including corrected) articles for a town, newest first, optionally one beat. */
export async function listPublishedArticles(
  db: Db,
  townId: string,
  { limit = 20, beat }: { limit?: number; beat?: string } = {},
): Promise<Article[]> {
  return db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        or(eq(articles.status, 'published'), eq(articles.status, 'corrected')),
        beat ? eq(articles.beat, beat) : undefined,
        // News only: evergreen guides have their own index (listPublishedGuides).
        ne(articles.kind, 'guide'),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(limit);
}

/** A town's published guides (M4 PR F), A to Z by headline. */
export async function listPublishedGuides(db: Db, townId: string): Promise<Article[]> {
  return db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        or(eq(articles.status, 'published'), eq(articles.status, 'corrected')),
        eq(articles.kind, 'guide'),
      ),
    )
    .orderBy(asc(articles.headline));
}

/** The highest-priority active campaign running now in a town's slot, if any. */
export async function getActiveCampaign(
  db: Db,
  townId: string,
  slot: string,
  now: Date = new Date(),
  category?: string | null,
): Promise<Campaign | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.townId, townId),
        eq(campaigns.slot, slot),
        eq(campaigns.status, 'active'),
        lte(campaigns.startsAt, now),
        or(isNull(campaigns.endsAt), gt(campaigns.endsAt, now)),
        // A category page takes that category's campaign first, then a slot-wide one.
        category
          ? or(isNull(campaigns.category), eq(campaigns.category, category))
          : isNull(campaigns.category),
      ),
    )
    .orderBy(
      sql`(${campaigns.category} is not null) desc`,
      desc(campaigns.priority),
      desc(campaigns.startsAt),
    )
    .limit(1);
  return campaign ?? null;
}

/**
 * Up to `limit` active campaigns for a slot and category: featured spots in rank order, then
 * the rest oldest first (first come, first shown).
 */
export async function getActiveCampaigns(
  db: Db,
  townId: string,
  slot: string,
  category: string,
  limit: number,
  now: Date = new Date(),
): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.townId, townId),
        eq(campaigns.slot, slot),
        eq(campaigns.category, category),
        eq(campaigns.status, 'active'),
        lte(campaigns.startsAt, now),
        or(isNull(campaigns.endsAt), gt(campaigns.endsAt, now)),
      ),
    )
    .orderBy(
      sql`(select ${placements.rank} from ${placements} where ${placements.id} = ${campaigns.placementId}) asc nulls last`,
      campaigns.startsAt,
    )
    .limit(limit);
}

const isPublic = or(eq(articles.status, 'published'), eq(articles.status, 'corrected'));

/** A published (or corrected) article by slug; drafts, review items and blocked items are never served. */
export async function getPublishedArticle(
  db: Db,
  townId: string,
  slug: string,
): Promise<Article | null> {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.townId, townId), eq(articles.slug, slug), isPublic))
    .limit(1);
  return article ?? null;
}

/** Published (or corrected) articles by id, in the given order; others are left out. */
export async function listArticlesByIds(db: Db, ids: string[]): Promise<Article[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(articles)
    .where(and(inArray(articles.id, ids), isPublic));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is Article => !!r);
}

/** Source records an article cites (Rule 4), in the article's citation order. */
export async function getSourceRecords(db: Db, ids: string[]): Promise<SourceRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(records).where(inArray(records.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is SourceRecord => !!r);
}

export async function listArticleCorrections(db: Db, articleId: string): Promise<Correction[]> {
  return db
    .select()
    .from(corrections)
    .where(eq(corrections.articleId, articleId))
    .orderBy(desc(corrections.createdAt));
}

/** Every public correction in a town, newest first, with its article (Corrections page). */
export async function listTownCorrections(
  db: Db,
  townId: string,
): Promise<Array<{ correction: Correction; article: Pick<Article, 'slug' | 'headline'> }>> {
  const rows = await db
    .select({ correction: corrections, slug: articles.slug, headline: articles.headline })
    .from(corrections)
    .innerJoin(articles, eq(corrections.articleId, articles.id))
    .where(and(eq(articles.townId, townId), isPublic))
    .orderBy(desc(corrections.createdAt));
  return rows.map(({ correction, slug, headline }) => ({
    correction,
    article: { slug, headline },
  }));
}
