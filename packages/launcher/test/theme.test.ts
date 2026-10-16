import { readFileSync } from 'node:fs';
import { siteAssets, siteAssetSvg, mastheadSvg, mastheadStyleNames } from '@towncore/brand';
import { checkThemeContrast, contrastRatio, parseTheme, themeSchema } from '@towncore/config';
import type { ThemeChoice, ThemeReview } from '@towncore/prompts';
import { describe, expect, it } from 'vitest';
import {
  adjustContrast,
  applyReview,
  buildTheme,
  colorDistance,
  fallbackChoice,
  familyPresets,
  hexToOklch,
  neighborProblems,
  oklchToHex,
  paletteFromAccent,
  satisfyNeighbors,
  slotProblems,
  type Neighbor,
} from '../src';

// Launch step 6b (M7 PR E): the theme generator's code rules. Boca's real theme is the neighbor.

const boca = parseTheme(
  readFileSync(new URL('../../../towns/fl/boca-raton.theme.json', import.meta.url), 'utf8'),
);
const BOCA: Neighbor = { name: 'Boca Raton', siteName: 'Boca Town Square', miles: 6, theme: boca };

const choice = (over: Partial<ThemeChoice> = {}): ThemeChoice => ({
  identityNotes: 'A beach town with a historic downtown along Atlantic Avenue.',
  family: 'heritage',
  accent: '#7A3E9D',
  secondary: null,
  motif: 'sailboat',
  masthead: 'ruled-nameplate',
  tagline: 'Village by the Sea',
  header: 'nameplate-double-rule',
  grid: 'single-column',
  article: 'wide-reading',
  directory: 'category-grid',
  footer: 'minimal',
  corners: 'square',
  ...over,
});

describe('color', () => {
  it('round-trips OKLCH and keeps hue while fixing contrast', () => {
    for (const hex of ['#0E6FA8', '#B3261E', '#234B35', '#FFFFFF', '#111418'])
      expect(colorDistance(oklchToHex(hexToOklch(hex)), hex)).toBeLessThan(0.01);
    // A light yellow accent fails white text; it's darkened in lightness only.
    const { palette, changed } = adjustContrast(paletteFromAccent('#F2C94C'));
    expect(changed).toContain('accent');
    expect(checkThemeContrast(palette)).toEqual([]);
    expect(contrastRatio('#FFFFFF', palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hexToOklch(palette.accent).h - hexToOklch('#F2C94C').h)).toBeLessThan(6);
  });
});

