import { directoryCategories, directoryCategory, type DirectoryCategory } from '@towncore/config';
import { displayName } from './names';
import { INTEREST_DAYS, rankCategories } from './rank-categories';
import { CTA_SLOT } from './leads';
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
  isNull,
  lt,
  or,
  placements,
  records,
  slotStatsDaily,
  sql,
  type Db,
} from '@towncore/db';

// Read side of the directory (M6 PR B): what town sites show. Only active listings appear.
// Organic order is verified license, then completeness, then the most recently claimed; ties
// rotate daily (owner, 2026-10-17: never A–Z). Payment never enters it (Rule 6): sponsored
// listings are shown separately, labeled.

export type Listing = typeof businesses.$inferSelect;

/** A category page lists at most this many; search narrows it. */
export const PAGE_SIZE = 50;
/** Below this many listings a category page is thin, so it is noindex (D-M4-5). */
export const MIN_INDEXABLE = 5;

const active = (townId: string) => and(eq(businesses.townId, townId), eq(businesses.active, true));

// How complete a listing is for a reader: a way to reach it, where it is, what it serves, when
// it's open. Places with real details come before bare license rows.
const completeness = sql<number>`((${businesses.phone} is not null)::int + (${businesses.website} is not null)::int + (${businesses.claimedAt} is not null)::int + (${businesses.addressPublic})::int + (${businesses.cuisine} is not null)::int + (${businesses.hours} is not null)::int)`;

