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
