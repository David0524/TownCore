import { directoryCategories, directoryCategory, type DirectoryCategory } from '@towncore/config';
import { displayName } from './names';
import {
  and,
  articles,
  asc,
  businesses,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  or,
  placements,
  records,
  sql,
  type Db,
} from '@towncore/db';

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

/**
 * Whether a listing's street, phone, website and hours show: once claimed, or for a storefront
 * mapped in OpenStreetMap, whose address is public (owner, 2026-10-16). A state license address
 * alone never shows: it can be a home (D-M6-2).
 */
export function contactShown(listing: Pick<Listing, 'claimedAt' | 'addressPublic'>): boolean {
  return Boolean(listing.claimedAt) || listing.addressPublic;
}

/** How a listing's place is shown: the street only when contactShown (D-M6-2, D-M6-3). */
export function listingPlace(listing: Listing, townName: string): string {
  const area = `${townName} area`;
  if (contactShown(listing) && listing.address) {
    return [listing.address, area, listing.zip].filter(Boolean).join(', ');
  }
  return [area, listing.zip].filter(Boolean).join(' · ');
}

/** The listing's category, or null if config no longer has it. */
export function listingCategory(listing: Listing): DirectoryCategory | null {
  return listing.category ? directoryCategory(listing.category) : null;
}

/** Claimed listings, most recently claimed first: what the homepage can feature without bias. */
export async function claimedListings(db: Db, townId: string, limit = 4): Promise<Listing[]> {
  return db
    .select()
    .from(businesses)
    .where(and(active(townId), isNotNull(businesses.claimedAt)))
    .orderBy(desc(businesses.claimedAt), asc(businesses.name))
    .limit(limit);
}

export type NewPlace = {
  id: string;
  name: string;
  licenseType: string;
  approvedAt: Date;
  zip: string | null;
  /** The directory listing, once seeding has picked the license up. */
  listing: Pick<Listing, 'id' | 'slug' | 'category'> | null;
};

/**
 * Food service licenses the state approved recently (DBPR newfood.csv), newest first. A new
 * license is not proof a place is open yet, so callers say "newly licensed", not "now open".
 */
export async function newFoodPlaces(
  db: Db,
  townId: string,
  { days = 60, limit = 6, now = new Date() }: { days?: number; limit?: number; now?: Date } = {},
): Promise<NewPlace[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ id: records.id, title: records.title, raw: records.raw, at: records.occurredAt })
    .from(records)
    .where(
      and(
        eq(records.townId, townId),
        eq(records.type, 'new_food_license'),
        gte(records.occurredAt, since),
      ),
    )
    .orderBy(desc(records.occurredAt))
    .limit(limit * 2);
  const raw = (r: (typeof rows)[number]) => (r.raw ?? {}) as Record<string, string>;
  const licenses = rows.map((r) => raw(r).licenseNumber).filter((l): l is string => Boolean(l));
  const listings = licenses.length
    ? await db
        .select({
          id: businesses.id,
          slug: businesses.slug,
          category: businesses.category,
          licenseNumber: businesses.licenseNumber,
        })
        .from(businesses)
        .where(and(active(townId), inArray(businesses.licenseNumber, licenses)))
    : [];
  const byLicense = new Map(listings.map((l) => [l.licenseNumber, l]));
  const seen = new Set<string>();
  const places: NewPlace[] = [];
  for (const row of rows) {
    const r = raw(row);
    // One place can be approved twice (a new owner, a combined application); show it once.
    const key = r.licenseNumber || row.id;
    if (seen.has(key) || !row.at) continue;
    seen.add(key);
    const listing = byLicense.get(r.licenseNumber ?? '');
    places.push({
      id: row.id,
      name: displayName(r.businessName || row.title || r.licenseeName || ''),
      licenseType: r.occupation ?? 'Food service',
      approvedAt: row.at,
      zip: r.zip?.slice(0, 5) || null,
      listing: listing ? { id: listing.id, slug: listing.slug, category: listing.category } : null,
    });
    if (places.length === limit) break;
  }
  return places;
}

/**
 * Directory businesses for the end of an article (§11b `article.related-businesses`): listings
 * the story names first, then the categories matched to its beat (contractors for development,
 * restaurants for business). Organic order within each; sponsors sit in the slot above, labeled.
 */
export async function relatedListings(
  db: Db,
  townId: string,
  { text, beat, limit = 3 }: { text: string; beat: string | null; limit?: number },
): Promise<{ named: Listing[]; category: DirectoryCategory | null; listings: Listing[] }> {
  // Names distinctive enough to match safely (two words, 8+ characters), found in the story.
  const named = await db
    .select()
    .from(businesses)
    .where(
      and(
        active(townId),
        sql`length(${businesses.name}) >= 8`,
        sql`position(' ' in ${businesses.name}) > 0`,
        sql`position(lower(${businesses.name}) in lower(${text})) > 0`,
      ),
    )
    .orderBy(...organicOrder)
    .limit(limit);
  const rest = limit - named.length;
  const exclude = named.length
    ? sql`${businesses.id} not in (${sql.join(
        named.map((n) => sql`${n.id}`),
        sql`, `,
      )})`
    : undefined;
  // The first of the beat's categories (in config order) that has listings.
  for (const category of directoryCategories) {
    if (rest <= 0 || !beat || !(category.beats as readonly string[]).includes(beat)) continue;
    const listings = await db
      .select()
      .from(businesses)
      .where(and(active(townId), eq(businesses.category, category.slug), exclude))
      .orderBy(...organicOrder)
      .limit(rest);
    if (listings.length) return { named, category, listings };
  }
  return { named, category: null, listings: [] };
}

/** Listings in the town with an active Enhanced listing (D-M6-6): shown richer, same order. */
export async function enhancedListingIds(db: Db, townId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: placements.businessId })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, 'enhanced'),
        eq(placements.status, 'active'),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
