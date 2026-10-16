import { businesses, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  categoryCounts,
  categoryListings,
  getListing,
  listingPlace,
  searchListings,
  type Listing,
} from '../src';

describe('directory queries', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'q',
        name: 'Quay',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'q.test',
        siteName: 'Quay Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const base = { townId, category: 'plumbers', dataSource: 'fl-dbpr', zip: '33432' };
    await db.insert(businesses).values([
      { ...base, slug: 'a', name: 'Alpha Plumbing', licenseNumber: '1', licenseVerified: true },
      { ...base, slug: 'b', name: 'Beta 100% Plumbing', licenseNumber: '2', licenseVerified: true },
      {
        ...base,
        slug: 'z',
        name: 'Zulu Plumbing',
        licenseNumber: '3',
        licenseVerified: true,
        phone: '555',
        address: '1 Main St',
        claimedAt: new Date(),
      },
      { ...base, slug: 'u', name: 'Unverified Plumbing', licenseNumber: '4' },
      { ...base, slug: 'gone', name: 'Gone Plumbing', licenseNumber: '5', active: false },
      { ...base, slug: 'r', name: 'Roof Co', licenseNumber: '6', category: 'roofers' },
    ]);
  });
  afterAll(async () => drop());

  it('orders by verified license, then completeness, then name; inactive listings never appear', async () => {
    const { listings, total } = await categoryListings(db, townId, 'plumbers');
    expect(listings.map((l) => l.slug)).toEqual(['z', 'a', 'b', 'u']);
    expect(total).toBe(4);
    expect(await getListing(db, townId, 'gone')).toBeNull();
  });

  it('counts per category in config order', async () => {
    expect((await categoryCounts(db, townId)).map((c) => [c.category.slug, c.count])).toEqual([
      ['roofers', 1],
      ['plumbers', 4],
    ]);
  });

  it('searches by name with LIKE wildcards taken literally', async () => {
    expect((await searchListings(db, townId, '100%')).map((l) => l.slug)).toEqual(['b']);
    expect(await searchListings(db, townId, '%')).toEqual([]);
    expect((await categoryListings(db, townId, 'plumbers', { q: 'alpha' })).total).toBe(1);
  });

  it('shows a street only for claimed listings', async () => {
    const claimed = (await getListing(db, townId, 'z')) as Listing;
    const unclaimed = { ...claimed, claimedAt: null };
    expect(listingPlace(claimed, 'Quay')).toBe('1 Main St, Quay area, 33432');
    expect(listingPlace(unclaimed, 'Quay')).toBe('Quay area · 33432');
  });
});
