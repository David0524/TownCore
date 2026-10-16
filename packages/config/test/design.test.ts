import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/brand';
import {
  categoryColors,
  darkColors,
  deriveDeep,
  deriveMuted,
  iosColors,
  phoneSecondaryLabel,
  systemColors,
} from '../src/design';
import { checkThemeContrast, defaultTheme, typePairings } from '../src/theme';

// Network-wide design tokens (docs/plans/M4b.md): every pair that renders text passes WCAG AA;
// category dots and other graphics pass 3:1 (WCAG non-text contrast).

describe('network design tokens', () => {
  it('category dots stand out on white (3:1) and carry white text where used (4.5:1)', () => {
    for (const [name, color] of Object.entries(categoryColors)) {
      expect(contrastRatio(color, '#FFFFFF'), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('alert amber always carries dark text', () => {
    expect(contrastRatio(systemColors.alertText, systemColors.alert)).toBeGreaterThanOrEqual(4.5);
  });

  it('the canvas grey stays as is where it already passes (Boca)', () => {
    const boca = { ink: '#111418', background: '#FFFFFF', surface: '#F3F5F7', tint: '#EAF3FA' };
    expect(deriveMuted(boca)).toBe(systemColors.muted);
  });

  it('secondary text darkens until it passes on every light surface', () => {
    // Harbor Point's tint fails with the canvas grey (4.01:1).
    const harbor = { ink: '#1B2A41', background: '#FFFFFF', surface: '#EEF3F6', tint: '#CCD6DD' };
    const muted = deriveMuted(harbor);
    expect(muted).not.toBe(systemColors.muted);
    for (const bg of [harbor.background, harbor.surface, harbor.tint, systemColors.sand]) {
      expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('promotions sit on a deep brand shade that keeps the brand text readable', () => {
    const boca = {
      ink: '#111418',
      background: '#FFFFFF',
      accent: '#0E6FA8',
      accentText: '#FFFFFF',
    };
    const deep = deriveDeep(boca);
    expect(contrastRatio(boca.accentText, deep)).toBeGreaterThan(
      contrastRatio(boca.accentText, boca.accent),
    );
    const light = { ...boca, accent: '#F2C14E', accentText: '#111418' };
    expect(contrastRatio(light.accentText, deriveDeep(light))).toBeGreaterThanOrEqual(4.5);
  });

  it('dark-mode text passes on the dark page and tiles', () => {
    for (const fg of [darkColors.ink, darkColors.muted]) {
      for (const bg of [darkColors.background, darkColors.surface, darkColors.sand]) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('a theme whose ink fails on the sponsored sand tile is rejected', () => {
    const failures = checkThemeContrast({ ...defaultTheme.palette, ink: '#B0B0B0' });
    expect(failures.some((f) => f.use === 'text on the sponsored tile')).toBe(true);
  });

  it('single-weight display faces never ask for a faked bold', () => {
    expect(typePairings['instrumentserif-geist'].headlineWeight).toBe(400);
    expect(typePairings['librecaslondisplay-publicsans'].headlineWeight).toBe(400);
  });

  it('phone secondary labels pass AA on every phone surface, darkening only when needed', () => {
    expect(phoneSecondaryLabel({ background: '#FFFFFF', tint: '#EAF3FA' })).toBe(
      iosColors.secondaryLabel,
    );
    const harbor = { background: '#FFFFFF', tint: '#CCD6DD' };
    const label = phoneSecondaryLabel(harbor);
    for (const bg of [harbor.background, harbor.tint, iosColors.grouped, systemColors.sand]) {
      expect(contrastRatio(label, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
