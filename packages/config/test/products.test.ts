import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  directoryProducts,
  productEnabled,
  productPrice,
  resetEnvCache,
  TIER_PRICES,
} from '../src';

// What the directory sells (owner, 2026-10-17: "a full build out of the advertise page… working
// in full"): newsletter weeks and category months are on for every town; the spotlight is built
// but off, and DIRECTORY_PRODUCTS_PREVIEW still previews it in development and tests.

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('directory products', () => {
  it('sells featured spots, Enhanced, newsletter weeks and category months', () => {
    vi.stubEnv('DIRECTORY_PRODUCTS_PREVIEW', '');
    resetEnvCache();
    for (const product of ['enhanced', 'sponsored_slot', 'newsletter', 'exclusive'] as const)
      expect(productEnabled(product), product).toBe(true);
    expect(productEnabled('spotlight')).toBe(false);
    expect(directoryProducts.newsletter.period).toBe('week');
    expect(directoryProducts.exclusive.period).toBe('month');
  });

  it('prices the dated bookings from the tier lists', () => {
    const large = TIER_PRICES.large as unknown as Record<string, unknown>;
    expect(productPrice(large, 'newsletter')).toBe(TIER_PRICES.large.newsletter_week_usd);
    expect(productPrice(large, 'exclusive')).toBe(TIER_PRICES.large.category_month_usd);
  });

  it('previews a product that is still off', () => {
    vi.stubEnv('DIRECTORY_PRODUCTS_PREVIEW', 'spotlight');
    resetEnvCache();
    expect(productEnabled('spotlight')).toBe(true);
  });
});
