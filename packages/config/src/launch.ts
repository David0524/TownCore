// The launcher's steps (CLAUDE.md §10; docs/plans/M7.md §2). A launch run has one record per
// step, so a stopped run resumes where it left off.

export const launchSteps = [
  'resolve',
  'names',
  'sources',
  'adapters',
  'readiness',
  'seed',
  'theme',
  'provision',
  'report',
] as const;
export type LaunchStep = (typeof launchSteps)[number];

export const launchStepLabels: Record<LaunchStep, string> = {
  resolve: '1. Resolve the town',
  names: '2. Names and domains',
  sources: '3. Discover sources',
  adapters: '4. Match adapters',
  readiness: '5. Readiness',
  seed: '6. Seed content',
  theme: '6b. Theme, layout and identity',
  provision: '7. Provision',
  report: '8. Launch report',
};

/**
 * Town size by population, which sets the daily story budget (3 / 6 / 10 items) and the readiness
 * bar (Rule 7: at least 3 items a day, 10 for `large`). Boca Raton, at about 100,000, is large.
 */
export const tierThresholds = { mid: 30_000, large: 100_000 };

export function tierForPopulation(population: number): 'small' | 'mid' | 'large' {
  if (population >= tierThresholds.large) return 'large';
  if (population >= tierThresholds.mid) return 'mid';
  return 'small';
}

/** Rule 7 (CLAUDE.md §10 step 5): real items a day a town must reach to launch. */
export const readinessMinimum: Record<'small' | 'mid' | 'large', number> = {
  small: 3,
  mid: 3,
  large: 10,
};

/** How many days of each source the readiness step reads. */
export const READINESS_DAYS = 30;

/** AI spend cap for one launch run, across all its steps (D-M7-11). */
export const LAUNCH_AI_CAP_USD = 25;
