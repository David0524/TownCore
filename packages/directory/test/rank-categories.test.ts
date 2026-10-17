import { directoryCategory, type DirectoryCategory } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { CATEGORY_DEMAND, dailyHash, demandOf, rankCategories } from '../src';

const row = (slug: string, count: number) => ({
  category: directoryCategory(slug) as DirectoryCategory,
  count,
});
const slugs = (rows: ReadonlyArray<{ category: DirectoryCategory }>) =>
  rows.map((r) => r.category.slug);
const day = '2026-10-17';

// Boca's real listing counts on 2026-10-17, in config order.
const boca = [
  row('general-contractors', 730),
  row('roofers', 85),
  row('electricians', 109),
  row('plumbers', 74),
  row('hvac', 121),
  row('pool-and-spa', 82),
  row('solar', 3),
  row('alarm-systems', 31),
  row('restaurants', 660),
  row('takeout-and-counter', 86),
  row('caterers', 20),
  row('food-trucks', 37),
  row('coffee-and-bakeries', 22),
  row('bars-and-nightlife', 8),
  row('grocery-and-markets', 29),
  row('shopping', 45),
  row('health-and-medical', 36),
  row('beauty-and-wellness', 18),
  row('fitness', 9),
  row('automotive', 11),
  row('banks-and-finance', 47),
  row('real-estate', 3),
  row('professional-services', 13),
  row('personal-services', 4),
  row('pets', 3),
  row('childcare-and-education', 4),
  row('hotels', 29),
  row('entertainment', 15),
];

describe('rankCategories', () => {
  it('leads with what readers look for, not A–Z, config order or the biggest kind', () => {
    const ranked = slugs(rankCategories(boca, { day }));
    expect(ranked.slice(0, 10)).toEqual(TOP_TEN);
    expect(ranked).not.toEqual([...ranked].sort());
    expect(ranked).not.toEqual(slugs(boca));
    // Rare license kinds trail.
    expect(ranked.slice(-4)).toContain('solar');
  });

  it('is deterministic for a day and never depends on input order', () => {
    const a = slugs(rankCategories(boca, { day }));
    expect(slugs(rankCategories([...boca].reverse(), { day }))).toEqual(a);
  });

  it('smooths reader interest: a few views move a kind a place at most, many move it up', () => {
    const base = slugs(rankCategories(boca, { day }));
    const few = slugs(rankCategories(boca, { day, views: new Map([['pets', 10]]) }));
    expect(Math.abs(few.indexOf('pets') - base.indexOf('pets'))).toBeLessThanOrEqual(1);
    expect(few.filter((s) => s !== 'pets')).toEqual(base.filter((s) => s !== 'pets'));
    const many = slugs(rankCategories(boca, { day, views: new Map([['pets', 20_000]]) }));
    expect(many.indexOf('pets')).toBeLessThan(base.indexOf('pets') - 5);
  });

  it('breaks exact ties by a daily hash, never by name', () => {
    // Two kinds of unknown demand and the same size tie on score.
    const pets = directoryCategory('pets')!;
    const tied = [
      { category: { ...pets, slug: 'aaa' }, count: 5 },
      { category: { ...pets, slug: 'zzz' }, count: 5 },
    ];
    const orders = new Set(
      ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map(
        (d) => slugs(rankCategories(tied, { day: d })).join(),
      ),
    );
    expect(orders.size).toBe(2);
    expect(dailyHash('x|2026-10-17')).toBe(dailyHash('x|2026-10-17'));
  });

  it('has a demand prior for every kind in the directory', () => {
    expect(demandOf('no-such-kind')).toBeLessThan(Math.min(...Object.values(CATEGORY_DEMAND)));
    for (const { category } of boca) expect(CATEGORY_DEMAND[category.slug]).toBeDefined();
  });
});

const TOP_TEN = [
  'restaurants',
  'takeout-and-counter',
  'general-contractors',
  'hvac',
  'coffee-and-bakeries',
  'health-and-medical',
  'plumbers',
  'electricians',
  'roofers',
  'beauty-and-wellness',
];
