import { directoryCategories, directoryCategory, type DirectoryCategory } from '@towncore/config';
import { and, articles, asc, businesses, desc, eq, ilike, or, sql, type Db } from '@towncore/db';

// Read side of the directory (M6 PR B): what town sites show. Only active listings appear.
// Organic order is verified license, then completeness, then the most recently claimed, then
// name. Payment never enters it (Rule 6): sponsored listings are shown separately, labeled.

export type Listing = typeof businesses.$inferSelect;

/** A category page lists at most this many; search narrows it. */
export const PAGE_SIZE = 50;
/** Below this many listings a category page is thin, so it is noindex (D-M4-5). */
export const MIN_INDEXABLE = 5;

const active = (townId: string) => and(eq(businesses.townId, townId), eq(businesses.active, true));

const completeness = sql<number>`((${businesses.phone} is not null)::int + (${businesses.website} is not null)::int + (${businesses.claimedAt} is not null)::int)`;

const organicOrder = [
  desc(businesses.licenseVerified),
  desc(completeness),
  sql`${businesses.claimedAt} desc nulls last`,
  asc(businesses.name),
];

/** Active listings per category, in config order; categories with none are left out. */
export async function categoryCounts(
  db: Db,
  townId: string,
): Promise<Array<{ category: DirectoryCategory; count: number }>> {
  const rows = await db
    .select({ category: businesses.category, count: sql<number>`count(*)::int` })
    .from(businesses)
    .where(active(townId))
    .groupBy(businesses.category);
  const counts = new Map(rows.map((r) => [r.category, r.count]));
  return directoryCategories
    .filter((c) => (counts.get(c.slug) ?? 0) > 0)
    .map((c) => ({ category: c, count: counts.get(c.slug)! }));
}

/** Escapes LIKE wildcards in reader input. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function categoryListings(
  db: Db,
  townId: string,
  category: string,
  { q, limit = PAGE_SIZE }: { q?: string | undefined; limit?: number } = {},
): Promise<{ listings: Listing[]; total: number }> {
  const where = and(
    active(townId),
    eq(businesses.category, category),
    q?.trim() ? ilike(businesses.name, likeTerm(q.trim())) : undefined,
  );
  const [listings, [count]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(where)
      .orderBy(...organicOrder)
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(businesses)
      .where(where),
  ]);
  return { listings, total: count?.n ?? 0 };
}

/** Name search across every category. */
export async function searchListings(
  db: Db,
  townId: string,
  q: string,
  limit = 25,
): Promise<Listing[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return db
    .select()
    .from(businesses)
    .where(and(active(townId), ilike(businesses.name, likeTerm(term))))
    .orderBy(...organicOrder)
    .limit(limit);
}

export async function getListing(db: Db, townId: string, slug: string): Promise<Listing | null> {
  const [row] = await db
    .select()
    .from(businesses)
    .where(and(active(townId), eq(businesses.slug, slug)));
  return row ?? null;
}

/**
 * Our published stories that name the business. A plain name match until M4's entities land,
 * so only for names distinctive enough (two words, 8+ characters) to avoid false matches.
 */
export async function listingInTheNews(
  db: Db,
  townId: string,
  name: string,
  limit = 5,
): Promise<Array<{ slug: string; headline: string; publishedAt: Date | null }>> {
  const clean = name.replace(/\s+(LLC|INC|CORP|CO|PA)\.?$/i, '').trim();
  if (clean.length < 8 || !clean.includes(' ')) return [];
  const term = likeTerm(clean);
  return db
    .select({ slug: articles.slug, headline: articles.headline, publishedAt: articles.publishedAt })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        eq(articles.status, 'published'),
        or(ilike(articles.headline, term), ilike(articles.bodyMd, term)),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(limit);
}

/** How a listing's place is shown. Unclaimed listings never show a street (D-M6-2, D-M6-3). */
export function listingPlace(listing: Listing, townName: string): string {
  const area = `${townName} area`;
  if (listing.claimedAt && listing.address) {
    return [listing.address, area, listing.zip].filter(Boolean).join(', ');
  }
  return [area, listing.zip].filter(Boolean).join(' · ');
}

/** The listing's category, or null if config no longer has it. */
export function listingCategory(listing: Listing): DirectoryCategory | null {
  return listing.category ? directoryCategory(listing.category) : null;
}
