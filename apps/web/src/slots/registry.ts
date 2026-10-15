// The slot contract (CLAUDE.md §11b). Layouts vary; where money appears does not. Heights are
// reserved up front so a filled slot never shifts the page (CLS budget).

export type SlotDef = {
  /** Reserved height in px on small screens and from 64rem up. */
  height: { mobile: number; desktop: number };
  /** Advertisement = display unit; Sponsored = sponsor/placement card. */
  paidLabel: 'Sponsored' | 'Advertisement';
};

export const slots = {
  'home.top': { height: { mobile: 148, desktop: 112 }, paidLabel: 'Sponsored' },
  'home.infeed': { height: { mobile: 148, desktop: 128 }, paidLabel: 'Sponsored' },
  'home.directory': { height: { mobile: 200, desktop: 180 }, paidLabel: 'Sponsored' },
  'home.events': { height: { mobile: 120, desktop: 110 }, paidLabel: 'Sponsored' },
  'rail.box': { height: { mobile: 250, desktop: 250 }, paidLabel: 'Advertisement' },
  'article.inline': { height: { mobile: 250, desktop: 250 }, paidLabel: 'Advertisement' },
  'article.related-businesses': { height: { mobile: 180, desktop: 160 }, paidLabel: 'Sponsored' },
  'article.realestate': { height: { mobile: 140, desktop: 120 }, paidLabel: 'Sponsored' },
} as const satisfies Record<string, SlotDef>;

export type SlotName = keyof typeof slots;