describe('building a theme', () => {
  it('fills the family preset with the choice and passes the schema', () => {
    const { theme, notes } = buildTheme(choice(), { itemsPerDay: 8 });
    expect(theme).toMatchObject({
      family: 'heritage',
      type: 'librecaslondisplay-publicsans',
      masthead: 'ruled-nameplate',
      motif: 'sailboat',
      tagline: 'Village by the Sea',
      layout: { header: 'nameplate-double-rule', grid: 'single-column', article: 'wide-reading' },
    });
    expect(themeSchema.safeParse(theme).success).toBe(true);
    expect(slotProblems(theme)).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('uses the briefing-led community family under 5 items a day', () => {
    const { theme, notes } = buildTheme(choice(), { itemsPerDay: 2.4 });
    expect(theme.family).toBe('community');
    expect(theme.type).toBe('bricolage-figtree');
    expect(theme.layout.homeTop![1]).toBe('briefing-column');
    expect(notes[0]).toMatch(/under 5: the briefing-led community family/);
  });

  it('moves a rail into the main column for a single-column grid', () => {
    const { theme } = buildTheme(choice({ family: 'coastal-modern', grid: 'single-column' }), {
      itemsPerDay: 12,
    });
    expect(theme.layout.homeRail).toBeUndefined();
    expect(theme.layout.home).toContain('coming-up');
  });

  it('the sign-up is among the first two modules on phones', () => {
    const t = buildTheme(choice(), { itemsPerDay: 8 }).theme;
    const noBand = {
      ...t,
      layout: {
        ...t.layout,
        homeTop: undefined,
        home: ['lead-story', 'latest-list', 'newsletter-cta'],
      },
    } as typeof t;
    expect(slotProblems(noBand)).toEqual([
      'the newsletter sign-up must be among the first two modules on phones',
    ]);
    for (const preset of Object.values(familyPresets))
      expect(
        slotProblems({ ...preset, palette: boca.palette, motif: 'pine', identityNotes: 'x' }),
      ).toEqual([]);
  });
});

describe('the neighbor rule', () => {
  it('flags a shared family and palette, and more than two shared parts', () => {
    const copy = { ...boca, palette: { ...boca.palette, accent: '#106EA6' } };
    expect(neighborProblems(copy, [BOCA])).toEqual([
      'shares family and palette with Boca Town Square (6 miles)',
      'shares header, grid, article template, first three modules with Boca Town Square (6 miles)',
    ]);
  });

  it('repairs in code: a new hue, then different parts', () => {
    const { theme } = buildTheme(
      choice({
        family: 'coastal-modern',
        accent: '#0E70A9',
        header: 'slim-left',
        grid: 'main-right-rail',
        article: 'classic-rail',
        masthead: 'centered-serif',
      }),
      { itemsPerDay: 12 },
    );
    expect(neighborProblems(theme, [BOCA]).length).toBeGreaterThan(0);
    const { theme: fixed, notes } = satisfyNeighbors(theme, [BOCA]);
    expect(neighborProblems(fixed, [BOCA])).toEqual([]);
    expect(colorDistance(fixed.palette.accent, boca.palette.accent)).toBeGreaterThanOrEqual(0.1);
    expect(notes[0]).toMatch(/Brand color moved/);
    expect(checkThemeContrast(fixed.palette)).toEqual([]);
  });

  it('without a model, picks a family and hue away from the neighbors, the same every time', () => {
    const a = fallbackChoice({ name: 'Delray Beach', state: 'FL' }, [BOCA], 8);
    expect(a).toEqual(fallbackChoice({ name: 'Delray Beach', state: 'FL' }, [BOCA], 8));
    expect(a.family).not.toBe('coastal-modern');
    expect(a.motif).not.toBe('palm-frond');
    const h = hexToOklch(a.accent).h;
    const bocaH = hexToOklch(boca.palette.accent).h;
    expect(Math.min(Math.abs(h - bocaH), 360 - Math.abs(h - bocaH))).toBeGreaterThan(40);
    const { theme } = buildTheme(a, { itemsPerDay: 8 });
    expect(neighborProblems(theme, [BOCA])).toEqual([]);
  });
});

describe('the screenshot review', () => {
  const none: ThemeReview['changes'] = {
    accent: null,
    masthead: null,
    header: null,
    grid: null,
    article: null,
    footer: null,
    corners: null,
  };
  it('applies allowed changes and refuses ones that break a rule', () => {
    const { theme } = buildTheme(choice(), { itemsPerDay: 8 });
    const ok = applyReview(
      theme,
      {
        verdict: 'fix',
        problems: ['wordmark too small'],
        changes: { ...none, masthead: 'centered-serif', corners: 'soft' },
      },
      [BOCA],
    );
    expect(ok.applied).toEqual(['masthead centered-serif', 'corners soft']);
    expect(ok.theme.masthead).toBe('centered-serif');
    // Turning it into Boca's colors and parts would break the neighbor rule: nothing applied.
    const bad = applyReview(
      { ...theme, family: 'coastal-modern', type: 'outfit-geist' },
      {
        verdict: 'fix',
        problems: [],
        changes: {
          ...none,
          accent: '#0E6FA8',
          header: 'slim-left',
          grid: 'main-right-rail',
          article: 'classic-rail',
        },
      },
      [
        {
          ...BOCA,
          theme: {
            ...boca,
            layout: { ...boca.layout, homeTop: ['today-bento', 'newsletter-cta', 'coming-up'] },
          },
        },
      ],
    );
    expect(bad.applied).toEqual([]);
  });
});

describe('identity assets', () => {
  const input = {
    siteName: 'The Delray Ledger',
    place: 'Delray Beach, Florida',
    masthead: 'ruled-nameplate' as const,
    motif: 'sailboat' as const,
    palette: paletteFromAccent('#7A3E9D'),
    fontFamily: 'var(--font-headline)',
    fontWeight: 400,
    advanceEm: 0.407,
  };
  it.each(Object.keys(siteAssets) as Array<keyof typeof siteAssets>)(
    '%s is drawn at its exact size',
    (kind) => {
      const svg = siteAssetSvg(kind, input);
      const { width, height } = siteAssets[kind];
      expect(svg).toContain(`width="${width}" height="${height}"`);
      expect(svg).toContain('aria-label="The Delray Ledger"');
      if (kind !== 'social-avatar') expect(svg).toContain('The Delray Ledger</text>');
    },
  );
  it('has three masthead styles', () => {
    expect(mastheadStyleNames).toHaveLength(3);
    expect(
      mastheadSvg({ siteName: 'The Delray Ledger', style: 'ruled-nameplate', motif: 'sailboat' }),
    ).toMatch(/stroke-width="3".*The Delray Ledger<\/text>.*stroke-width="1"/);
  });
});
