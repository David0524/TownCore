import { defaultTheme, typePairings } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { themeCssVariables, themeFor } from '../src/lib/theme';

describe('themeCssVariables', () => {
  it('maps palette, fonts and corners to custom properties', () => {
    const css = themeCssVariables(defaultTheme);
    expect(css).toContain(`--ink:${defaultTheme.palette.ink};`);
    expect(css).toContain(`--accent-text:${defaultTheme.palette.accentText};`);
    expect(css).toContain(`'${typePairings[defaultTheme.type].headline}'`);
    expect(css).toContain('--radius:0;');
  });
});

describe('themeFor', () => {
  it('falls back to the default theme when a town has none or an invalid one', () => {
    expect(themeFor({ slug: 'x', theme: null })).toBe(defaultTheme);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(themeFor({ slug: 'x', theme: { palette: 'nope' } })).toBe(defaultTheme);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});
