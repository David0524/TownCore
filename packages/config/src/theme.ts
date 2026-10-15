import { z } from 'zod';
import { contrastRatio } from './brand';
import { systemColors } from './design';

// Town themes (CLAUDE.md §11a, §11a-2). One component library, a distinct look and layout per
// town. A theme that fails the contrast check fails validation, so it can't be synced ("saved").

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'expected a #RRGGBB color');

export const palette = z.strictObject({
  ink: hex, // headlines, body text, header text on light backgrounds
  accent: hex, // buttons, links, active nav
  accentText: hex, // text on accent fills
  tint: hex, // light fills only, never text
  surface: hex, // cards, rails, bands
  background: hex, // page
  // Optional second action color (heritage's red Subscribe, community's amber sign-up); buttons
  // only. Falls back to accent.
  secondary: hex.optional(),
  secondaryText: hex.optional(),
});
export type Palette = z.infer<typeof palette>;
type PaletteKey = keyof Palette;

/** Every foreground/background pair the components render as text (WCAG AA, 4.5:1). */
export const themeTextPairs: ReadonlyArray<{ fg: PaletteKey; bg: PaletteKey; use: string }> = [
  { fg: 'ink', bg: 'background', use: 'body text and headlines' },
  { fg: 'ink', bg: 'surface', use: 'text in cards, rails and bands' },
  { fg: 'ink', bg: 'tint', use: 'text on tinted highlights' },
  { fg: 'accentText', bg: 'accent', use: 'buttons and active tabs' },
  { fg: 'accent', bg: 'background', use: 'links' },
  { fg: 'accent', bg: 'surface', use: 'links in cards and rails' },
];

export const AA_TEXT = 4.5;

export type ContrastFailure = { fg: PaletteKey; bg: PaletteKey; use: string; ratio: number };

export function checkThemeContrast(p: Palette): ContrastFailure[] {
  const failures = themeTextPairs
    .map((pair) => ({
      ...pair,
      ratio: Math.round(contrastRatio(p[pair.fg]!, p[pair.bg]!) * 100) / 100,
    }))
    .filter((pair) => pair.ratio < AA_TEXT);
  if (p.secondary) {
    const fg = p.secondaryText ?? p.accentText;
    const ratio = Math.round(contrastRatio(fg, p.secondary) * 100) / 100;
    if (ratio < AA_TEXT) {
      failures.push({ fg: 'secondaryText', bg: 'secondary', use: 'secondary buttons', ratio });
    }
  }
  // Sponsored units sit on the network's sand tile in every town; their text is the town's ink.
  const sand = Math.round(contrastRatio(p.ink, systemColors.sand) * 100) / 100;
  if (sand < AA_TEXT) {
    failures.push({ fg: 'ink', bg: 'background', use: 'text on the sponsored tile', ratio: sand });
  }
  return failures;
}

/**
 * Type sets (§11a "type, by role"): display (wordmark and headlines), text/UI, and a metadata face
 * for timestamps, datelines, counts and labels. Add sets only by human decision.
 * - headlineWeight: the weight headlines and the wordmark use (single-weight display faces are 400;
 *   never let the browser fake a bold).
 * - headlineAdvanceEm: mean glyph advance at that weight, in em, measured in Chromium over sample
 *   site names. The SVG masthead sizes the wordmark with it.
 * - legacy: the six M1 pairings. They stay valid in any family until heritage and community ship.
 */
type TypeSet = {
  headline: string;
  body: string;
  meta: string;
  metaStyle: 'mono' | 'italic' | 'sans';
  headlineWeight: 400 | 700 | 800;
  headlineAdvanceEm: number;
  legacy?: true;
};
const legacyPair = (headline: string, body: string, headlineAdvanceEm: number): TypeSet => ({
  headline,
  body,
  meta: body,
  metaStyle: 'sans',
  headlineWeight: 700,
  headlineAdvanceEm,
  legacy: true,
});

