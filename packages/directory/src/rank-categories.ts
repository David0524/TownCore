import type { DirectoryCategory } from '@towncore/config';

// The order kinds of business appear in, everywhere in the directory (owner, 2026-10-17: "none
// of the business categories should be in alphabetical order. It looks like a data set"). One
// ranking, network-wide, so the kinds bar, the homepage tiles, the directory's opening kind and
// any category chooser agree:
//
//   score = 0.55 × demand prior + 0.25 × size in this town + 0.20 × reader interest
//
// - Demand prior: how often readers of a local site look for this kind, network-wide (dining,
//   coffee and the everyday home trades first; rare license kinds last). Set by hand below and
//   tuned as real interest arrives across towns.
// - Size: the kind's listing count in the town, log-scaled against its biggest kind, so 700
//   general contractors don't bury 20 coffee shops, but an empty-ish kind doesn't lead.
// - Reader interest: how much more (or less) a kind's listing pages were viewed over the last 30
//   whole days than its prior predicts, as a lift between 0 and 2, smoothed with 100
//   pseudo-views per kind spread by the prior, so a few clicks can't reorder the bar and a town
//   without views ranks on prior and size alone. Views of listings holding a paid placement are
//   left out by the query, and nothing else here knows about money: payment never moves a kind
//   (Rule 6).
//
// Ties break by a hash of the kind and the day, never by name, so the order is the same for
// every reader all day and needs no A–Z fallback.

/** Network-wide prior of reader demand per kind, 0–1. Kinds not listed get DEFAULT_DEMAND. */
export const CATEGORY_DEMAND: Readonly<Record<string, number>> = {
  restaurants: 1,
  'coffee-and-bakeries': 0.9,
  'takeout-and-counter': 0.85,
  'health-and-medical': 0.85,
  plumbers: 0.8,
  hvac: 0.8,
  'beauty-and-wellness': 0.8,
  automotive: 0.75,
  electricians: 0.75,
  'bars-and-nightlife': 0.75,
  'grocery-and-markets': 0.75,
  'general-contractors': 0.7,
  roofers: 0.7,
  'real-estate': 0.7,
  shopping: 0.7,
  fitness: 0.65,
  entertainment: 0.6,
  'pool-and-spa': 0.55,
  pets: 0.55,
  'childcare-and-education': 0.55,
  'professional-services': 0.55,
  hotels: 0.5,
  'personal-services': 0.5,
  'banks-and-finance': 0.45,
  solar: 0.45,
  caterers: 0.4,
  'alarm-systems': 0.35,
  'food-trucks': 0.35,
};
export const DEFAULT_DEMAND = 0.3;

export const RANK_WEIGHTS = { demand: 0.55, size: 0.25, interest: 0.2 } as const;
/** Pseudo-views per kind that hold interest at the prior until real views outweigh them. */
export const INTEREST_SMOOTHING = 100;
/** The most a kind's interest lift counts: twice what its prior predicts. */
const MAX_LIFT = 2;
/** Whole days of listing views that count as reader interest. */
export const INTEREST_DAYS = 30;

export const demandOf = (slug: string) => CATEGORY_DEMAND[slug] ?? DEFAULT_DEMAND;

/** A stable 32-bit hash (FNV-1a): the daily tie-break, the same on every server. */
export function dailyHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The kinds in ranked order, best first. `views` is listing page views per kind slug over the
 * last INTEREST_DAYS whole days (from rankingViews); `day` (YYYY-MM-DD, the town's local date)
 * seeds the tie-break. Pure and deterministic for the same inputs.
 */
export function rankCategories<T extends { category: DirectoryCategory; count: number }>(
  rows: readonly T[],
  { views = new Map<string, number>(), day }: { views?: ReadonlyMap<string, number>; day: string },
): T[] {
  if (rows.length < 2) return [...rows];
  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  const priorTotal = rows.reduce((n, r) => n + demandOf(r.category.slug), 0);
  const seen = (slug: string) => Math.max(0, views.get(slug) ?? 0);
  const pseudo = INTEREST_SMOOTHING * rows.length;
  const viewTotal = rows.reduce((n, r) => n + seen(r.category.slug), 0) + pseudo;
  const scored = rows.map((row) => {
    const slug = row.category.slug;
    // Smoothed share of views against the share the prior expects: 1 with no data.
    const expected = demandOf(slug) / priorTotal;
    const lift = (seen(slug) + pseudo * expected) / viewTotal / expected;
    const score =
      RANK_WEIGHTS.demand * demandOf(slug) +
      RANK_WEIGHTS.size * (Math.log1p(row.count) / Math.log1p(maxCount)) +
      RANK_WEIGHTS.interest * (Math.min(lift, MAX_LIFT) / MAX_LIFT);
    return { row, score, tie: dailyHash(`${slug}|${day}`) };
  });
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return scored.map((s) => s.row);
}
