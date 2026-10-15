import { z } from 'zod';
import { contrastRatio } from './brand';

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
  return themeTextPairs
    .map((pair) => ({
      ...pair,
      ratio: Math.round(contrastRatio(p[pair.fg], p[pair.bg]) * 100) / 100,
    }))
    .filter((pair) => pair.ratio < AA_TEXT);
}

/** Curated headline/body pairings (§11a). Add pairs only by human decision. */
// headlineAdvanceEm: mean bold (700) glyph advance in em, measured in Chromium over sample site
// names. The SVG masthead uses it to size the wordmark without stretching letter spacing.
export const typePairings = {
  'newsreader-publicsans': {
    headline: 'Newsreader Variable',
    body: 'Public Sans Variable',
    headlineAdvanceEm: 0.496,
  },
  'fraunces-worksans': {
    headline: 'Fraunces Variable',
    body: 'Work Sans Variable',
    headlineAdvanceEm: 0.537,
  },
  'librecaslon-sourcesans3': {
    headline: 'Libre Caslon Text',
    body: 'Source Sans 3 Variable',
    headlineAdvanceEm: 0.565,
  },
  'literata-ibmplexsans': {
    headline: 'Literata Variable',
    body: 'IBM Plex Sans Variable',
    headlineAdvanceEm: 0.54,
  },
  'bitter-hankengrotesk': {
    headline: 'Bitter Variable',
    body: 'Hanken Grotesk Variable',
    headlineAdvanceEm: 0.501,
  },
  'spectral-karla': { headline: 'Spectral', body: 'Karla Variable', headlineAdvanceEm: 0.501 },
} as const;
export type TypePairing = keyof typeof typePairings;

export const cornerRadii = { square: '0', soft: '6px', round: '14px' } as const;

/** Layout options per part that the web app implements (§11a-2). Add as they're built. */
export const layoutOptions = {
  header: ['centered-masthead', 'left-logo-inline-nav', 'stacked-dateline'],
  nav: ['beat-tabs', 'hamburger-only'],
  grid: ['single-column', 'main-right-rail'],
  article: ['classic-rail', 'wide-reading'],
  // Directory templates are built in M6 with real data (decision D-M1-2).
  directory: ['list-map', 'category-grid', 'search-first'],
  footer: ['three-column', 'minimal'],
} as const;

export const homeModules = [
  'lead-story',
  'latest-list',
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
export const motifs = ['palm-frond', 'lighthouse'] as const;

export const themeSchema = z
  .strictObject({
    palette,
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
      article: z.enum(layoutOptions.article),
      directory: z.enum(layoutOptions.directory),
      footer: z.enum(layoutOptions.footer),
    }),
    corners: z.enum(Object.keys(cornerRadii) as [keyof typeof cornerRadii]),
    motif: z.enum(motifs),
    identityNotes: z.string().min(1),
  })
  .superRefine((theme, ctx) => {
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
    if (theme.layout.home[0] === 'lead-story') {
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
