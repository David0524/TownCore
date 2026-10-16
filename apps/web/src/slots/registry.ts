// The slot contract (CLAUDE.md §11b). Layouts vary; where money appears does not. Heights are
// reserved up front so a filled slot never shifts the page (CLS budget).
//
// Each slot has a format, and every format has a designed house ad at exactly its size
// (docs/plans/M4b.md §3), so a reserved slot never shows empty space:
// - leaderboard: 320×100 on phones, 970×90 from 64rem
// - box: 300×250
// - card: an in-feed card the width of the column

export type SlotFormat = 'leaderboard' | 'box' | 'card';

export type SlotDef = {
  format: SlotFormat;
  /** Reserved height of the unit in px (the label line sits above it), phones and 64rem+. */
  height: { mobile: number; desktop: number };
  /** Advertisement = display unit; Sponsored = sponsor/placement card. */
  paidLabel: 'Sponsored' | 'Advertisement';
};

/** Height of the label line above every unit, in px. */
export const SLOT_LABEL_PX = 24;

export const slots = {
  'home.top': {
    format: 'leaderboard',
    height: { mobile: 100, desktop: 90 },
    paidLabel: 'Sponsored',
  },
  'home.infeed': { format: 'card', height: { mobile: 128, desktop: 112 }, paidLabel: 'Sponsored' },
  'home.directory': {
    format: 'card',
    height: { mobile: 176, desktop: 156 },
    paidLabel: 'Sponsored',
  },
  'home.events': { format: 'card', height: { mobile: 120, desktop: 104 }, paidLabel: 'Sponsored' },
  'rail.box': { format: 'box', height: { mobile: 250, desktop: 250 }, paidLabel: 'Advertisement' },
  'article.inline': {
    format: 'box',
    height: { mobile: 250, desktop: 250 },
    paidLabel: 'Advertisement',
  },
  'article.related-businesses': {
    format: 'card',
    height: { mobile: 160, desktop: 140 },
    paidLabel: 'Sponsored',
  },
  'article.realestate': {
    format: 'card',
    height: { mobile: 120, desktop: 104 },
    paidLabel: 'Sponsored',
  },
  // Directory (M6): category header, the first listing, sponsored listings and the quote form.
  'directory.category.exclusive': {
    format: 'card',
    height: { mobile: 112, desktop: 96 },
    paidLabel: 'Sponsored',
  },
  'directory.topspot': {
    format: 'card',
    height: { mobile: 120, desktop: 104 },
    paidLabel: 'Sponsored',
  },
  'directory.category.top': {
    format: 'card',
    height: { mobile: 120, desktop: 104 },
    paidLabel: 'Sponsored',
  },
  // One sponsored restaurant inside the new-now-open module (docs/plans/M4b.md).
  'dining.featured': {
    format: 'card',
    height: { mobile: 120, desktop: 104 },
    paidLabel: 'Sponsored',
  },
  'directory.quote-request': {
    format: 'card',
    height: { mobile: 128, desktop: 112 },
    paidLabel: 'Sponsored',
  },
} as const satisfies Record<string, SlotDef>;

export type SlotName = keyof typeof slots;
