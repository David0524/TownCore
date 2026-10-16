import { contrastRatio } from './brand';

// Network-wide design tokens for town sites (docs/plans/M4b.md; CLAUDE.md §11a "never varies
// across towns"). Towns choose their palette, fonts and family; these colors mean the same
// thing on every site, so readers and advertisers learn them once. Values from the approved
// design canvas (revision 4).

/** Category colors, shown as small dots and glyphs, never as filled sections. */
export const categoryColors = {
  news: '#0E6FA8',
  events: '#B83C82',
  dining: '#D2432C',
  todo: '#0B7A7A',
  business: '#1F7A4D',
  homes: '#6B4FBF',
  // Schools when it's a reader category of its own (D-M4b-4); the schools beat stays news blue.
  schools: '#5856D6',
} as const;
export type Category = keyof typeof categoryColors;

/** Which category color each beat wears. Beats stay the editorial unit (D-M4b-4). */
export const beatCategory: Record<string, Category> = {
  government: 'news',
  development: 'news',
  schools: 'news',
  'public-safety': 'news',
  business: 'business',
  community: 'events',
};

export const systemColors = {
  /** Secondary text, before per-town darkening (see deriveMuted). */
  muted: '#5C6570',
  /** Hairlines between items. Decoration only, never text. */
  rule: '#E4E7EB',
  /** The sponsored tile: the same warm sand behind every paid unit, network-wide (Rule 6). */
  sand: '#FBF3E2',
  /** Real warnings only (NWS alerts, closures). Never decorative. */
  alert: '#F5A524',
  alertText: '#111418',
} as const;

/** Dark-mode roles (built now, shipped later): near-black page, lifted tiles. */
/**
 * Food tiles (owner, 2026-10-16: "add some color"): a soft tint and a deep ink per flavor of
 * place, the same network-wide, for the drawn icon tiles on new places to eat. Decoration only:
 * every ink is at least 4.5:1 on its tint, and text never sits on a tile.
 */
export const foodColors = {
  tomato: { tint: '#FDE7E0', ink: '#A8321C' },
  saffron: { tint: '#FCEFD0', ink: '#7E5000' },
  basil: { tint: '#E2F1DF', ink: '#2C6B30' },
  ocean: { tint: '#DDEFF7', ink: '#0D5E80' },
  berry: { tint: '#F6E3EF', ink: '#8E2A66' },
  cocoa: { tint: '#F0E6DD', ink: '#6E4326' },
} as const;
export type FoodColor = keyof typeof foodColors;

/** The same flavors on a dark page. */
export const darkFoodColors: Record<FoodColor, { tint: string; ink: string }> = {
  tomato: { tint: '#3A1E17', ink: '#F4A08B' },
  saffron: { tint: '#352A12', ink: '#F0C66B' },
  basil: { tint: '#1C2E1D', ink: '#9BD39A' },
  ocean: { tint: '#14293A', ink: '#8CC9E6' },
  berry: { tint: '#331B2B', ink: '#E7A2CB' },
  cocoa: { tint: '#2E231B', ink: '#D9B08F' },
};

export const darkColors = {
  background: '#0E1013',
  surface: '#1A1D21',
  tint: '#1A1D21',
  ink: '#E8EAED',
  muted: '#A2A9B1',
  rule: '#2A2E33',
  sand: '#2A2620',
} as const;

const AA = 4.5;

function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/**
 * Secondary text color for a town: the network grey, darkened toward the town's ink just enough
 * to pass AA on every light surface it sits on (background, surface, tint, the sand tile).
 */
export function deriveMuted(palette: {
  ink: string;
  background: string;
  surface: string;
  tint: string;
}): string {
  const surfaces = [palette.background, palette.surface, palette.tint, systemColors.sand];
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = mix(systemColors.muted, palette.ink, t);
    if (surfaces.every((bg) => contrastRatio(candidate, bg) >= AA)) return candidate;
  }
  return palette.ink;
}

/**
 * The deep brand shade behind the site's own promotions (house ads): the brand color taken
 * halfway toward the ink, or toward the page when the brand carries dark text, so the brand's
 * own text color reads even better on it than on the brand itself.
 */
export function deriveDeep(palette: {
  ink: string;
  background: string;
  accent: string;
  accentText: string;
}): string {
  const toward =
    contrastRatio(palette.accentText, palette.ink) >
    contrastRatio(palette.accentText, palette.background)
      ? palette.ink
      : palette.background;
  return mix(palette.accent, toward, 0.5);
}

/**
 * Phone chrome (below 600px, every town; docs/plans/M4b.md revision 5): iOS system colors and
 * Apple's system font stacks. The town's brand stays the tint. Secondary label is iOS's
 * #6E6E73 (it passes AA on white and grouped gray), darkened per town when a tint needs it.
 */
export const iosColors = {
  label: '#000000',
  secondaryLabel: '#6E6E73',
  separator: '#C6C6C8',
  grouped: '#F2F2F7',
  /** Text-field and capsule fill. */
  fill: 'rgba(118, 118, 128, 0.12)',
  /** Tab bar: translucent over content, solid when the reader asks for less transparency. */
  chrome: 'rgba(249, 249, 249, 0.94)',
  chromeSolid: '#F9F9F9',
  /** Switch track when on (iOS system green). Graphic only, never text. */
  switchOn: '#34C759',
  switchOff: '#E3E7EC',
  /** Sheet backdrop. */
  scrim: 'rgba(0, 0, 0, 0.4)',
} as const;

/** System stacks only: Apple devices get San Francisco and New York; we never ship their files. */
export const iosFonts = {
  text: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",
  display:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif",
  serif: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif",
} as const;

/** Corner radii of the iOS shapes (canvas HomePhone): fields, grouped lists, buttons, widgets. */
export const iosRadii = {
  field: '10px',
  button: '12px',
  group: '14px',
  widget: '22px',
  capsule: '999px',
} as const;

/** Secondary label on phones: iOS gray, darkened toward black where a town's tint needs it. */
export function phoneSecondaryLabel(palette: { tint: string; background: string }): string {
  const surfaces = [palette.background, palette.tint, iosColors.grouped, systemColors.sand];
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = mix(iosColors.secondaryLabel, iosColors.label, t);
    if (surfaces.every((bg) => contrastRatio(candidate, bg) >= AA)) return candidate;
  }
  return iosColors.label;
}
