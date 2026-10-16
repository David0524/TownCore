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
  development: ['map', 'data-graphic', 'ai-illustration', 'typographic-card'],
  government: ['data-graphic', 'government-image', 'ai-illustration', 'typographic-card'],
  business: ['business-photo', 'ai-illustration', 'typographic-card'],
  // No illustration for public safety: a drawing beside crime news editorializes.
  'public-safety': ['map', 'typographic-card'],
  schools: ['data-graphic', 'ai-illustration', 'typographic-card'],
  community: ['reader-photo', 'stock', 'ai-illustration', 'typographic-card'],
  weather: ['reader-photo', 'stock', 'ai-illustration', 'typographic-card'],
  guide: ['ai-illustration', 'stock', 'typographic-card'],
};

/**
 * Roundups are counts of records, so a data graphic built from those records leads for them on
 * any beat (§11c: "built from the story's own source records"); a section illustration next.
 */
export const roundupImageDefaults: readonly ImageKind[] = [
  'data-graphic',
  'ai-illustration',
  'typographic-card',
];

/** A bar chart of counts per day, built only from the story's own records. */
export type DailyCountsSpec = {
  type: 'daily-counts';
  /** What is counted, plural: "new business filings". */
  label: string;
  /** One bar per local day, oldest first. Days with none are included as zero. */
  bars: Array<{ date: string; count: number }>;
  total: number;
};

/**
 * A block-level map (§11c; D-M4-1): streets around a point snapped to its block, drawn from our
 * OpenStreetMap base map. Lines are pre-projected into a 1200×675 view (SVG path data), so a
 * page draws it without the base map. Never more precise than the block.
 */
export type MapSpec = {
  type: 'map';
  /** "1200 block of SW 12th Ave": what the marker shows. Never a house number. */
  label: string;
  street: string;
  /** The block's center, [lon, lat], from the Census Geocoder. */
  center: [number, number];
  /** Meters across the view. */
  widthMeters: number;
  lines: Array<{ c: 'major' | 'secondary' | 'minor' | 'water' | 'coast'; d: string }>;
  /** Street names to print, placed along their line. */
  labels: Array<{ text: string; x: number; y: number; angle: number }>;
  /** The marker's center and radius in view units (radius about half a block). */
  marker: { x: number; y: number; r: number };
};

export const MAP_VIEW = { width: 1200, height: 675 } as const;

/**
 * A licensed stock photo (§11c), only as a generic illustration for an evergreen guide. Shown
 * from the provider's own servers (Unsplash requires hotlinking), always captioned "Stock photo"
 * and credited. Links are stored untagged; the page adds the provider's referral tags.
 */
export type StockPhotoSpec = {
  type: 'stock';
  provider: 'unsplash';
  photoId: string;
  /** The provider's base image URL; the page asks for sized, cropped versions of it. */
  src: string;
  width: number;
  height: number;
  /** The photo's average color, shown while it loads. */
  color: string | null;
  photographer: string;
  photographerUrl: string;
  /** The photo's page on the provider's site. */
  photoUrl: string;
};

/**
 * A photo someone sent us (M9): a reader's or contributor's (`reader-photo`), a business's own
 * (`business-photo`), or an AI illustration a person approved (`ai-illustration`). Served from
 * the town's own domain at /photos/<photoId>.jpg, always with its credit line; a reader photo
 * also shows its sender's caption, so it never passes as the scene of the story.
 */
export type PhotoSpec = {
  type: 'photo';
  photoId: string;
  width: number;
  height: number;
  caption: string;
  credit: string;
  takenWhere: string | null;
  takenWhen: string | null;
};

/**
 * A section illustration from the network library (§11c, packages/config/src/illustrations.ts):
 * a generic, owner-approved AI illustration of a kind of thing, never the story's scene. Served
 * from /illustrations/<illustrationId>.webp and always labeled.
 */
export type IllustrationSpec = {
  type: 'illustration';
  illustrationId: string;
  width: number;
  height: number;
  /** Chosen for this story by a person (`pnpm illustrations pin`): the router never replaces it. */
  pinned?: boolean;
  /** Photorealistic rather than drawn (owner, 2026-10-16): labeled as an AI image, not an illustration. */
  photoreal?: boolean;
};

export const illustrationSrc = (id: string) => `/illustrations/${id}.webp`;

/** The label every AI illustration carries, on the page and in its alt text (§11c). */
export const AI_ILLUSTRATION_LABEL = 'Illustration (AI-generated)';
export const AI_IMAGE_LABEL = 'Image (AI-generated)';
/** The label an AI picture carries: an illustration, or a photorealistic image. */
export const aiLabel = (spec: { photoreal?: boolean }) =>
  spec.photoreal ? AI_IMAGE_LABEL : AI_ILLUSTRATION_LABEL;

export type ImageSpec =
  DailyCountsSpec | MapSpec | StockPhotoSpec | PhotoSpec | IllustrationSpec | { type: 'card' };
