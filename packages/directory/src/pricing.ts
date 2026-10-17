import {
  decidePrice,
  directoryCategories,
  directoryCategory,
  directoryProducts,
  DYNAMIC_PRODUCTS,
  featuredRanks,
  isDynamicProduct,
  listPriceCents,
  PRICING_RULES,
  productEnabled,
  townPricing,
  type DirectoryProduct,
  type DynamicProduct,
  type FeaturedRank,
  type PricingSignals,
} from '@towncore/config';
import {
  and,
  businesses,
  desc,
  directoryPrices,
  directoryWaitlist,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  leads,
  logAdminAction,
  lt,
  ne,
  or,
  placements,
  priceChanges,
  pricingRuns,
  slotStatsDaily,
  sql,
  suppressions,
  towns,
  townVariant,
  type Db,
  type Town,
} from '@towncore/db';
import { CATEGORY_SPONSOR_SLOT, SPONSOR_SLOT, TOP_SPOT_SLOT } from './creatives';
import { CTA_SLOT } from './leads';

// Directory prices (owner, 2026-10-17: "Grow ad and directory revenue"). A category product's
// price is the same for every business in a town at a time: its directory_prices row, or the
// town's list price (tier prices with the town's own on top). Once a month a worker job
// recalculates each from aggregate counts only (no reader data, D-M4-3; no business is ever an
// input), inside the guardrails in @towncore/config `decidePrice`. Nothing here touches an
// existing subscription: a business keeps the Stripe Price it bought at (grandfathered), and a
// new price is used only for checkouts started after it (the amount is fixed when the Checkout
// session is created). Changing an existing customer's price is never automated (Rule 10).

const DAY = 86_400_000;

type TownLike = Pick<Town, 'id' | 'tier' | 'config'>;

const rankIs = (rank: FeaturedRank | null) =>
  rank ? eq(directoryPrices.rank, rank) : isNull(directoryPrices.rank);

/**
 * What a business pays for a product now, in cents, or null when the product is off. Category
 * products use the category's current price; everything else the town's list price.
 */
export async function categoryPrice(
  db: Db,
  town: TownLike,
  product: DirectoryProduct,
  category: string | null,
  rank: FeaturedRank | null = null,
): Promise<number | null> {
  if (!productEnabled(product) || !directoryProducts[product].priceKey) return null;
  const list = listPriceCents(townPricing(town), product, rank);
  if (list === null) return null;
  if (!category || !isDynamicProduct(product)) return list;
  const [row] = await db
    .select({ cents: directoryPrices.amountCents })
    .from(directoryPrices)
    .where(
      and(
        eq(directoryPrices.townId, town.id),
        eq(directoryPrices.category, category),
        eq(directoryPrices.product, product),
        rankIs(rank),
      ),
    );
  return row?.cents ?? list;
}

/** Featured spot prices #1–#3 for a category (or the list prices without one), in cents. */
export async function featuredPrices(
  db: Db,
  town: TownLike,
  category: string | null,
): Promise<Record<FeaturedRank, number>> {
  const pricing = townPricing(town);
  const out = {} as Record<FeaturedRank, number>;
  for (const rank of featuredRanks)
    out[rank] =
      (category ? await categoryPrice(db, town, 'sponsored_slot', category, rank) : null) ??
      listPriceCents(pricing, 'sponsored_slot', rank)!;
  return out;
}

/** The month a date falls in, in a time zone (YYYY-MM). */
export const localMonth = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);

/** Paid placements count toward fill and value; held ones never ran. */
const RAN = ['active', 'canceled', 'expired'] as const;

