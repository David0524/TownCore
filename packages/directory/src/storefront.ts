import {
  directoryCategory,
  directoryProducts,
  featuredRanks,
  listPriceCents,
  productEnabled,
  townPricing,
  type DirectoryCategory,
  type DirectoryProduct,
  type FeaturedRank,
} from '@towncore/config';
import {
  and,
  directoryPrices,
  eq,
  gt,
  inArray,
  isNotNull,
  or,
  placements,
  type Db,
  type Town,
} from '@towncore/db';
import { openWindows, type BookingWindow } from './bookings';
import { categoryPrice } from './pricing';
import { categoryCounts } from './queries';
import { openFeaturedRanks, PENDING_HOLD_MS } from './stripe/checkout';

// The advertise page as a storefront (owner, 2026-10-17: "a full build out of the advertise
// page… working in full"). A business picks what to buy on /advertise, then /advertise/start
// sends a signed-in owner to Stripe Checkout from one of their claimed listings, or shows a
// visitor how to find and claim theirs first (claims keep their email check and editor's
// approval). Everything here reads; only the verified webhook turns a placement on.

type TownLike = Pick<Town, 'id' | 'tier' | 'config' | 'timezone'>;

/** What a business can start buying from the advertise page. */
export const SELF_SERVE_PRODUCTS = [
  'sponsored_slot',
  'enhanced',
  'newsletter',
  'exclusive',
] as const satisfies readonly DirectoryProduct[];
export type SelfServeProduct = (typeof SELF_SERVE_PRODUCTS)[number];

export type StorefrontCategory = {
  category: DirectoryCategory;
  /** Active listings in the category. */
  count: number;
  /** Featured spots nobody holds, #1 first. */
  open: FeaturedRank[];
  /** The category's current price for each spot, in cents. */
  prices: Record<FeaturedRank, number>;
  /** The cheapest open spot, or the cheapest spot when all are taken. */
  fromCents: number;
};

/**
 * The categories with listings, each with its open featured spots and their current prices, in
 * three queries for the whole town (listing counts, held spots, category prices).
 */
export async function storefrontCategories(
  db: Db,
  town: TownLike,
  now = new Date(),
): Promise<StorefrontCategory[]> {
  if (!productEnabled('sponsored_slot')) return [];
  const [counts, held, priced] = await Promise.all([
    categoryCounts(db, town.id),
    db
      .select({ category: placements.category, rank: placements.rank })
      .from(placements)
      .where(
        and(
          eq(placements.townId, town.id),
          eq(placements.product, 'sponsored_slot'),
          isNotNull(placements.rank),
          or(
            inArray(placements.status, ['active', 'held']),
            and(
              eq(placements.status, 'pending'),
              gt(placements.createdAt, new Date(now.getTime() - PENDING_HOLD_MS)),
            ),
          ),
        ),
      ),
    db
      .select({
        category: directoryPrices.category,
        rank: directoryPrices.rank,
        cents: directoryPrices.amountCents,
      })
      .from(directoryPrices)
      .where(
        and(
          eq(directoryPrices.townId, town.id),
          eq(directoryPrices.product, 'sponsored_slot'),
          isNotNull(directoryPrices.rank),
        ),
      ),
  ]);
  const taken = new Set(held.map((h) => `${h.category}:${h.rank}`));
  const price = new Map(priced.map((p) => [`${p.category}:${p.rank}`, p.cents]));
  const pricing = townPricing(town);
  return counts.map(({ category, count }) => {
    const prices = {} as Record<FeaturedRank, number>;
    for (const rank of featuredRanks)
      prices[rank] =
        price.get(`${category.slug}:${rank}`) ?? listPriceCents(pricing, 'sponsored_slot', rank)!;
    const open = featuredRanks.filter((rank) => !taken.has(`${category.slug}:${rank}`));
    const pool = (open.length ? open : featuredRanks).map((rank) => prices[rank]);
    return { category, count, open, prices, fromCents: Math.min(...pool) };
  });
}

export type StartRequest = {
  product: SelfServeProduct;
  /** The category, for a product sold per category (featured spots, category sponsorship). */
  category: DirectoryCategory | null;
  rank: FeaturedRank | null;
  /** A requested week or month (its first day), for a dated product. */
  period: string | null;
};

