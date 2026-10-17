import type { DirectoryProduct, FeaturedRank } from './directory';
import type { TownTier } from './town';

// Directory prices (owner, 2026-10-17: "Grow ad and directory revenue"). Every town starts from
// its tier's price list; a town's YAML `pricing` may override any of it. From there, each town,
// category and product has one current price for everyone, recalculated once a month from real
// aggregate signals (fill rate, waitlist, delivered value, interest), inside guardrails kept here
// in code: at most ±20% a month, never below the list price less 40%, a ceiling of twice the list
// price, and increases past a threshold wait for an admin. Existing subscriptions keep their
// Stripe Price (grandfathered); a new price applies to new bookings only.

/** Whole dollars: featured spots #1–#3 and Enhanced a month, the category month, the email week. */
export type PriceList = {
  featured_usd: [number, number, number];
  enhanced_usd: number;
  category_month_usd: number;
  newsletter_week_usd: number;
};

/** The starting price list per town tier (owner, 2026-10-17). */
export const TIER_PRICES: Record<TownTier, PriceList> = {
  small: {
    featured_usd: [9, 6, 4],
    enhanced_usd: 19,
    category_month_usd: 25,
    newsletter_week_usd: 15,
  },
  mid: {
    featured_usd: [14, 9, 5],
    enhanced_usd: 29,
    category_month_usd: 45,
    newsletter_week_usd: 30,
  },
  large: {
    featured_usd: [19, 12, 7],
    enhanced_usd: 39,
    category_month_usd: 75,
    newsletter_week_usd: 45,
  },
};

export type TownPricing = PriceList & { free_trial_days: number };

/**
 * A town's list prices: its tier's, with any `pricing` from its YAML on top. Older configs that
 * set every field keep working unchanged.
 */
export function townPricing(town: { tier: TownTier | string; config: unknown }): TownPricing {
  const tier = (town.tier in TIER_PRICES ? town.tier : 'small') as TownTier;
  const own = ((town.config as { pricing?: Partial<TownPricing> } | null)?.pricing ??
    {}) as Partial<TownPricing>;
  const base = TIER_PRICES[tier];
  return {
    featured_usd: own.featured_usd ?? base.featured_usd,
    enhanced_usd: own.enhanced_usd ?? base.enhanced_usd,
    category_month_usd: own.category_month_usd ?? base.category_month_usd,
    newsletter_week_usd: own.newsletter_week_usd ?? base.newsletter_week_usd,
    free_trial_days: own.free_trial_days ?? 30,
  };
}

/** The list price in cents for a product (and featured rank), or null when it has none. */
export function listPriceCents(
  pricing: TownPricing,
  product: DirectoryProduct,
  rank?: FeaturedRank | null,
): number | null {
  switch (product) {
    case 'sponsored_slot':
      return rank ? pricing.featured_usd[rank - 1]! * 100 : null;
    case 'enhanced':
      return pricing.enhanced_usd * 100;
    case 'exclusive':
      return pricing.category_month_usd * 100;
    case 'newsletter':
      return pricing.newsletter_week_usd * 100;
    default:
      return null;
  }
}

/**
 * Products priced per category and recalculated monthly. Enhanced and the newsletter week keep
 * the town's list price (Enhanced has no scarcity; the newsletter isn't per category).
 */
export const DYNAMIC_PRODUCTS = [
  'sponsored_slot',
  'exclusive',
] as const satisfies readonly DirectoryProduct[];
export type DynamicProduct = (typeof DYNAMIC_PRODUCTS)[number];
export const isDynamicProduct = (p: DirectoryProduct): p is DynamicProduct =>
  (DYNAMIC_PRODUCTS as readonly string[]).includes(p);

/** The guardrails and the formula's thresholds. Starting values; tune with data. */
export const PRICING_RULES = {
  /** The signals look back this far. */
  windowDays: 60,
  /** At most this change in one month, either way. */
  maxStep: 0.2,
  /** Never below the list price less 40%. */
  floorFactor: 0.6,
  /** Above twice the list price, a change needs an admin. */
  ceilingFactor: 2,
  /** An increase larger than this needs an admin's approval. */
  approvalStep: 0.1,
  /** Fill rate (sold spot-days over available) that counts as sold out, and as busy. */
  fullFill: 0.9,
  busyFill: 2 / 3,
  /** Below this fill rate, with no waitlist and no checkouts started, a price may come down. */
  lowFill: 1 / 3,
  /** Listing views in the category over the window before "nobody bought" means anything. */
  minExposure: 200,
  /** Card clicks, calls and quote requests per featured spot-month before a price may rise. */
  minValue: 1,
} as const;