/** The aggregate signals for one town, category and product over the pricing window. */
export async function pricingSignals(
  db: Db,
  input: { townId: string; category: string; product: DynamicProduct },
  now = new Date(),
): Promise<PricingSignals & { spotDays: number; capacityDays: number }> {
  const since = new Date(now.getTime() - PRICING_RULES.windowDays * DAY);
  const ran = await db
    .select({
      businessId: placements.businessId,
      startsAt: placements.startsAt,
      endsAt: placements.endsAt,
    })
    .from(placements)
    .where(
      and(
        eq(placements.townId, input.townId),
        eq(placements.product, input.product),
        eq(placements.category, input.category),
        inArray(placements.status, [...RAN]),
        isNotNull(placements.startsAt),
        lt(placements.startsAt, now),
        or(isNull(placements.endsAt), gt(placements.endsAt, since)),
      ),
    );
  const intervals = new Map<string, Array<[number, number]>>();
  let spotDays = 0;
  for (const p of ran) {
    const from = Math.max(p.startsAt!.getTime(), since.getTime());
    const to = Math.min(p.endsAt?.getTime() ?? now.getTime(), now.getTime());
    if (to <= from) continue;
    spotDays += (to - from) / DAY;
    intervals.set(p.businessId, [...(intervals.get(p.businessId) ?? []), [from, to]]);
  }
  const places = input.product === 'sponsored_slot' ? featuredRanks.length : 1;
  const capacityDays = places * PRICING_RULES.windowDays;
  const fillRate = Math.min(1, spotDays / capacityDays);

  // Delivered value: card clicks, calls and quote requests while a business held the product.
  let actions = 0;
  const ids = [...intervals.keys()];
  if (ids.length) {
    const during = (id: string | null, at: number) =>
      (intervals.get(id ?? '') ?? []).some(([a, b]) => at >= a && at < b);
    const slots =
      input.product === 'sponsored_slot' ? [SPONSOR_SLOT, TOP_SPOT_SLOT] : [CATEGORY_SPONSOR_SLOT];
    for (const row of await db
      .select({
        businessId: slotStatsDaily.businessId,
        day: slotStatsDaily.day,
        clicks: slotStatsDaily.clicks,
      })
      .from(slotStatsDaily)
      .where(
        and(
          eq(slotStatsDaily.townId, input.townId),
          inArray(slotStatsDaily.slot, slots),
          inArray(slotStatsDaily.businessId, ids),
          gte(slotStatsDaily.day, since.toISOString().slice(0, 10)),
        ),
      ))
      if (during(row.businessId, new Date(`${row.day}T12:00:00Z`).getTime())) actions += row.clicks;
    for (const lead of await db
      .select({ businessId: leads.businessId, at: leads.createdAt })
      .from(leads)
      .where(and(inArray(leads.businessId, ids), gte(leads.createdAt, since))))
      if (during(lead.businessId, lead.at.getTime())) actions++;
  }
  const valuePerSpotMonth = spotDays > 0 ? actions / (spotDays / 30) : 0;

  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(directoryWaitlist)
    .where(
      and(
        eq(directoryWaitlist.townId, input.townId),
        eq(directoryWaitlist.category, input.category),
        eq(directoryWaitlist.status, 'waiting'),
      ),
    );
  // A Checkout started is a placement row, whatever came of it.
  const [started] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(placements)
    .where(
      and(
        eq(placements.townId, input.townId),
        eq(placements.product, input.product),
        eq(placements.category, input.category),
        gte(placements.createdAt, since),
      ),
    );
  const [claimed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, input.townId),
        eq(businesses.category, input.category),
        gte(businesses.claimedAt, since),
      ),
    );
  const [seen] = await db
    .select({ n: sql<number>`coalesce(sum(${slotStatsDaily.impressions}), 0)::int` })
    .from(slotStatsDaily)
    .innerJoin(businesses, eq(businesses.id, slotStatsDaily.businessId))
    .where(
      and(
        eq(slotStatsDaily.townId, input.townId),
        eq(slotStatsDaily.slot, CTA_SLOT),
        eq(businesses.category, input.category),
        gte(slotStatsDaily.day, since.toISOString().slice(0, 10)),
      ),
    );
  return {
    fillRate: Math.round(fillRate * 1000) / 1000,
    waitlist: waiting?.n ?? 0,
    valuePerSpotMonth: Math.round(valuePerSpotMonth * 10) / 10,
    checkoutStarts: started?.n ?? 0,
    claims: claimed?.n ?? 0,
    exposure: seen?.n ?? 0,
    spotDays: Math.round(spotDays * 10) / 10,
    capacityDays,
  };
}

