// Choosing towns (CLAUDE.md §10a; docs/plans/M7.md §1). The weights live here so they can be
// tuned as real revenue data arrives; `pnpm towns:rank` reads them and records them in its report.

export const rankingInputs = [
  'business_value',
  'households_x_income',
  'source_readiness',
  'coverage_gap',
  'cluster_fit',
  'growth',
] as const;
export type RankingInput = (typeof rankingInputs)[number];

/** §10a: score = 0.25 business_value + 0.20 households_x_income + … (sums to 1). */
export const rankingWeights: Record<RankingInput, number> = {
  business_value: 0.25,
  households_x_income: 0.2,
  source_readiness: 0.2,
  coverage_gap: 0.15,
  cluster_fit: 0.1,
  growth: 0.1,
};

/**
 * High-value business categories (§10a "business density"), as 4-digit NAICS codes counted in
 * Census ZIP Code Business Patterns, with the weight each establishment carries.
 */
export const highValueIndustries: Array<{ naics: string; label: string; weight: number }> = [
  { naics: '2381', label: 'Home services: foundation, structure and exterior', weight: 1 },
  {
    naics: '2382',
    label: 'Home services: building equipment (electrical, plumbing, HVAC)',
    weight: 1,
  },
  { naics: '2383', label: 'Home services: finishing (drywall, painting, flooring)', weight: 1 },
  {
    naics: '5617',
    label: 'Home services: building services (landscaping, pest control)',
    weight: 1,
  },
  { naics: '5411', label: 'Legal', weight: 0.8 },
  { naics: '6211', label: 'Medical: physicians', weight: 0.8 },
  { naics: '6212', label: 'Dental', weight: 0.8 },
  { naics: '5312', label: 'Real estate agents and brokers', weight: 0.8 },
  { naics: '7225', label: 'Restaurants', weight: 0.6 },
];

export const rankingFilters = {
  /** §10a hard filter. */
  minPopulation: 5_000,
  /** Cluster fit is 1 next to an existing town and 0 at this distance or beyond. */
  clusterRadiusMiles: 100,
};

/**
 * Inputs we can't measure yet sit at this neutral value, so they don't reorder towns: news
 * coverage until a Medill data license (D-M7-3), source readiness until the launcher's light
 * check runs on the shortlist (M7 PR D).
 */
export const NEUTRAL_INPUT = 0.5;