export type PricingSignals = {
  /** Sold spot-days over available spot-days in the window, 0–1. */
  fillRate: number;
  /** Businesses waiting for a spot in the category now. */
  waitlist: number;
  /** Card clicks, calls and quote requests per featured spot-month in the window. */
  valuePerSpotMonth: number;
  /** Checkouts started (any outcome) in the category in the window. */
  checkoutStarts: number;
  /** Listings claimed in the category in the window. */
  claims: number;
  /** Listing views in the category in the window (how many readers saw it at all). */
  exposure: number;
};

export type PriceDecision =
  | { status: 'unchanged'; reason: string; step: number }
  | {
      status: 'applied' | 'proposed';
      newCents: number;
      step: number;
      reason: string;
    };

const dollars = (cents: number) => Math.max(100, Math.round(cents / 100) * 100);

/**
 * The monthly formula, the same for every town and category (no business is ever an input):
 *
 *   step = +10% when the spots were sold ≥ 90% of the time (+5% when ≥ 2/3)
 *        + 5% per business on the waitlist, at most +10%
 *        − 10% when fill < 1/3, nobody waits, no checkout started and ≥ 200 listing views
 *          showed readers were there (−20% when nothing sold at all and views ≥ 1,000)
 *   An increase needs delivered value: ≥ 1 click, call or quote request per spot-month.
 *   The step is capped at ±20%, the result rounded to whole dollars and floored at the list
 *   price less 40%. An increase over 10%, or a price over twice the list price, is a proposal for
 *   an admin instead of a change.
 */
export function decidePrice(input: {
  currentCents: number;
  listCents: number;
  signals: PricingSignals;
}): PriceDecision {
  const r = PRICING_RULES;
  const s = input.signals;
  const why: string[] = [];
  let up = 0;
  if (s.fillRate >= r.fullFill) {
    up += 0.1;
    why.push(`sold ${Math.round(s.fillRate * 100)}% of the time`);
  } else if (s.fillRate >= r.busyFill) {
    up += 0.05;
    why.push(`sold ${Math.round(s.fillRate * 100)}% of the time`);
  }
  if (s.waitlist > 0) {
    up += Math.min(s.waitlist, 2) * 0.05;
    why.push(`${s.waitlist} on the waitlist`);
  }
  if (up > 0 && s.valuePerSpotMonth < r.minValue) {
    return {
      status: 'unchanged',
      step: 0,
      reason: `Demand is up (${why.join(', ')}), but spots delivered ${s.valuePerSpotMonth.toFixed(1)} clicks, calls and quote requests a month, under ${r.minValue}: held.`,
    };
  }
  let step = up;
  if (
    up === 0 &&
    s.fillRate < r.lowFill &&
    s.waitlist === 0 &&
    s.checkoutStarts === 0 &&
    s.exposure >= r.minExposure
  ) {
    step = s.fillRate === 0 && s.exposure >= r.minExposure * 5 ? -0.2 : -0.1;
    why.push(
      `sold ${Math.round(s.fillRate * 100)}% of the time with ${s.exposure} listing views and no checkouts`,
    );
  }
  step = Math.max(-r.maxStep, Math.min(r.maxStep, step));
  if (step === 0)
    return { status: 'unchanged', step: 0, reason: why.length ? why.join(', ') : 'steady' };
  const floor = dollars(input.listCents * r.floorFactor);
  const ceiling = input.listCents * r.ceilingFactor;
  const newCents = Math.max(floor, dollars(input.currentCents * (1 + step)));
  if (newCents === input.currentCents)
    return { status: 'unchanged', step, reason: `${why.join(', ')}; no change in whole dollars` };
  const actual = newCents / input.currentCents - 1;
  // Judged on the formula's step, so rounding to whole dollars never tips a 10% raise over.
  const needsAdmin = step > r.approvalStep + 1e-9 || newCents > ceiling;
  return {
    status: needsAdmin ? 'proposed' : 'applied',
    newCents,
    step: actual,
    reason:
      why.join(', ') +
      (newCents > ceiling
        ? '; above the ceiling, so an admin decides'
        : needsAdmin
          ? `; more than ${r.approvalStep * 100}%, so an admin decides`
          : ''),
  };
}

/** Social proof and reach lines appear only above these real counts. */
export const PROOF_MINIMUMS = {
  /** "12 Boca businesses advertise here". */
  advertisers: 5,
  /** "Reach 4,200 Boca readers every morning": active newsletter subscribers. */
  readers: 250,
  /** "Your listing was seen 214 times": views before the personal proof line shows. */
  listingViews: 10,
  /** "Your numbers look good" prompt after a report: listing views last month. */
  goodMonthViews: 50,
} as const;

/** "2 of 3 featured spots open in Plumbers", from real inventory. */
export function scarcityLine(open: number, total: number, categoryName: string): string {
  if (open === 0) return `All ${total} featured spots in ${categoryName} are taken.`;
  return `${open} of ${total} featured spots open in ${categoryName}.`;
}
