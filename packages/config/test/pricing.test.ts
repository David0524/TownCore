import { describe, expect, it } from 'vitest';
import {
  decidePrice,
  listPriceCents,
  PRICING_RULES,
  scarcityLine,
  TIER_PRICES,
  townPricing,
  type PricingSignals,
} from '../src';

// Directory prices (owner, 2026-10-17): tier price lists, the town's own overrides, and the
// monthly formula's guardrails.

const signals = (s: Partial<PricingSignals> = {}): PricingSignals => ({
  fillRate: 0,
  waitlist: 0,
  valuePerSpotMonth: 5,
  checkoutStarts: 0,
  claims: 0,
  exposure: 0,
  ...s,
});

describe('townPricing', () => {
  it('starts every town from its tier price list', () => {
    expect(townPricing({ tier: 'small', config: {} })).toEqual({
      featured_usd: [9, 6, 4],
      enhanced_usd: 19,
      category_month_usd: 25,
      newsletter_week_usd: 15,
      free_trial_days: 30,
    });
    expect(townPricing({ tier: 'mid', config: { pricing: {} } }).featured_usd).toEqual([14, 9, 5]);
    expect(TIER_PRICES.large).toEqual({
      featured_usd: [19, 12, 7],
      enhanced_usd: 39,
      category_month_usd: 75,
      newsletter_week_usd: 45,
    });
  });

  it('lets a town override any field and keeps older full configs as they were', () => {
    const boca = townPricing({
      tier: 'large',
      config: { pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39 } },
    });
    expect(boca).toMatchObject({ featured_usd: [19, 12, 7], enhanced_usd: 39 });
    const small = townPricing({
      tier: 'small',
      config: { pricing: { enhanced_usd: 15, free_trial_days: 0 } },
    });
    expect(small).toMatchObject({ featured_usd: [9, 6, 4], enhanced_usd: 15, free_trial_days: 0 });
    expect(listPriceCents(small, 'sponsored_slot', 2)).toBe(600);
    expect(listPriceCents(small, 'exclusive')).toBe(2500);
    expect(listPriceCents(small, 'sponsored_slot')).toBeNull();
  });
});

describe('decidePrice', () => {
  it('raises a sold-out category by 10% when its spots delivered value', () => {
    const d = decidePrice({
      currentCents: 1900,
      listCents: 1900,
      signals: signals({ fillRate: 0.95 }),
    });
    expect(d).toMatchObject({ status: 'applied', newCents: 2100 });
  });

  it('holds an increase when the spots delivered nothing', () => {
    expect(
      decidePrice({
        currentCents: 1900,
        listCents: 1900,
        signals: signals({ fillRate: 1, valuePerSpotMonth: 0 }),
      }),
    ).toMatchObject({ status: 'unchanged' });
  });

  it('caps a month at ±20% and sends increases over 10% to an admin', () => {
    const d = decidePrice({
      currentCents: 1000,
      listCents: 1000,
      signals: signals({ fillRate: 1, waitlist: 25 }),
    });
    expect(d).toMatchObject({ status: 'proposed', newCents: 1200 });
    expect(PRICING_RULES.maxStep).toBe(0.2);
  });

  it('sends a price above twice the list price to an admin, even a small step', () => {
    const d = decidePrice({
      currentCents: 3800,
      listCents: 1900,
      signals: signals({ fillRate: 0.7 }),
    });
    expect(d).toMatchObject({ status: 'proposed', newCents: 4000 });
    expect(d.status !== 'unchanged' && d.reason).toContain('ceiling');
  });

  it('lowers an unsold category only when readers saw it, and never below the floor', () => {
    expect(
      decidePrice({ currentCents: 1900, listCents: 1900, signals: signals({ exposure: 10 }) }),
    ).toMatchObject({ status: 'unchanged' });
    expect(
      decidePrice({ currentCents: 1900, listCents: 1900, signals: signals({ exposure: 300 }) }),
    ).toMatchObject({ status: 'applied', newCents: 1700 });
    expect(
      decidePrice({ currentCents: 1900, listCents: 1900, signals: signals({ exposure: 5000 }) }),
    ).toMatchObject({ status: 'applied', newCents: 1500 });
    // Floor: the list price less 40%, $11.40 → $11.
    expect(
      decidePrice({ currentCents: 1200, listCents: 1900, signals: signals({ exposure: 5000 }) }),
    ).toMatchObject({ status: 'applied', newCents: 1100 });
    expect(
      decidePrice({ currentCents: 1100, listCents: 1900, signals: signals({ exposure: 5000 }) }),
    ).toMatchObject({ status: 'unchanged' });
  });

  it('does not lower a price while anyone waits or a checkout started', () => {
    expect(
      decidePrice({
        currentCents: 1900,
        listCents: 1900,
        signals: signals({ exposure: 5000, checkoutStarts: 1 }),
      }),
    ).toMatchObject({ status: 'unchanged' });
  });

  it('never takes a business as an input: the same signals give the same price', () => {
    const a = decidePrice({ currentCents: 900, listCents: 900, signals: signals({ fillRate: 1 }) });
    const b = decidePrice({ currentCents: 900, listCents: 900, signals: signals({ fillRate: 1 }) });
    expect(a).toEqual(b);
  });
});

describe('scarcityLine', () => {
  it('states the real count', () => {
    expect(scarcityLine(2, 3, 'Plumbers')).toBe('2 of 3 featured spots open in Plumbers.');
    expect(scarcityLine(0, 3, 'Plumbers')).toBe('All 3 featured spots in Plumbers are taken.');
  });
});