async function setPrice(
  db: Db,
  input: {
    townId: string;
    category: string;
    product: DirectoryProduct;
    rank: FeaturedRank | null;
    cents: number;
    setBy: 'monthly' | 'approved' | 'override';
  },
  now: Date,
) {
  await db
    .insert(directoryPrices)
    .values({
      townId: input.townId,
      category: input.category,
      product: input.product,
      rank: input.rank,
      amountCents: input.cents,
      setBy: input.setBy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        directoryPrices.townId,
        directoryPrices.category,
        directoryPrices.product,
        directoryPrices.rank,
      ],
      set: { amountCents: input.cents, setBy: input.setBy, updatedAt: now },
    });
}

export type PricingRunResult = {
  towns: number;
  evaluated: number;
  changed: number;
  proposed: number;
};

/**
 * The monthly recalculation: once per town and local month (pricing_runs), for every category
 * with active listings and every category product that is on. A town in the `hold` arm of the
 * `monthly-pricing` experiment keeps its prices that month. Proposals left from an earlier month
 * expire, so an admin only ever decides on current numbers.
 */
export async function runMonthlyPricing(db: Db, now = new Date()): Promise<PricingRunResult> {
  const result: PricingRunResult = { towns: 0, evaluated: 0, changed: 0, proposed: 0 };
  for (const town of await db.select().from(towns).where(ne(towns.status, 'paused'))) {
    const month = localMonth(now, town.timezone);
    const variant = await townVariant(db, 'monthly-pricing', town);
    const [run] = await db
      .insert(pricingRuns)
      .values({ townId: town.id, month, variant, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: pricingRuns.id });
    if (!run) continue;
    result.towns++;
    await db
      .update(priceChanges)
      .set({ status: 'expired', decidedAt: now })
      .where(
        and(
          eq(priceChanges.townId, town.id),
          eq(priceChanges.status, 'proposed'),
          lt(priceChanges.month, month),
        ),
      );
    if (variant === 'hold') continue;
    const categories = await db
      .selectDistinct({ category: businesses.category })
      .from(businesses)
      .where(and(eq(businesses.townId, town.id), eq(businesses.active, true)));
    let evaluated = 0;
    let changed = 0;
    let proposed = 0;
    for (const { category } of categories) {
      if (!category || !directoryCategory(category)) continue;
      for (const product of DYNAMIC_PRODUCTS) {
        if (!productEnabled(product)) continue;
        const signals = await pricingSignals(db, { townId: town.id, category, product }, now);
        const ranks: Array<FeaturedRank | null> = directoryProducts[product].ranked
          ? [...featuredRanks]
          : [null];
        for (const rank of ranks) {
          const listCents = listPriceCents(townPricing(town), product, rank);
          const currentCents = await categoryPrice(db, town, product, category, rank);
          if (listCents === null || currentCents === null) continue;
          evaluated++;
          const decision = decidePrice({ currentCents, listCents, signals });
          if (decision.status === 'unchanged') continue;
          await db.insert(priceChanges).values({
            townId: town.id,
            category,
            product,
            rank,
            month,
            kind: 'monthly',
            oldCents: currentCents,
            newCents: decision.newCents,
            status: decision.status,
            reason: decision.reason,
            inputs: { ...signals, listCents, step: Math.round(decision.step * 1000) / 1000 },
            createdAt: now,
          });
          if (decision.status === 'applied') {
            await setPrice(
              db,
              {
                townId: town.id,
                category,
                product,
                rank,
                cents: decision.newCents,
                setBy: 'monthly',
              },
              now,
            );
            changed++;
          } else proposed++;
        }
      }
    }
    await db
      .update(pricingRuns)
      .set({ evaluated, changed, proposed })
      .where(eq(pricingRuns.id, run.id));
    result.evaluated += evaluated;
    result.changed += changed;
    result.proposed += proposed;
  }
  return result;
}

export class PricingError extends Error {}

