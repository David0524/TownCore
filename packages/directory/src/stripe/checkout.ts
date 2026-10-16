import { directoryProducts, type DirectoryProduct } from '@towncore/config';
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
import { ownerListings } from '../owners';
import { currentPrice } from './prices';

// Buying a placement (M6 PR D): an owner of a claimed listing starts Stripe Checkout from the
// owner portal (subscription mode). We never create access here or on the success page: only
// the verified webhook turns a placement on (./webhook.ts).

/** Placements that count against a category's inventory. */
export const HOLDS_INVENTORY = ['pending', 'active', 'held'] as const;
/** A pending Checkout counts against inventory for this long, then stops holding a place. */
export const PENDING_HOLD_MS = 60 * 60_000;

export type CheckoutOutcome =
  | { status: 'redirect'; url: string }
  | { status: 'not_owner' | 'unavailable' | 'sold_out' | 'already_active' };

/** Sold places in the category (active, held, or a Checkout started in the last hour). */
export async function placesTaken(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  category: string | null,
  now = new Date(),
  excludeId?: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, product),
        category ? eq(placements.category, category) : undefined,
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

/** Places left for a product in a category, or null when the product has no cap. */
export async function placesLeft(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  category: string | null,
  now = new Date(),
): Promise<number | null> {
  const cap = directoryProducts[product].perCategory;
  if (cap === null) return null;
  return Math.max(0, cap - (await placesTaken(db, townId, product, category, now)));
}

export async function startCheckout(
  db: Db,
  stripe: Stripe,
  input: {
    townId: string;
    email: string;
    slug: string;
    product: DirectoryProduct;
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
  const price = def.enabled ? await currentPrice(db, input.townId, input.product) : null;
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
  if ((await placesLeft(db, input.townId, input.product, category, now)) === 0)
    return { status: 'sold_out' };

  const [placement] = await db
    .insert(placements)
    .values({
      businessId: listing.id,
      townId: input.townId,
      product: input.product,
      category,
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
  };
  const back = `${input.origin}/owner/${encodeURIComponent(listing.slug)}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.stripePriceId, quantity: 1 }],
    customer_email: input.email,
    client_reference_id: placement!.id,
    metadata,
    subscription_data: { metadata },
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
  name: string;
  monthlyUsd: number;
  /** Places left in the listing's category, or null when there is no cap. */
  left: number | null;
  /** The listing's current placement of this product, if any. */
  placement: { status: string; endsAt: Date | null } | null;
};

/** What the owner can buy for a listing, with availability and what they already have. */
export async function listingOffers(
  db: Db,
  townId: string,
  listing: { id: string; category: string | null },
  now = new Date(),
): Promise<ProductOffer[]> {
  const offers: ProductOffer[] = [];
  for (const product of Object.keys(directoryProducts) as DirectoryProduct[]) {
    const def = directoryProducts[product];
    if (!def.enabled) continue;
    const price = await currentPrice(db, townId, product);
    if (!price) continue;
    const [current] = await db
      .select({ status: placements.status, endsAt: placements.endsAt })
      .from(placements)
      .where(
        and(
          eq(placements.businessId, listing.id),
          eq(placements.product, product),
          inArray(placements.status, ['active', 'held']),
        ),
      );
    offers.push({
      product,
      name: def.name,
      monthlyUsd: price.unitAmountCents / 100,
      left: await placesLeft(
        db,
        townId,
        product,
        def.perCategory !== null ? listing.category : null,
        now,
      ),
      placement: current ?? null,
    });
  }
  return offers;
}

export type PlacementRow = {
  id: string;
  product: string;
  category: string | null;
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
    status: placement.status,
    buyerEmail: placement.buyerEmail,
    endsAt: placement.endsAt,
    createdAt: placement.createdAt,
    stripeSubscriptionId: placement.stripeSubscriptionId,
    business: { name: business.name, slug: business.slug },
    townName: town.name,
  }));
}