export const typePairings = {
  'instrumentserif-geist': {
    headline: 'Instrument Serif',
    body: 'Geist Variable',
    meta: 'Geist Mono Variable',
    metaStyle: 'mono',
    headlineWeight: 400,
    headlineAdvanceEm: 0.358,
  },
  'librecaslondisplay-publicsans': {
    headline: 'Libre Caslon Display',
    body: 'Public Sans Variable',
    meta: 'Libre Caslon Text',
    metaStyle: 'italic',
    headlineWeight: 400,
    headlineAdvanceEm: 0.407,
  },
  'bricolage-figtree': {
    headline: 'Bricolage Grotesque Variable',
    body: 'Figtree Variable',
    meta: 'Figtree Variable',
    metaStyle: 'sans',
    headlineWeight: 800,
    headlineAdvanceEm: 0.518,
  },
  'newsreader-publicsans': legacyPair('Newsreader Variable', 'Public Sans Variable', 0.496),
  'fraunces-worksans': legacyPair('Fraunces Variable', 'Work Sans Variable', 0.537),
  'librecaslon-sourcesans3': legacyPair('Libre Caslon Text', 'Source Sans 3 Variable', 0.565),
  'literata-ibmplexsans': legacyPair('Literata Variable', 'IBM Plex Sans Variable', 0.54),
  'bitter-hankengrotesk': legacyPair('Bitter Variable', 'Hanken Grotesk Variable', 0.501),
  'spectral-karla': legacyPair('Spectral', 'Karla Variable', 0.501),
} as const satisfies Record<string, TypeSet>;
export type TypePairing = keyof typeof typePairings;

export const cornerRadii = { square: '0', soft: '6px', round: '14px' } as const;

/**
 * Style families (docs/plans/M4b.md, revision 6): structural and stylistic defaults a town fills
 * in with its own palette, wordmark and motif. Each lists the type sets it may use (legacy M1
 * pairings are allowed anywhere until they retire).
 */
export const styleFamilies = {
  'coastal-modern': { types: ['instrumentserif-geist'] },
  heritage: { types: ['librecaslondisplay-publicsans'] },
  community: { types: ['bricolage-figtree'] },
} as const satisfies Record<string, { types: readonly string[] }>;
export type StyleFamily = keyof typeof styleFamilies;

/** Layout options per part that the web app implements (§11a-2). Add as they're built. */
export const layoutOptions = {
  header: [
    'centered-masthead',
    'left-logo-inline-nav',
    'stacked-dateline',
    'slim-left',
    'nameplate-double-rule',
    'tinted-bar',
  ],
  nav: ['beat-tabs', 'hamburger-only', 'text-nav'],
  grid: ['single-column', 'main-right-rail'],
  article: ['classic-rail', 'wide-reading'],
  // Directory templates are built in M6 with real data (decision D-M1-2).
  directory: ['list-map', 'category-grid', 'search-first'],
  footer: ['three-column', 'minimal', 'community'],
} as const;

export const homeModules = [
  'good-morning',
  'today-bento',
  'category-buttons',
  'coming-up',
  'documents-posted',
  'lead-story',
  'latest-list',
  'briefs',
  'beat-sections',
  'briefing-column',
  'meetings-this-week',
  'new-businesses',
  'real-estate',
  'events',
  'schools-sports',
  'weather-strip',
  'photo-of-the-day',
  'directory-featured',
  'directory-categories',
  'jobs-classifieds',
  'newsletter-cta',
] as const;
export type HomeModule = (typeof homeModules)[number];

export const mastheadStyles = ['centered-serif', 'left-motif'] as const;
// Must match the motif library in @towncore/brand (checked by a test); added by human review.
export const motifs = [
  'palm-frond',
  'lighthouse',
  'pine',
  'mountain-ridge',
  'river',
  'bridge',
  'clock-tower',
  'water-tower',
  'citrus',
  'sailboat',
  'oak',
  'grain-elevator',
] as const;

