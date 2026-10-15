import type { BeatSlug } from './theme';
import type { TownConfig, TownTier } from './town';

// Editorial defaults (CLAUDE.md §6a, §7). Per-town overrides live in the town YAML.

/** Items written per day by town size (D-M3-7). */
export const dailyStoryBudget: Record<TownTier, number> = { small: 3, mid: 6, large: 10 };

/** Newsworthiness (0–100) a story candidate needs before it's written (D-M3-7). */
export const defaultScoreThreshold = 40;

/** Public safety may be at most this share of a day's items (§6a). */
export const publicSafetyShare = 0.2;

/**
 * Reader-interest prior by beat (0–1), used until M4 has click data. A starting guess to be
 * replaced by smoothed CTR per town (§6a), not a tuned value.
 */
export const beatInterestPrior: Record<BeatSlug, number> = {
  government: 0.6,
  development: 0.7,
  business: 0.6,
  schools: 0.6,
  'public-safety': 0.7,
  community: 0.5,
};

/** Fact-check thresholds (§7). */
export const factcheckPassScore = 0.95;

/** Share of passing Tier 2 stories sent to review before publishing (§7, D-M3-5). */
export const tier2ReviewSample = 0.1;

export function storyBudgetFor(config: Pick<TownConfig, 'tier' | 'story_budget'>): number {
  return config.story_budget ?? dailyStoryBudget[config.tier];
}

/**
 * Byline name for staff who haven't set their real name yet (owner's call, 2026-10-15). Such
 * staff are marked as placeholders and can't sign stories on a live town (Rule 2).
 */
export const placeholderReviewerName = 'John';
