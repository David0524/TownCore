import { describe, expect, it } from 'vitest';
import { allowedColorPairs, brandColors, contrastRatio, forbiddenColorPairs } from '../src/brand';

const minimum = { text: 4.5, large: 3, decoration: 3 } as const;

describe('brand color pairs', () => {
  it.each(allowedColorPairs)('$fg on $bg meets the minimum for $use', ({ fg, bg, use }) => {
    expect(contrastRatio(brandColors[fg], brandColors[bg])).toBeGreaterThanOrEqual(minimum[use]);
  });

  it('never allows a forbidden pair', () => {
    for (const forbidden of forbiddenColorPairs) {
      expect(allowedColorPairs).not.toContainEqual(expect.objectContaining(forbidden));
    }
  });

  it('keeps brick and teal out of body text', () => {
    const textFgs = allowedColorPairs
      .filter((p) => p.use === 'text' && p.bg === 'paper')
      .map((p) => p.fg);
    expect(textFgs).not.toContain('brick');
    expect(textFgs).not.toContain('teal');
  });

  it('matches known contrast values', () => {
    expect(contrastRatio(brandColors.slate, brandColors.paper)).toBeCloseTo(5.29, 2);
    expect(contrastRatio(brandColors.brick, brandColors.paper)).toBeCloseTo(4.45, 2);
  });
});