/** An admin approves or rejects a proposed change (audited). Approval sets the price. */
export async function decidePriceProposal(
  db: Db,
  input: { changeId: string; staffId: string; decision: 'approve' | 'reject' },
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .update(priceChanges)
    .set({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: input.staffId,
      decidedAt: now,
    })
    .where(and(eq(priceChanges.id, input.changeId), eq(priceChanges.status, 'proposed')))
    .returning();
  if (!row) throw new PricingError('This proposal was already decided or has expired.');
  if (input.decision === 'approve')
    await setPrice(
      db,
      {
        townId: row.townId,
        category: row.category,
        product: row.product,
        rank: row.rank as FeaturedRank | null,
        cents: row.newCents,
        setBy: 'approved',
      },
      now,
    );
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'approve' ? 'directory.price.approve' : 'directory.price.reject',
    target: { type: 'price_change', id: row.id },
    detail: {
      townId: row.townId,
      category: row.category,
      product: row.product,
      rank: row.rank,
      oldCents: row.oldCents,
      newCents: row.newCents,
    },
  });
}

/**
 * An admin sets a category's price by hand (audited, with a reason). Still one price for every
 * business in the category; existing subscriptions keep theirs.
 */
export async function overridePrice(
  db: Db,
  input: {
    townId: string;
    category: string;
    product: DirectoryProduct;
    rank: FeaturedRank | null;
    dollars: number;
    staffId: string;
    reason: string;
  },
  now = new Date(),
): Promise<void> {
  const [town] = await db.select().from(towns).where(eq(towns.id, input.townId));
  if (!town) throw new PricingError('Unknown town.');
  if (!directoryCategory(input.category)) throw new PricingError('Unknown category.');
  if (!isDynamicProduct(input.product)) throw new PricingError('That product has one town price.');
  if (directoryProducts[input.product].ranked !== Boolean(input.rank))
    throw new PricingError('Pick a featured spot for featured prices, and none otherwise.');
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new PricingError('Say why the price changes.');
  const cents = Math.round(input.dollars) * 100;
  const list = listPriceCents(townPricing(town), input.product, input.rank)!;
  if (!Number.isFinite(cents) || cents < 100 || cents > list * 5)
    throw new PricingError(`Pick a whole-dollar price from $1 to $${(list * 5) / 100}.`);
  const old = (await categoryPrice(db, town, input.product, input.category, input.rank)) ?? list;
  const [change] = await db
    .insert(priceChanges)
    .values({
      townId: town.id,
      category: input.category,
      product: input.product,
      rank: input.rank,
      month: localMonth(now, town.timezone),
      kind: 'override',
      oldCents: old,
      newCents: cents,
      status: 'applied',
      reason,
      inputs: { listCents: list },
      decidedBy: input.staffId,
      decidedAt: now,
      createdAt: now,
    })
    .returning({ id: priceChanges.id });
  await setPrice(
    db,
    {
      townId: town.id,
      category: input.category,
      product: input.product,
      rank: input.rank,
      cents,
      setBy: 'override',
    },
    now,
  );
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'directory.price.override',
    target: { type: 'price_change', id: change!.id },
    detail: {
      townId: town.id,
      category: input.category,
      product: input.product,
      rank: input.rank,
      oldCents: old,
      newCents: cents,
      reason,
    },
  });
}

export type PriceChangeRow = typeof priceChanges.$inferSelect & {
  townName: string;
  /** For increases: what happened after, to watch for harm. */
  after: {
    cancellations: number;
    cancellationsBefore: number;
    optOuts: number;
    complaints: number;
  } | null;
};

/**
 * Recent price changes and proposals for Admin → Directory → Pricing, newest first. An increase
 * shows the category's cancellations in the 60 days after it against the 60 days before, and
 * owner unsubscribes and complaints in the town in the 30 days after.
 */