export type StartParse =
  | { ok: true; request: StartRequest }
  /** `needs_category`: a valid product that still needs a category picked. */
  | {
      ok: false;
      reason: 'product' | 'rank' | 'needs_category';
      product?: SelfServeProduct;
      rank?: FeaturedRank | null;
    };

/** Whether a product is sold per category, so the buying listing must be in that category. */
export const perCategory = (product: DirectoryProduct) =>
  directoryProducts[product].perCategory !== null;

/** Checks what /advertise/start was asked for: a product that is on, with what it needs. */
export function parseStartRequest(input: {
  product?: string | undefined;
  category?: string | undefined;
  rank?: string | undefined;
  period?: string | undefined;
}): StartParse {
  const product = SELF_SERVE_PRODUCTS.find((p) => p === input.product);
  if (!product || !productEnabled(product)) return { ok: false, reason: 'product' };
  const def = directoryProducts[product];
  let rank: FeaturedRank | null = null;
  if (def.ranked) {
    rank = featuredRanks.find((r) => String(r) === input.rank) ?? null;
    if (!rank) return { ok: false, reason: 'rank', product };
  }
  const category = perCategory(product) ? directoryCategory(input.category ?? '') : null;
  if (perCategory(product) && !category)
    return { ok: false, reason: 'needs_category', product, rank };
  const period =
    def.period && /^\d{4}-\d{2}-\d{2}$/.test(input.period ?? '') ? input.period! : null;
  return { ok: true, request: { product, category, rank, period } };
}

export type StartOffer = {
  /** The current price in cents (a month, or one booked week or month), or null when off. */
  cents: number | null;
  /** Free days for a business's first spot or Enhanced listing; 0 for dated bookings. */
  trialDays: number;
  /** For a featured spot: the spots open in its category. */
  openRanks: FeaturedRank[];
  /** For a dated product: the open weeks or months. */
  windows: BookingWindow[];
  /** Whether what was asked for can be bought now. */
  available: boolean;
  /** A requested period that's already booked (the next open one is offered instead). */
  periodTaken: boolean;
};

/** The price and availability of what /advertise/start was asked for. */
export async function startOffer(
  db: Db,
  town: TownLike,
  request: StartRequest,
  now = new Date(),
): Promise<StartOffer> {
  const def = directoryProducts[request.product];
  const category = request.category?.slug ?? null;
  const cents = await categoryPrice(db, town, request.product, category, request.rank);
  const trialDays = def.period ? 0 : townPricing(town).free_trial_days;
  const openRanks =
    def.ranked && category ? await openFeaturedRanks(db, town.id, category, now) : [];
  const windows = def.period
    ? await openWindows(
        db,
        { townId: town.id, timezone: town.timezone, product: request.product, category },
        now,
      )
    : [];
  const periodTaken = Boolean(request.period && !windows.some((w) => w.start === request.period));
  const available =
    cents !== null &&
    (def.ranked ? openRanks.includes(request.rank!) : def.period ? windows.length > 0 : true);
  return { cents, trialDays, openRanks, windows, available, periodTaken };
}

/** The owner's listings that can buy a product: only those in its category, when it has one. */
export function eligibleListings<T extends { category: string | null }>(
  listings: T[],
  request: Pick<StartRequest, 'product' | 'category'>,
): T[] {
  if (!perCategory(request.product)) return listings;
  return listings.filter((l) => l.category === request.category?.slug);
}

/**
 * Listings among `businessIds` that already hold a monthly product (active, or paid but held),
 * so the page sends them to their owner page instead of a second checkout. Dated bookings can
 * be bought again for another period, so they never count.
 */
export async function listingsHolding(
  db: Db,
  businessIds: string[],
  product: DirectoryProduct,
): Promise<Set<string>> {
  if (!businessIds.length || directoryProducts[product].period) return new Set();
  const rows = await db
    .select({ id: placements.businessId })
    .from(placements)
    .where(
      and(
        inArray(placements.businessId, businessIds),
        eq(placements.product, product),
        inArray(placements.status, ['active', 'held']),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
