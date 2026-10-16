import { describe, expect, it } from 'vitest';
import { contrastRatio, darkFoodColors, foodColors } from '../src';

// Food tiles carry a drawn icon in the ink on the tint; hold them to text contrast anyway.
describe('food tile colors', () => {
  for (const [name, set] of Object.entries({ light: foodColors, dark: darkFoodColors }))
    it(`${name}: every ink is at least 4.5:1 on its tint`, () => {
      for (const [flavor, { tint, ink }] of Object.entries(set))
        expect(contrastRatio(ink, tint), flavor).toBeGreaterThanOrEqual(4.5);
    });
});