export async function priceHistory(
  db: Db,
  input: { statuses?: Array<(typeof priceChanges.$inferSelect)['status']>; limit?: number } = {},
  now = new Date(),
): Promise<PriceChangeRow[]> {
  const rows = await db
    .select({ change: priceChanges, townName: towns.name })
    .from(priceChanges)
    .innerJoin(towns, eq(towns.id, priceChanges.townId))
    .where(input.statuses ? inArray(priceChanges.status, input.statuses) : undefined)
    .orderBy(desc(priceChanges.createdAt))
    .limit(input.limit ?? 50);
  const out: PriceChangeRow[] = [];
  for (const { change, townName } of rows) {
    let after: PriceChangeRow['after'] = null;
    const applied = ['applied', 'approved'].includes(change.status);
    if (applied && change.newCents > change.oldCents) {
      const at = (change.decidedAt ?? change.createdAt).getTime();
      const window = (from: number, to: number) =>
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(placements)
          .where(
            and(
              eq(placements.townId, change.townId),
              eq(placements.product, change.product),
              eq(placements.category, change.category),
              inArray(placements.status, ['canceled', 'expired']),
              gte(placements.endsAt, new Date(from)),
              lt(placements.endsAt, new Date(Math.min(to, now.getTime()))),
            ),
          );
      const [cancel] = await window(at, at + 60 * DAY);
      const [before] = await window(at - 60 * DAY, at);
      const until = new Date(Math.min(at + 30 * DAY, now.getTime()));
      const [optOuts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(businesses)
        .where(
          and(
            eq(businesses.townId, change.townId),
            gte(businesses.ownerMailOptOutAt, new Date(at)),
            lt(businesses.ownerMailOptOutAt, until),
          ),
        );
      const [complaints] = await db
        .select({ n: sql<number>`count(distinct ${suppressions.email})::int` })
        .from(suppressions)
        .innerJoin(businesses, sql`${suppressions.email} = lower(${businesses.claimedByEmail})`)
        .where(
          and(
            eq(businesses.townId, change.townId),
            eq(suppressions.reason, 'complaint'),
            gte(suppressions.createdAt, new Date(at)),
            lt(suppressions.createdAt, until),
          ),
        );
      after = {
        cancellations: cancel?.n ?? 0,
        cancellationsBefore: before?.n ?? 0,
        optOuts: optOuts?.n ?? 0,
        complaints: complaints?.n ?? 0,
      };
    }
    out.push({ ...change, townName, after });
  }
  return out;
}

export type CategoryPriceRow = {
  category: string;
  categoryName: string;
  product: DynamicProduct;
  rank: FeaturedRank | null;
  listCents: number;
  currentCents: number;
  setBy: 'list' | 'monthly' | 'approved' | 'override';
  updatedAt: Date | null;
};

/**
 * A town's category prices that differ from the list price, plus the list prices themselves
 * (category ''), for Admin → Directory → Pricing.
 */
export async function townPriceBoard(
  db: Db,
  townId: string,
): Promise<{ list: CategoryPriceRow[]; categories: CategoryPriceRow[] }> {
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) return { list: [], categories: [] };
  const pricing = townPricing(town);
  const list: CategoryPriceRow[] = [];
  for (const product of DYNAMIC_PRODUCTS) {
    const ranks: Array<FeaturedRank | null> = directoryProducts[product].ranked
      ? [...featuredRanks]
      : [null];
    for (const rank of ranks) {
      const cents = listPriceCents(pricing, product, rank)!;
      list.push({
        category: '',
        categoryName: 'Every category (list price)',
        product,
        rank,
        listCents: cents,
        currentCents: cents,
        setBy: 'list',
        updatedAt: null,
      });
    }
  }
  const rows = await db
    .select()
    .from(directoryPrices)
    .where(eq(directoryPrices.townId, townId))
    .orderBy(directoryPrices.category, directoryPrices.product, directoryPrices.rank);
  const names = new Map(directoryCategories.map((c) => [c.slug, c.name]));
  return {
    list,
    categories: rows
      .filter((r) => isDynamicProduct(r.product))
      .map((r) => ({
        category: r.category,
        categoryName: names.get(r.category) ?? r.category,
        product: r.product as DynamicProduct,
        rank: r.rank as FeaturedRank | null,
        listCents: listPriceCents(pricing, r.product, r.rank as FeaturedRank | null)!,
        currentCents: r.amountCents,
        setBy: r.setBy,
        updatedAt: r.updatedAt,
      })),
  };
}
