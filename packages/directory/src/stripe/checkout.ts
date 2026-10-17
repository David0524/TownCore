import {
  directoryProducts,
  featuredRanks,
  productEnabled,
  productPrice,
  type BookingPeriod,
  type DirectoryProduct,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import {
  and,
  businesses,
  eq,
  gt,
  inArray,
  ne,
  or,
  placements,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import type Stripe from 'stripe';
import { openWindows, upcomingBookings, type BookingWindow } from '../bookings';
import { ownerListings } from '../owners';
import { currentPrice, offerName } from './prices';

// Buying a placement (M6 PR D): an owner of a claimed listing starts Stripe Checkout from the
// owner portal (subscription mode). We never create access here or on the success page: only
// the verified webhook turns a placement on (./webhook.ts). Featured spots are ranked: each of
// #1, #2 and #3 in a category belongs to one business at a time, and a business's first spot
// starts with the town's free trial (owner, 2026-10-16), and so does a business's first Enhanced
// listing (owner, 2026-10-17). A dated booking (a newsletter week, a category month) is paid once
// in payment mode at the town's configured price; only open periods are offered.

/** Placements that count against a category's inventory. */
export const HOLDS_INVENTORY = ['pending', 'active', 'held'] as const;
/** A pending Checkout counts against inventory for this long, then stops holding a place. */
export const PENDING_HOLD_MS = 60 * 60_000;

export type CheckoutOutcome =
  | { status: 'redirect'; url: string }
  | { status: 'not_owner' | 'unavailable' | 'sold_out' | 'already_active' };

/**
 * Sold places in the category (active, held, or a Checkout started in the last hour); with a
 * rank, only that featured spot's.
 */
export async function placesTaken(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  category: string | null,
  now = new Date(),
  excludeId?: string,
  rank?: FeaturedRank | null,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, product),
        category ? eq(placements.category, category) : undefined,
        rank ? eq(placements.rank, rank) : undefined,
        excludeId ? ne(placements.id, excludeId) : undefined,
        or(
          inArray(placements.status, ['active', 'held']),
          and(
            eq(placements.status, 'pending'),
            gt(placements.createdAt, new Date(now.getTime() - PENDING_HOLD_MS)),
          ),
        ),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Places left for a product in a category, or null when the product has no cap. A featured spot
 * is one place: 1 when open, 0 when sold.
 */
export async function placesLeft(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  category: string | null,
  now = new Date(),
  rank?: FeaturedRank | null,
): Promise<number | null> {
  const cap = rank ? 1 : directoryProducts[product].perCategory;
  if (cap === null) return null;
  return Math.max(
    0,
    cap - (await placesTaken(db, townId, product, category, now, undefined, rank)),
  );
}

/** The featured spots still open in a category, #1 first. */
export async function openFeaturedRanks(
  db: Db,
  townId: string,
  category: string,
  now = new Date(),
): Promise<FeaturedRank[]> {
  const open: FeaturedRank[] = [];
  for (const rank of featuredRanks)
    if ((await placesLeft(db, townId, 'sponsored_slot', category, now, rank)) !== 0)
      open.push(rank);
  return open;
}

/** A business's first spot (or Enhanced listing) gets the trial; a repeat doesn't. */
async function hadPlacement(db: Db, businessId: string, product: DirectoryProduct) {
  const [row] = await db
    .select({ id: placements.id })
    .from(placements)
    .where(
      and(
        eq(placements.businessId, businessId),
        eq(placements.product, product),
        sql`${placements.startsAt} is not null`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function startCheckout(
  db: Db,
  stripe: Stripe,
  input: {
    townId: string;
    email: string;
    slug: string;
    product: DirectoryProduct;
    /** Which featured spot, for a ranked product. */
    rank?: FeaturedRank | null;
    /** The week or month to book (its first day, YYYY-MM-DD), for a dated product. */
    period?: string | null;
    /** https://<town domain>, for the return links. */
    origin: string;
  },
  now = new Date(),
): Promise<CheckoutOutcome> {
  const listing = (await ownerListings(db, input.townId, input.email)).find(
    (l) => l.slug === input.slug,
  );
  if (!listing) return { status: 'not_owner' };
  const def = directoryProducts[input.product];
  if (def.period) return startBooking(db, stripe, { ...input, listing }, now);
  const rank = def.ranked ? (input.rank ?? null) : null;
  if (def.ranked && !rank) return { status: 'unavailable' };
  const price = productEnabled(input.product)
    ? await currentPrice(db, input.townId, input.product, rank)
    : null;
  if (!price) return { status: 'unavailable' };
  const category = def.perCategory !== null ? listing.category : null;
  const [existing] = await db
    .select({ id: placements.id })
    .from(placements)
    .where(
      and(
        eq(placements.businessId, listing.id),
        eq(placements.product, input.product),
        inArray(placements.status, ['active', 'held']),
      ),
    );
  if (existing) return { status: 'already_active' };
  if ((await placesLeft(db, input.townId, input.product, category, now, rank)) === 0)
    return { status: 'sold_out' };
  const [town] = await db
    .select({ config: towns.config })
    .from(towns)
    .where(eq(towns.id, input.townId));
  const trialDays = (town?.config as TownConfig | undefined)?.pricing?.free_trial_days ?? 0;
  const trial = trialDays > 0 && !(await hadPlacement(db, listing.id, input.product));

  const [placement] = await db
    .insert(placements)
    .values({
      businessId: listing.id,
      townId: input.townId,
      product: input.product,
      category,
      rank,
      status: 'pending',
      stripePriceId: price.stripePriceId,
      buyerEmail: input.email,
      createdAt: now,
    })
    .returning();
  const metadata = {
    placement_id: placement!.id,
    town_id: input.townId,
    business_id: listing.id,
    product: input.product,
    category: category ?? '',
    rank: rank ? String(rank) : '',
  };
  const back = `${input.origin}/owner/${encodeURIComponent(listing.slug)}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.stripePriceId, quantity: 1 }],
    customer_email: input.email,
    client_reference_id: placement!.id,
    metadata,
    // The first month free: Stripe takes the card now and charges when the trial ends.
    subscription_data: { metadata, ...(trial ? { trial_period_days: trialDays } : {}) },
    success_url: `${back}?s=paid`,
    cancel_url: `${back}?s=canceled`,
    // Checkout holds a place for an hour at most (PENDING_HOLD_MS); expire the page with it.
    expires_at: Math.floor((now.getTime() + PENDING_HOLD_MS) / 1000),
  });
  await db
    .update(placements)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(placements.id, placement!.id));
  if (!session.url) throw new Error(`Checkout session ${session.id} has no URL`);
  return { status: 'redirect', url: session.url };
}

/**
 * Books a newsletter week or a category month: one Checkout payment at the town's price, for a
 * period that is still open. The verified webhook turns it on, after checking the period again.
 */
async function startBooking(
  db: Db,
  stripe: Stripe,
  input: {
    townId: string;
    email: string;
    product: DirectoryProduct;
    period?: string | null;
    origin: string;
    listing: { id: string; slug: string; name: string; category: string | null };
  },
  now: Date,
): Promise<CheckoutOutcome> {
  const def = directoryProducts[input.product];
  const [town] = await db
    .select({ config: towns.config, timezone: towns.timezone, siteName: towns.siteName })
    .from(towns)
    .where(eq(towns.id, input.townId));
  if (!town || !def.period) return { status: 'unavailable' };
  const dollars = productPrice(
    (town.config as TownConfig).pricing as Record<string, unknown> | undefined,
    input.product,
  );
  if (!dollars) return { status: 'unavailable' };
  const category = def.perCategory !== null ? input.listing.category : null;
  if (def.perCategory !== null && !category) return { status: 'unavailable' };
  const open = await openWindows(
    db,
    { townId: input.townId, timezone: town.timezone, product: input.product, category },
    now,
  );
  const window = open.find((w) => w.start === input.period);
  if (!window) return { status: 'sold_out' };
  const [placement] = await db
    .insert(placements)
    .values({
      businessId: input.listing.id,
      townId: input.townId,
      product: input.product,
      category,
      period: window.start,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      status: 'pending',
      buyerEmail: input.email,
      createdAt: now,
    })
    .returning();
  const metadata = {
    placement_id: placement!.id,
    town_id: input.townId,
    business_id: input.listing.id,
    product: input.product,
    category: category ?? '',
    period: window.start,
  };
  const back = `${input.origin}/owner/${encodeURIComponent(input.listing.slug)}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: dollars * 100,
          product_data: {
            name: `${town.siteName}: ${def.name}, ${window.label}`,
            metadata: { product: input.product },
          },
        },
      },
    ],
    customer_email: input.email,
    customer_creation: 'always',
    client_reference_id: placement!.id,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${back}?s=paid`,
    cancel_url: `${back}?s=canceled`,
    expires_at: Math.floor((now.getTime() + PENDING_HOLD_MS) / 1000),
  });
  await db
    .update(placements)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(placements.id, placement!.id));
  if (!session.url) throw new Error(`Checkout session ${session.id} has no URL`);
  return { status: 'redirect', url: session.url };
}

/** The Stripe Customer Portal, where owners change cards or cancel (D-M6-5). */
export async function billingPortalUrl(
  db: Db,
  stripe: Stripe,
  input: { townId: string; email: string; returnUrl: string },
): Promise<string | null> {
  const [row] = await db
    .select({ customer: placements.stripeCustomerId })
    .from(placements)
    .where(
      and(
        eq(placements.townId, input.townId),
        sql`lower(${placements.buyerEmail}) = ${input.email.toLowerCase()}`,
        sql`${placements.stripeCustomerId} is not null`,
      ),
    )
    .limit(1);
  if (!row?.customer) return null;
  const session = await stripe.billingPortal.sessions.create({
    customer: row.customer,
    return_url: input.returnUrl,
  });
  return session.url;
}

export type ProductOffer = {
  product: DirectoryProduct;
  /** The featured spot, for a ranked product. */
  rank: FeaturedRank | null;
  name: string;
  monthlyUsd: number;
  /** Free days before the first charge, when this business would get the trial. */
  trialDays: number;
  /** Places left in the listing's category, or null when there is no cap. */
  left: number | null;
  /** The listing's current placement of this product (and rank), if any. */
  placement: { id: string; status: string; endsAt: Date | null } | null;
  /** A dated product: what one booking buys, the open periods, and this listing's bookings. */
  period: BookingPeriod | null;
  open: BookingWindow[];
  bookings: Array<{ id: string; status: string; window: BookingWindow }>;
};

/**
 * What the owner can buy for a listing, with availability and what they already have. A ranked
 * product is one offer per spot; once the listing holds a spot, only that one is shown.
 */
export async function listingOffers(
  db: Db,
  townId: string,
  listing: { id: string; category: string | null },
  now = new Date(),
): Promise<ProductOffer[]> {
  const [town] = await db
    .select({ config: towns.config, timezone: towns.timezone })
    .from(towns)
    .where(eq(towns.id, townId));
  const pricing = (town?.config as TownConfig | undefined)?.pricing;
  const freeDays = pricing?.free_trial_days ?? 0;
  const offers: ProductOffer[] = [];
  for (const product of Object.keys(directoryProducts) as DirectoryProduct[]) {
    const def = directoryProducts[product];
    if (!productEnabled(product)) continue;
    if (def.period) {
      const dollars = productPrice(pricing as Record<string, unknown> | undefined, product);
      const category = def.perCategory !== null ? listing.category : null;
      if (!dollars || !town || (def.perCategory !== null && !category)) continue;
      offers.push({
        product,
        rank: null,
        name: def.name,
        monthlyUsd: dollars,
        trialDays: 0,
        left: null,
        placement: null,
        period: def.period,
        open: await openWindows(db, { townId, timezone: town.timezone, product, category }, now),
        bookings: await upcomingBookings(db, listing.id, product, town.timezone, now),
      });
      continue;
    }
    const [current] = await db
      .select({
        id: placements.id,
        status: placements.status,
        endsAt: placements.endsAt,
        rank: placements.rank,
      })
      .from(placements)
      .where(
        and(
          eq(placements.businessId, listing.id),
          eq(placements.product, product),
          inArray(placements.status, ['active', 'held']),
        ),
      );
    const trialDays = !(await hadPlacement(db, listing.id, product)) ? freeDays : 0;
    const ranks: Array<FeaturedRank | null> = !def.ranked
      ? [null]
      : current?.rank
        ? [current.rank as FeaturedRank]
        : [...featuredRanks];
    for (const rank of ranks) {
      const price = await currentPrice(db, townId, product, rank);
      if (!price) continue;
      offers.push({
        product,
        rank,
        name: offerName(product, rank),
        monthlyUsd: price.unitAmountCents / 100,
        trialDays,
        left: await placesLeft(
          db,
          townId,
          product,
          def.perCategory !== null ? listing.category : null,
          now,
          rank,
        ),
        placement: current
          ? { id: current.id, status: current.status, endsAt: current.endsAt }
          : null,
        period: null,
        open: [],
        bookings: [],
      });
    }
  }
  return offers;
}

export type PlacementRow = {
  id: string;
  product: string;
  category: string | null;
  rank: number | null;
  status: string;
  buyerEmail: string | null;
  endsAt: Date | null;
  createdAt: Date;
  stripeSubscriptionId: string | null;
  business: { name: string; slug: string };
  townName: string;
};

/** Paid placements for Admin → Directory: held ones (to refund) first, then newest. */
export async function listPlacements(db: Db, limit = 100): Promise<PlacementRow[]> {
  const rows = await db
    .select({ placement: placements, business: businesses, town: towns })
    .from(placements)
    .innerJoin(businesses, eq(businesses.id, placements.businessId))
    .innerJoin(towns, eq(towns.id, placements.townId))
    .where(inArray(placements.status, ['active', 'held', 'pending', 'canceled', 'expired']))
    .orderBy(sql`(${placements.status} = 'held') desc`, sql`${placements.createdAt} desc`)
    .limit(limit);
  return rows.map(({ placement, business, town }) => ({
    id: placement.id,
    product: placement.product,
    category: placement.category,
    rank: placement.rank,
    status: placement.status,
    buyerEmail: placement.buyerEmail,
    endsAt: placement.endsAt,
    createdAt: placement.createdAt,
    stripeSubscriptionId: placement.stripeSubscriptionId,
    business: { name: business.name, slug: business.slug },
    townName: town.name,
  }));
}
