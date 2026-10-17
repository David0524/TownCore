import {
  directoryProducts,
  featuredName,
  featuredRanks,
  productPrice,
  type DirectoryProduct,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import { and, eq, isNull, stripePrices, towns, type Db, type Town } from '@towncore/db';
import type Stripe from 'stripe';

// `pnpm directory:stripe sync` (M6 PR D): one Stripe Product and monthly Price per town and
// enabled subscription product, from the town's `pricing`. Dry run by default. Idempotent: a Price is found by
// its lookup key before anything is created, and a changed amount makes a new Price. A ranked
// product (featured spots) has one Price per rank.

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
    const pricing = (town.config as TownConfig).pricing as Record<string, unknown> | undefined;
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

/** The town's current Price for a product (and rank), or null if sync hasn't made one. */
export async function currentPrice(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  rank: FeaturedRank | null = null,
) {
  const [row] = await db
    .select()
    .from(stripePrices)
    .where(
      and(
        eq(stripePrices.townId, townId),
        eq(stripePrices.product, product),
        rankIs(rank),
        eq(stripePrices.active, true),
      ),
    );
  return row ?? null;
}
