import { directoryCategory } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { houseAd } from '../src/slots/house';

// House ads with real numbers only (owner, 2026-10-17): current category prices, the open spots,
// and a reader count only above its minimum (the caller passes null below it).

const town = {
  name: 'Harbor Point',
  siteName: 'Harbor Point Ledger',
  tier: 'small',
  config: { contact_email: 'news@harborpoint.test' },
};
const plumbers = directoryCategory('plumbers')!;

describe('houseAd', () => {
  it('sells featured spots at the tier list price when the town sets none', () => {
    const ad = houseAd(town, 'home.top');
    expect(ad.body).toBe(
      "Featured spots in Harbor Point Ledger's directory from $4 a month. First 30 days free.",
    );
    expect(ad.offers).toEqual([
      { rank: '#1', price: '$9/mo' },
      { rank: '#2', price: '$6/mo' },
      { rank: '#3', price: '$4/mo' },
    ]);
  });

  it('uses the category’s current prices and offers only open spots', () => {
    const ad = houseAd(town, 'directory.category.top', {
      category: plumbers,
      openRanks: [3],
      prices: { 1: 1100, 2: 700, 3: 500 },
    });
    expect(ad.headline).toBe('Spot #3 is open');
    expect(ad.offers).toEqual([{ rank: '#3', price: '$5/mo' }]);
    expect(
      houseAd(town, 'directory.topspot', { category: plumbers, openRanks: [3] }).headline,
    ).toBe('Get your business featured');
  });

  it('names the reader count only when it clears the minimum', () => {
    expect(houseAd(town, 'home.top', { adCopy: 'reach-readers', readers: 4200 }).headline).toBe(
      'Reach 4,200 Harbor Point readers every morning',
    );
    expect(houseAd(town, 'home.top', { adCopy: 'reach-readers', readers: null }).headline).toBe(
      'Reach Harbor Point readers',
    );
    expect(houseAd(town, 'home.top', { readers: 4200 }).headline).toBe(
      'Get your business featured',
    );
  });
});
