import {
  directoryProducts,
  productPrice,
  type DirectoryProduct,
  type TownConfig,
} from '@towncore/config';
import { and, eq, stripePrices, towns, type Db, type Town } from '@towncore/db';
import type Stripe from 'stripe';

// `pnpm directory:stripe sync` (M6 PR D): one Stripe Product and monthly Price per town and
// enabled product, from the town's `pricing`. Dry run by default. Idempotent: a Price is found by
// its lookup key before anything is created, and a changed amount makes a new Price.

export type PricePlanItem = {
  town: Pick<Town, 'id' | 'slug' | 'siteName'>;
  product: DirectoryProduct;
  amountCents: number;
  lookupKey: string;
  /** What sync would do: nothing (already current) or create a Price (and Product). */
  action: 'current' | 'create';
};

export const lookupKey = (townSlug: string, product: DirectoryProduct, cents: number) =>
  `towncore:${townSlug}:${product}:${cents}`;

export async function planPrices(db: Db, townSlugs?: string[]): Promise<PricePlanItem[]> {
  const all = await db.select().from(towns);
  const plan: PricePlanItem[] = [];
  for (const town of all) {
    if (townSlugs?.length && !townSlugs.includes(town.slug)) continue;
    const pricing = (town.config as TownConfig).pricing as Record<string, number> | undefined;
    for (const product of Object.keys(directoryProducts) as DirectoryProduct[]) {
      const dollars = productPrice(pricing, product);
      if (!dollars) continue;
      const amountCents = dollars * 100;
      const [current] = await db
        .select()
        .from(stripePrices)
        .where(
          and(
            eq(stripePrices.townId, town.id),
            eq(stripePrices.product, product),
            eq(stripePrices.active, true),
            eq(stripePrices.unitAmountCents, amountCents),
          ),
        );
      plan.push({
        town,
        product,
        amountCents,
        lookupKey: lookupKey(town.slug, product, amountCents),
        action: current ? 'current' : 'create',
      });
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
    const name = `${item.town.siteName}: ${directoryProducts[item.product].name}`;
    // Created before but not recorded here (a crash between the two): reuse it.
    const found = await stripe.prices.list({ lookup_keys: [item.lookupKey], limit: 1 });
    const price =
      found.data[0] ??
      (await stripe.prices.create({
        currency: 'usd',
        unit_amount: item.amountCents,
        recurring: { interval: 'month' },
        lookup_key: item.lookupKey,
        product_data: {
          name,
          metadata: { town_slug: item.town.slug, product: item.product },
        },
        metadata: { town_slug: item.town.slug, product: item.product },
      }));
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    await db.transaction(async (tx) => {
      await tx
        .update(stripePrices)
        .set({ active: false })
        .where(and(eq(stripePrices.townId, item.town.id), eq(stripePrices.product, item.product)));
      await tx
        .insert(stripePrices)
        .values({
          townId: item.town.id,
          product: item.product,
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

/** The town's current Price for a product, or null if sync hasn't made one. */
export async function currentPrice(db: Db, townId: string, product: DirectoryProduct) {
  const [row] = await db
    .select()
    .from(stripePrices)
    .where(
      and(
        eq(stripePrices.townId, townId),
        eq(stripePrices.product, product),
        eq(stripePrices.active, true),
      ),
    );
  return row ?? null;
}
