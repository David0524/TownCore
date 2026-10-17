import {
  businesses,
  eq,
  placements,
  records,
  slotStatsDaily,
  sources,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  categoryCounts,
  categoryListings,
  claimedListings,
  getListing,
  newFoodPlaces,
  relatedListings,
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

  it('orders by verified license, then completeness; inactive listings never appear', async () => {
    const { listings, total } = await categoryListings(db, townId, 'plumbers');
    const slugs = listings.map((l) => l.slug);
    // The claimed, complete one first and the unverified one last; the two equal ones rotate.
    expect(slugs[0]).toBe('z');
    expect(slugs[3]).toBe('u');
    expect(slugs.slice(1, 3).sort()).toEqual(['a', 'b']);
    expect(total).toBe(4);
    expect(await getListing(db, townId, 'gone')).toBeNull();
  });

  it('rotates equal listings daily: stable within a day, never above a better listing', async () => {
    const base = { townId, category: 'pets', dataSource: 'fl-dbpr', licenseVerified: true };
    await db.insert(businesses).values([
      ...Array.from({ length: 8 }, (_, i) => ({
        ...base,
        slug: `pet-${i}`,
        name: `Pet Place ${i}`,
        licenseNumber: `P${i}`,
      })),
      { ...base, slug: 'pet-best', name: 'Zzz Pets', licenseNumber: 'PB', phone: '555' },
      {
        ...base,
        slug: 'pet-unverified',
        name: 'Aaa Pets',
        licenseNumber: 'PU',
        licenseVerified: false,
      },
    ]);
    const order = async (day: string) =>
      (await categoryListings(db, townId, 'pets', { day })).listings.map((l) => l.slug);
    const days = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'];
    const orders = await Promise.all(days.map(order));
    for (const o of orders) {
      // A better-scored listing always leads and an unverified one always trails, whatever the day.
      expect(o[0]).toBe('pet-best');
      expect(o.at(-1)).toBe('pet-unverified');
    }
    // The same all day, for everyone.
    expect(await order(days[0]!)).toEqual(orders[0]);
    // Different days give different orders of the equal ones (never stuck, never A–Z).
    expect(new Set(orders.map((o) => o.join())).size).toBeGreaterThan(1);
    expect(orders.every((o) => o.slice(1, -1).join() === [...o.slice(1, -1)].sort().join())).toBe(
      false,
    );
  });

  it('ranks categories by demand, size and interest, not by name or config order', async () => {
    expect((await categoryCounts(db, townId)).map((c) => [c.category.slug, c.count])).toEqual([
      // Plumbers are in more demand than pet businesses, though there are more of the latter.
      ['plumbers', 4],
      ['pets', 10],
      ['roofers', 1],
    ]);
  });

  it('lets real reader interest move a kind, smoothed, never counting paid listings', async () => {
    const day = '2026-10-17';
    const ranked = async () =>
      (await categoryCounts(db, townId, { day })).map((c) => c.category.slug);
    const [roof] = await db.select().from(businesses).where(eq(businesses.slug, 'r'));
    const view = (on: string, impressions: number) =>
      db.insert(slotStatsDaily).values({
        townId,
        day: on,
        slot: 'directory.business.cta',
        businessId: roof!.id,
        impressions,
      });
    // A few views can't reorder the bar, and today's views wait for tomorrow.
    await view('2026-10-10', 20);
    await view(day, 50_000);
    expect(await ranked()).toEqual(['plumbers', 'pets', 'roofers']);
    // Many readers looking at roofers moves the kind up.
    await view('2026-10-11', 5_000);
    expect(await ranked()).toEqual(['roofers', 'plumbers', 'pets']);
    // Views older than the window don't count.
    expect((await categoryCounts(db, townId, { day: '2026-12-31' }))[0]!.category.slug).toBe(
      'plumbers',
    );
    // A paid listing's views never count (Rule 6).
    await db
      .insert(placements)
      .values({ townId, businessId: roof!.id, product: 'enhanced', status: 'active' });
    expect(await ranked()).toEqual(['plumbers', 'pets', 'roofers']);
    await db.delete(placements).where(eq(placements.businessId, roof!.id));
    await db.delete(slotStatsDaily).where(eq(slotStatsDaily.businessId, roof!.id));
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

  it('features claimed listings only', async () => {
    expect((await claimedListings(db, townId)).map((l) => l.slug)).toEqual(['z']);
  });

  it('relates businesses the story names first, then its beat’s category', async () => {
    const story = await relatedListings(db, townId, {
      text: 'Crews from Alpha Plumbing replaced the main. Roof Co was not involved.',
      beat: 'development',
    });
    // "Roof Co" is too short to match by name safely.
    expect(story.named.map((l) => l.slug)).toEqual(['a']);
    // No general contractors here, so the next development category with listings: roofers.
    expect(story.category?.slug).toBe('roofers');
    expect(story.listings.map((l) => l.slug)).toEqual(['r']);
    const none = await relatedListings(db, townId, { text: 'Nothing here.', beat: 'schools' });
    expect(none).toEqual({ named: [], category: null, listings: [] });
  });

  it('lists newly licensed food places once each, newest first, linked when listed', async () => {
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'business_filings', platform: 'fl-dbpr', adapter: 'fl-dbpr' })
      .returning();
    const now = new Date('2026-10-16T12:00:00Z');
    const add = (id: string, at: string, raw: Record<string, string>) =>
      db.insert(records).values({
        sourceId: source!.id,
        townId,
        externalId: id,
        type: 'new_food_license',
        title: raw.businessName,
        raw: { occupation: 'Permanent Food Service, seating', zip: '33432-1234', ...raw },
        occurredAt: new Date(at),
        contentHash: id,
      });
    await db.insert(businesses).values({
      townId,
      slug: 'taco-spot-sea1',
      name: 'Taco Spot',
      category: 'restaurants',
      dataSource: 'fl-dbpr',
      licenseNumber: 'SEA1',
    });
    await add('n1', '2026-10-01', { businessName: 'TACO SPOT', licenseNumber: 'SEA1' });
    await add('n2', '2026-10-10', { businessName: 'NEW BAGELS', licenseNumber: 'SEA2' });
    await add('n3', '2026-10-05', { businessName: 'TACO SPOT', licenseNumber: 'SEA1' });
    await add('old', '2026-05-01', { businessName: 'OLD DINER', licenseNumber: 'SEA3' });
    const places = await newFoodPlaces(db, townId, { now });
    expect(places.map((p) => [p.name, p.listing?.slug ?? null, p.zip])).toEqual([
      ['New Bagels', null, '33432'],
      ['Taco Spot', 'taco-spot-sea1', '33432'],
    ]);
  });
});
