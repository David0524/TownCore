// Article images (CLAUDE.md §11c). Every article gets a visual, and a visual must never mislead.
// The router (packages/pipeline/src/images.ts) picks the first option on the beat's list that it
// can build, and always ends at the typographic card.

export const imageKinds = [
  'map',
  'data-graphic',
  'typographic-card',
  'business-photo',
  'reader-photo',
  'government-image',
  'stock',
  'ai-illustration',
] as const;
export type ImageKind = (typeof imageKinds)[number];

/**
 * Defaults by beat (§11c, "stored in config; the first allowed option wins"). Options that aren't
 * built yet (maps in M4 PR E, photos in M9) are skipped by the router until they are.
 */
export const imageDefaults: Record<string, readonly ImageKind[]> = {
  development: ['map', 'data-graphic', 'typographic-card'],
  government: ['data-graphic', 'government-image', 'typographic-card'],
  business: ['business-photo', 'typographic-card'],
  'public-safety': ['map', 'typographic-card'],
  schools: ['data-graphic', 'typographic-card'],
  community: ['reader-photo', 'stock', 'typographic-card'],
  weather: ['reader-photo', 'stock', 'typographic-card'],
  guide: ['ai-illustration', 'stock', 'typographic-card'],
};

/**
 * Roundups are counts of records, so a data graphic built from those records leads for them on
 * any beat (§11c: "built from the story's own source records").
 */
export const roundupImageDefaults: readonly ImageKind[] = ['data-graphic', 'typographic-card'];

/** A bar chart of counts per day, built only from the story's own records. */
export type DailyCountsSpec = {
  type: 'daily-counts';
  /** What is counted, plural: "new business filings". */
  label: string;
  /** One bar per local day, oldest first. Days with none are included as zero. */
  bars: Array<{ date: string; count: number }>;
  total: number;
};

export type ImageSpec = DailyCountsSpec | { type: 'card' };
