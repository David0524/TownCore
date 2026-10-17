import { describe, expect, it } from 'vitest';
import { bandNeedsCta, homeOrder } from '../src/modules/order';

// The homepage order (§11a-2): newsletter-cta among the first two modules on phones, and the
// `module-order` experiment (owner, 2026-10-17), which puts it first on phones only.

const names = (order: ReturnType<typeof homeOrder>) =>
  order.map((o) => `${o.module}${o.mobileOnly ? ':phone' : ''}${o.desktopOnly ? ':desktop' : ''}`);

describe('homeOrder', () => {
  it('adds a phone-only sign-up box second when the theme has none near the top', () => {
    expect(names(homeOrder(['lead-story', 'latest-list', 'events']))).toEqual([
      'lead-story',
      'newsletter-cta:phone',
      'latest-list',
      'events',
    ]);
  });

  it('puts it first on phones under signup-first, and leaves desktop alone', () => {
    const order = homeOrder(['lead-story', 'latest-list', 'events'], [], true);
    expect(names(order)).toEqual(['newsletter-cta:phone', 'lead-story', 'latest-list', 'events']);
    // Desktop (everything not phone-only) keeps the theme's order.
    expect(order.filter((o) => !o.mobileOnly).map((o) => o.module)).toEqual([
      'lead-story',
      'latest-list',
      'events',
    ]);
  });

  it('moves a theme’s second-place box to first on phones only', () => {
    expect(names(homeOrder(['lead-story', 'newsletter-cta', 'events'], [], true))).toEqual([
      'newsletter-cta:phone',
      'lead-story',
      'newsletter-cta:desktop',
      'events',
    ]);
    expect(names(homeOrder(['lead-story', 'newsletter-cta', 'events']))).toEqual([
      'lead-story',
      'newsletter-cta',
      'events',
    ]);
    expect(names(homeOrder(['newsletter-cta', 'lead-story'], [], true))).toEqual([
      'newsletter-cta',
      'lead-story',
    ]);
  });

  it('leaves a top band to the page', () => {
    expect(names(homeOrder(['latest-list'], ['good-morning', 'lead-story'], true))).toEqual([
      'latest-list',
    ]);
    expect(bandNeedsCta(['latest-list'], ['good-morning', 'lead-story'])).toBe(true);
  });
});
