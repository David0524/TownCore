import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkThemeContrast,
  checkThemeForTown,
  defaultTheme,
  parseTheme,
  themeSchema,
  type Theme,
} from '../src/theme';
import { loadTowns } from '../src/town';

const townsDir = fileURLToPath(new URL('../../../towns', import.meta.url));
const bocaThemeJson = readFileSync(`${townsDir}/fl/boca-raton.theme.json`, 'utf8');
const withPalette = (palette: Partial<Theme['palette']>) =>
  JSON.stringify({ ...defaultTheme, palette: { ...defaultTheme.palette, ...palette } });

describe('theme schema', () => {
  it('accepts the Boca theme as specified in CLAUDE.md §11a (coastal-modern, M4b canvas)', () => {
    const theme = parseTheme(bocaThemeJson);
    expect(theme.family).toBe('coastal-modern');
    expect(theme.type).toBe('instrumentserif-geist');
    expect(theme.palette.ink).toBe('#111418');
    expect(theme.palette.accent).toBe('#0E6FA8');
    expect(theme.layout.home[0]).toBe('lead-story');
  });

  it("rejects a type set outside the family's list, but allows legacy M1 pairings", () => {
    expect(() =>
      parseTheme(
        JSON.stringify({ ...defaultTheme, family: 'heritage', type: 'bricolage-figtree' }),
      ),
    ).toThrow(/heritage family's type list/);
    expect(
      themeSchema.safeParse({ ...defaultTheme, family: 'heritage', type: 'bitter-hankengrotesk' })
        .success,
    ).toBe(true);
  });

  it('requires a family', () => {
    const { family: _family, ...rest } = defaultTheme;
    expect(themeSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts the default fallback theme', () => {
    expect(themeSchema.safeParse(defaultTheme).success).toBe(true);
  });

  it('rejects unknown keys (no sneaking in extra overrides)', () => {
    expect(() =>
      parseTheme(JSON.stringify({ ...defaultTheme, sponsoredLabelColor: '#FF0000' })),
    ).toThrow(/sponsoredLabelColor/);
  });

  it('rejects layout options that are not built', () => {
    const theme = { ...defaultTheme, layout: { ...defaultTheme.layout, grid: 'split-two-column' } };
    expect(() => parseTheme(JSON.stringify(theme))).toThrow(/grid/);
  });

  it('rejects type pairings outside the curated list', () => {
    expect(() =>
      parseTheme(JSON.stringify({ ...defaultTheme, type: 'comic-sans-papyrus' })),
    ).toThrow();
  });

  it('rejects duplicate homepage modules', () => {
    const theme = {
      ...defaultTheme,
      layout: { ...defaultTheme.layout, home: ['events', 'events'] },
    };
    expect(() => parseTheme(JSON.stringify(theme))).toThrow(/unique/);
  });
});

describe('contrast checker', () => {
  it('passes the Boca and default palettes', () => {
    expect(checkThemeContrast(parseTheme(bocaThemeJson).palette)).toEqual([]);
    expect(checkThemeContrast(defaultTheme.palette)).toEqual([]);
  });

  it('a theme that fails contrast cannot be saved', () => {
    expect(() => parseTheme(withPalette({ ink: '#AAAAAA' }))).toThrow(
      /ink on background .* needs 4.5:1/,
    );
  });

  it('checks every text pair, e.g. white text on a light accent', () => {
    const failures = checkThemeContrast({ ...defaultTheme.palette, accent: '#7FB3D5' });
    expect(failures.map((f) => `${f.fg}/${f.bg}`)).toEqual([
      'accentText/accent',
      'accent/background',
      'accent/surface',
    ]);
  });

  it('never checks tint as a text color (fill only)', () => {
    expect(checkThemeContrast({ ...defaultTheme.palette, tint: '#FFFFFE' })).toEqual([]);
  });
});

describe('town-dependent theme rules', () => {
  it('small towns cannot lead with lead-story', () => {
    const theme = parseTheme(bocaThemeJson);
    expect(checkThemeForTown(theme, { tier: 'small' })).toHaveLength(1);
    expect(checkThemeForTown(theme, { tier: 'large' })).toEqual([]);
  });
});

describe('loadTowns', () => {
  it('loads Boca with its theme file', () => {
    const boca = loadTowns(townsDir).find((t) => t.config.slug === 'boca-raton')!;
    expect(boca.hasThemeFile).toBe(true);
    expect(boca.theme.type).toBe('instrumentserif-geist');
  });
});