export const themeSchema = z
  .strictObject({
    palette,
    family: z.enum(Object.keys(styleFamilies) as [StyleFamily, ...StyleFamily[]]),
    type: z.enum(Object.keys(typePairings) as [TypePairing, ...TypePairing[]]),
    masthead: z.enum(mastheadStyles),
    layout: z.strictObject({
      header: z.enum(layoutOptions.header),
      nav: z.enum(layoutOptions.nav),
      grid: z.enum(layoutOptions.grid),
      home: z
        .array(z.enum(homeModules))
        .min(1)
        .refine((list) => new Set(list).size === list.length, 'home modules must be unique'),
      // A full-width band above the grid. `good-morning` and `category-buttons` at its start span
      // it. Then, by family:
      // coastal-modern and community put the first module in the wide column and the rest beside
      // it; heritage puts `lead-story` in the center, the modules before it on the left and the
      // ones after it on the right. Stacks on phones in list order.
      homeTop: z.array(z.enum(homeModules)).max(6).optional(),
      // Modules in the desktop rail, above rail.box; they follow the main column on phones.
      homeRail: z.array(z.enum(homeModules)).optional(),
      article: z.enum(layoutOptions.article),
      directory: z.enum(layoutOptions.directory),
      footer: z.enum(layoutOptions.footer),
    }),
    corners: z.enum(Object.keys(cornerRadii) as [keyof typeof cornerRadii]),
    motif: z.enum(motifs),
    // One line under the nameplate (heritage), in the paper's own voice.
    tagline: z.string().min(1).max(80).optional(),
    identityNotes: z.string().min(1),
  })
  .superRefine((theme, ctx) => {
    const { home, homeTop = [], homeRail = [] } = theme.layout;
    const all = [...homeTop, ...home, ...homeRail];
    if (new Set(all).size !== all.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'home'],
        message: 'a module may appear only once across homeTop, home and homeRail',
      });
    }
    if (homeRail.length > 0 && theme.layout.grid !== 'main-right-rail') {
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'homeRail'],
        message: 'homeRail needs the main-right-rail grid',
      });
    }
    const set = typePairings[theme.type] as TypeSet;
    const allowed: readonly string[] = styleFamilies[theme.family].types;
    if (!set.legacy && !allowed.includes(theme.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: `${theme.type} isn't on the ${theme.family} family's type list (${allowed.join(', ')})`,
      });
    }
    for (const failure of checkThemeContrast(theme.palette)) {
      ctx.addIssue({
        code: 'custom',
        path: ['palette', failure.fg],
        message: `${failure.fg} on ${failure.bg} (${failure.use}) is ${failure.ratio}:1, needs ${AA_TEXT}:1`,
      });
    }
  });

export type Theme = z.infer<typeof themeSchema>;

/**
 * Rules that depend on the town, not just the theme (§11a-2). Until readiness scores exist,
 * tier "small" stands in for "fewer than 5 items a day".
 */
export function checkThemeForTown(
  theme: Theme,
  town: { tier: 'small' | 'mid' | 'large' },
): string[] {
  const problems: string[] = [];
  if (town.tier === 'small') {
    // The greeting is a line of text, not a lead; the first real module decides.
    const first = [...(theme.layout.homeTop ?? []), ...theme.layout.home].find(
      (m) => m !== 'good-morning',
    );
    if (first === 'lead-story') {
      problems.push('small towns cannot lead the homepage with lead-story');
    }
  }
  return problems;
}

/**
 * Fallback for towns without a theme file. Deliberately not the generic cream + serif +
 * terracotta look §11a warns against: cool grey-blue, square corners, single column.
 */
export const defaultTheme: Theme = {
  palette: {
    ink: '#1D2B36',
    accent: '#2D5F8A',
    accentText: '#FFFFFF',
    tint: '#DCE7EF',
    surface: '#EEF2F5',
    background: '#FFFFFF',
  },
  family: 'community',
  type: 'literata-ibmplexsans',
  masthead: 'left-motif',
  layout: {
    header: 'left-logo-inline-nav',
    nav: 'hamburger-only',
    grid: 'single-column',
    home: ['briefing-column', 'newsletter-cta', 'events', 'directory-featured', 'latest-list'],
    article: 'wide-reading',
    directory: 'category-grid',
    footer: 'minimal',
  },
  corners: 'square',
  motif: 'lighthouse',
  identityNotes: 'Network default theme for towns without their own theme yet.',
};

export function parseTheme(json: string, label = 'theme'): Theme {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid ${label}: not valid JSON (${(error as Error).message})`, {
      cause: error,
    });
  }
  const result = themeSchema.safeParse(data);
  if (!result.success) throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** Beats used for navigation and beat pages. Article `beat` values use these slugs. */
export const beats = [
  { slug: 'government', label: 'Government' },
  { slug: 'development', label: 'Development' },
  { slug: 'business', label: 'Business' },
  { slug: 'schools', label: 'Schools' },
  { slug: 'public-safety', label: 'Public safety' },
  { slug: 'community', label: 'Community' },
] as const;
export type BeatSlug = (typeof beats)[number]['slug'];
