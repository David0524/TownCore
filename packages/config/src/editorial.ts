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
 * Admin display name for staff who haven't set their real name yet (owner's call, 2026-10-15).
 * Bylines never show staff names ("Reviewed by an editor"), so this appears only in the admin.
 */
export const placeholderReviewerName = 'John';

/**
 * Freshness half-life in hours (CLAUDE.md §6a): how fast a story fades from the homepage. By
 * article kind first (alerts, guides), then by beat.
 */
export const freshnessHalfLifeHours = {
  kind: { alert: 6, guide: 120 } as Record<string, number>,
  beat: {
    'public-safety': 12,
    government: 48,
    development: 48,
    schools: 48,
    business: 72,
    community: 48,
  } as Record<string, number>,
  default: 48,
};

/** Engagement can move a story's rank by at most this much either way (§6a). */
export const engagementCap = 0.3;
/** Pseudo-impressions at the town average, so a few clicks can't swing a story. */
export const engagementSmoothing = 50;
/** No more than this many stories in a row from one beat (§6a). */
export const maxSameBeatInARow = 2;

/**
 * Near-duplicate guard (owner, 2026-10-17: "no near-duplicate guides or roundups across towns").
 * The same template built for two towns may share at most this share of its word shingles once
 * town names and numbers are masked (packages/pipeline/src/near-duplicate.ts). CI checks every
 * code-built template against it.
 */
export const NEAR_DUP_MAX = 0.3;
/** Words per shingle: long enough that a shared shingle means a shared phrase, not a word. */
export const NEAR_DUP_SHINGLE_WORDS = 8;