/** The town's local date (YYYY-MM-DD): rotations and rankings change once a day, there. */
export const localDay = (timeZone = 'UTC', now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

/**
 * Organic order (CLAUDE.md §11 "Organic sort"): verified license, completeness, recently
 * claimed; listings equal on all three rotate by a hash of the listing and `seed` (town, kind and
 * local day), so the order is the same for everyone all day, changes the next, and is never A–Z.
 * Payment never enters it (Rule 6).
 */
const organicOrder = (seed: string) => [
  desc(businesses.licenseVerified),
  desc(completeness),
  sql`${businesses.claimedAt} desc nulls last`,
  sql`md5(${businesses.id}::text || ${seed})`,
];

type DayOpts = { day?: string | undefined; timeZone?: string | undefined };
const dayOf = ({ day, timeZone }: DayOpts) => day ?? localDay(timeZone);

/**
 * Listing page views per kind over the last INTEREST_DAYS whole days, before `day` (so the
 * ranking holds all day): reader interest for rankCategories. Views of listings that hold a paid
 * placement are left out, so payment can't move a kind up the bar (Rule 6).
 */
export async function rankingViews(
  db: Db,
  townId: string,
  day: string,
): Promise<Map<string, number>> {
  const since = new Date(`${day}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - INTEREST_DAYS);
  const rows = await db
    .select({
      category: businesses.category,
      views: sql<number>`coalesce(sum(${slotStatsDaily.impressions}), 0)::int`,
    })
    .from(slotStatsDaily)
    .innerJoin(businesses, eq(businesses.id, slotStatsDaily.businessId))
    .where(
      and(
        eq(slotStatsDaily.townId, townId),
        eq(slotStatsDaily.slot, CTA_SLOT),
        isNull(slotStatsDaily.campaignId),
        gte(slotStatsDaily.day, since.toISOString().slice(0, 10)),
        lt(slotStatsDaily.day, day),
        eq(businesses.active, true),
        sql`not exists (select 1 from ${placements} where ${placements.businessId} = ${businesses.id} and ${placements.status} in ('active', 'held'))`,
      ),
    )
    .groupBy(businesses.category);
  return new Map(rows.flatMap((r) => (r.category ? [[r.category, r.views] as const] : [])));
}

/**
 * Active listings per category, ranked (rank-categories.ts: reader demand, the kind's size here
 * and real reader interest; never A–Z, never payment); categories with none are left out.
 */
export async function categoryCounts(
  db: Db,
  townId: string,
  opts: DayOpts = {},
): Promise<Array<{ category: DirectoryCategory; count: number }>> {
  const day = dayOf(opts);
  const [rows, views] = await Promise.all([
    db
      .select({ category: businesses.category, count: sql<number>`count(*)::int` })
      .from(businesses)
      .where(active(townId))
      .groupBy(businesses.category),
    rankingViews(db, townId, day),
  ]);
  const counts = new Map(rows.map((r) => [r.category, r.count]));
  return rankCategories(
    directoryCategories
      .filter((c) => (counts.get(c.slug) ?? 0) > 0)
      .map((c) => ({ category: c, count: counts.get(c.slug)! })),
    { views, day },
  );
}

/** Escapes LIKE wildcards in reader input. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function categoryListings(
  db: Db,
  townId: string,
  category: string,
  {
    q,
    cuisine,
    limit = PAGE_SIZE,
    ...day
  }: {
    q?: string | undefined;
    cuisine?: string | undefined;
    limit?: number;
  } & DayOpts = {},
): Promise<{ listings: Listing[]; total: number }> {
  const where = and(
    active(townId),
    eq(businesses.category, category),
    q?.trim() ? ilike(businesses.name, likeTerm(q.trim())) : undefined,
    cuisine?.trim() ? ilike(businesses.cuisine, likeTerm(cuisine.trim())) : undefined,
  );
  const [listings, [count]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(where)
      .orderBy(...organicOrder(`${townId}|${category}|${dayOf(day)}`))
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(businesses)
      .where(where),
  ]);
  return { listings, total: count?.n ?? 0 };
}

/** The cuisines mapped in a category, most common first ("Italian" 14, "Pizza" 9…). */
export async function categoryCuisines(
  db: Db,
  townId: string,
  category: string,
  limit = 12,
): Promise<Array<{ cuisine: string; count: number }>> {
  const rows = await db
    .select({ cuisine: businesses.cuisine })
    .from(businesses)
    .where(and(active(townId), eq(businesses.category, category), isNotNull(businesses.cuisine)));
  const counts = new Map<string, number>();
  for (const { cuisine } of rows)
    for (const part of (cuisine ?? '').split(',')) {
      const key = part.trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ cuisine: key.charAt(0).toUpperCase() + key.slice(1), count }));
}

/**
 * A few places worth a look in a category: ones with full public details (where, how to reach
 * them, what they serve), one per cuisine, in an order that changes daily so every complete
 * listing gets its turn. Editorial and never paid (Rule 6): payment doesn't enter into it.
 */
export async function worthALook(
  db: Db,
  townId: string,
  category: string,
  { limit = 4, day = new Date().toISOString().slice(0, 10) }: { limit?: number; day?: string } = {},
): Promise<Listing[]> {
  const rows = await db
    .select()
    .from(businesses)
    .where(
      and(
        active(townId),
        eq(businesses.category, category),
        isNotNull(businesses.cuisine),
        or(eq(businesses.addressPublic, true), isNotNull(businesses.claimedAt)),
        or(isNotNull(businesses.phone), isNotNull(businesses.website)),
      ),
    )
    .orderBy(sql`md5(${businesses.id}::text || ${day})`)
    .limit(limit * 6);
  const seen = new Set<string>();
  const picks: Listing[] = [];
  for (const row of rows) {
    const first = row.cuisine?.split(',')[0]?.trim().toLowerCase() ?? '';
    if (seen.has(first)) continue;
    seen.add(first);
    picks.push(row);
    if (picks.length === limit) break;
  }
  return picks;
}

/** Name search across every category. */
export async function searchListings(
  db: Db,
  townId: string,
  q: string,
  limit = 25,
  /** Only listings of this kind (the advertise page's search for a category product). */
  category?: string | null,
  opts: DayOpts = {},
): Promise<Listing[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return db
    .select()
    .from(businesses)
    .where(
      and(
        active(townId),
        ilike(businesses.name, likeTerm(term)),
        category ? eq(businesses.category, category) : undefined,
      ),
    )
    .orderBy(...organicOrder(`${townId}|search|${dayOf(opts)}`))
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
  /** The directory listing, once seeding has picked the license up (with any mapped details). */
  listing: Pick<
    Listing,
    | 'id'
    | 'slug'
    | 'category'
    | 'cuisine'
    | 'address'
    | 'addressPublic'
    | 'claimedAt'
    | 'phone'
    | 'website'
  > | null;
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
          cuisine: businesses.cuisine,
          address: businesses.address,
          addressPublic: businesses.addressPublic,
          claimedAt: businesses.claimedAt,
          phone: businesses.phone,
          website: businesses.website,
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
      listing: listing ? (({ licenseNumber: _, ...rest }) => rest)(listing) : null,
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
  {
    text,
    beat,
    limit = 3,
    ...day
  }: { text: string; beat: string | null; limit?: number } & DayOpts,
): Promise<{ named: Listing[]; category: DirectoryCategory | null; listings: Listing[] }> {
  const seed = `${townId}|related|${dayOf(day)}`;
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
    .orderBy(...organicOrder(seed))
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
      .orderBy(...organicOrder(seed))
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
