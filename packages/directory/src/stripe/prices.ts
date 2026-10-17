import {
  directoryProducts,
  featuredName,
  featuredRanks,
  productPrice,
  townPricing,
  type DirectoryProduct,
  type FeaturedRank,
} from '@towncore/config';
import { and, desc, eq, isNull, stripePrices, towns, type Db, type Town } from '@towncore/db';
import type Stripe from 'stripe';

// `pnpm directory:stripe sync` (M6 PR D): one Stripe Product and monthly Price per town and
// enabled subscription product, at the town's list price (its tier's, or its own `pricing`). Dry
// run by default. Idempotent: a Price is found by its lookup key before anything is created, and a
// changed amount makes a new Price. A ranked product (featured spots) has one Price per rank.
//
// Category prices move monthly (../pricing.ts), so a Price is one price level: town, product,
// rank and amount, the amount in its lookup key. Checkout finds or makes the level it needs
// (`stripePriceFor`); an existing subscription keeps the Price it was sold at (grandfathered).

export type PricePlanItem = {
  town: Pick<Town, 'id' | 'slug' | 'siteName'>;
  product: DirectoryProduct;
  /** The featured spot (1–3), or null for an unranked product. */
  rank: FeaturedRank | null;
  amountCents: number;
  lookupKey: string;
  /** What sync would do: nothing (already current) or create a Price (and Product). */
  action: 'current' | 'create';
};

export const lookupKey = (
  townSlug: string,
  product: DirectoryProduct,
  cents: number,
  rank: FeaturedRank | null = null,
) => `towncore:${townSlug}:${product}${rank ? `:r${rank}` : ''}:${cents}`;

const rankIs = (rank: FeaturedRank | null) =>
  rank ? eq(stripePrices.rank, rank) : isNull(stripePrices.rank);

/** "Featured spot #1", or the product's name. */
export const offerName = (product: DirectoryProduct, rank: FeaturedRank | null) =>
  rank ? featuredName(rank) : directoryProducts[product].name;

export async function planPrices(db: Db, townSlugs?: string[]): Promise<PricePlanItem[]> {
  const all = await db.select().from(towns);
  const plan: PricePlanItem[] = [];
  for (const town of all) {
    if (townSlugs?.length && !townSlugs.includes(town.slug)) continue;
    const pricing = townPricing(town) as unknown as Record<string, unknown>;
    for (const product of Object.keys(directoryProducts) as DirectoryProduct[]) {
      // Dated bookings are paid once at the configured price (Checkout price_data), no Price.
      if (directoryProducts[product].period) continue;
      const ranks = directoryProducts[product].ranked ? featuredRanks : [null];
      for (const rank of ranks) {
        const dollars = productPrice(pricing, product, rank ?? undefined);
        if (!dollars) continue;
        const amountCents = dollars * 100;
        const [current] = await db
          .select()
          .from(stripePrices)
          .where(
            and(
              eq(stripePrices.townId, town.id),
              eq(stripePrices.product, product),
              rankIs(rank),
              eq(stripePrices.active, true),
              eq(stripePrices.unitAmountCents, amountCents),
            ),
          );
        plan.push({
          town,
          product,
          rank,
          amountCents,
          lookupKey: lookupKey(town.slug, product, amountCents, rank),
          action: current ? 'current' : 'create',
        });
      }
    }
  }
  return plan;
}

/** Creates what the plan says is missing, and retires older prices for the same product. */
export async function applyPricePlan(
  db: Db,
  stripe: Stripe,
  plan: PricePlanItem[],
): Promise<Array<{ item: PricePlanItem; priceId: string }>> {
  const done: Array<{ item: PricePlanItem; priceId: string }> = [];
  for (const item of plan) {
    if (item.action !== 'create') continue;
    const name = `${item.town.siteName}: ${offerName(item.product, item.rank)}`;
    const metadata = {
      town_slug: item.town.slug,
      product: item.product,
      ...(item.rank ? { rank: String(item.rank) } : {}),
    };
    // Created before but not recorded here (a crash between the two): reuse it.
    const found = await stripe.prices.list({ lookup_keys: [item.lookupKey], limit: 1 });
    const price =
      found.data[0] ??
      (await stripe.prices.create({
        currency: 'usd',
        unit_amount: item.amountCents,
        recurring: { interval: 'month' },
        lookup_key: item.lookupKey,
        product_data: { name, metadata },
        metadata,
      }));
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    await db.transaction(async (tx) => {
      await tx
        .update(stripePrices)
        .set({ active: false })
        .where(
          and(
            eq(stripePrices.townId, item.town.id),
            eq(stripePrices.product, item.product),
            rankIs(item.rank),
          ),
        );
      await tx
        .insert(stripePrices)
        .values({
          townId: item.town.id,
          product: item.product,
          rank: item.rank,
          stripeProductId: productId,
          stripePriceId: price.id,
          unitAmountCents: item.amountCents,
          livemode: price.livemode,
          active: true,
        })
        .onConflictDoUpdate({ target: stripePrices.stripePriceId, set: { active: true } });
    });
    done.push({ item, priceId: price.id });
  }
  return done;
}

/**
 * The Stripe Price for one price level (town, product, rank and amount): the one we have, else
 * the one Stripe has under its lookup key, else a new one. Never changes or retires another
 * Price, so subscriptions sold at an earlier level are untouched.
 */
export async function stripePriceFor(
  db: Db,
  stripe: Stripe,
  town: Pick<Town, 'id' | 'slug' | 'siteName'>,
  product: DirectoryProduct,
  rank: FeaturedRank | null,
  amountCents: number,
) {
  const [row] = await db
    .select()
    .from(stripePrices)
    .where(
      and(
        eq(stripePrices.townId, town.id),
        eq(stripePrices.product, product),
        rankIs(rank),
        eq(stripePrices.unitAmountCents, amountCents),
      ),
    )
    .orderBy(desc(stripePrices.active), desc(stripePrices.createdAt))
    .limit(1);
  if (row) return row;
  const key = lookupKey(town.slug, product, amountCents, rank);
  const metadata = { town_slug: town.slug, product, ...(rank ? { rank: String(rank) } : {}) };
  const found = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  const price =
    found.data[0] ??
    (await stripe.prices.create({
      currency: 'usd',
      unit_amount: amountCents,
      recurring: { interval: 'month' },
      lookup_key: key,
      product_data: { name: `${town.siteName}: ${offerName(product, rank)}`, metadata },
      metadata,
    }));
  const [saved] = await db
    .insert(stripePrices)
    .values({
      townId: town.id,
      product,
      rank,
      stripeProductId: typeof price.product === 'string' ? price.product : price.product.id,
      stripePriceId: price.id,
      unitAmountCents: amountCents,
      livemode: price.livemode,
      active: true,
    })
    .onConflictDoUpdate({ target: stripePrices.stripePriceId, set: { active: true } })
    .returning();
  return saved!;
}
