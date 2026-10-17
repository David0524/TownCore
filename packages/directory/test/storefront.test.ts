import { businesses, directoryPrices, placements, towns, type Db, type Town } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  eligibleListings,
  listingsHolding,
  parseStartRequest,
  searchListings,
  startOffer,
  storefrontCategories,
} from '../src';

// The advertise page as a storefront (owner, 2026-10-17): the category chooser's counts, open
// spots and from-prices in a few queries, and what /advertise/start accepts and offers.

describe('the advertise storefront', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let town: Town;
  const ids: Record<string, string> = {};
  // Saturday, Oct. 17, 2026, noon in Florida.
  const now = new Date('2026-10-17T16:00:00Z');

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    [town] = (await db
      .insert(towns)
      .values({
        slug: 'shoptown',
        name: 'Shoptown',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'shoptown.test',
        siteName: 'The Shoptown Square',
        tier: 'large',
        config: {},
      })
      .returning()) as [Town];
    const rows = await db
      .insert(businesses)
      .values(
        [
          { slug: 'pipe-1', name: 'Pipe One', category: 'plumbers' },
          { slug: 'pipe-2', name: 'Pipe Two', category: 'plumbers' },
          { slug: 'pipe-3', name: 'Pipe Three', category: 'plumbers' },
          { slug: 'roof-1', name: 'Roof One', category: 'roofers' },
          { slug: 'gone', name: 'Pipe Gone', category: 'plumbers', active: false },
        ].map((b) => ({ ...b, townId: town.id, dataSource: 'test' })),
      )
      .returning();
    for (const row of rows) ids[row.slug] = row.id;
    // Roofers: #1 and #2 sold, #3 held by a Checkout started a minute ago.
    await db.insert(placements).values(
      [
        { rank: 1, status: 'active' as const, businessId: ids['roof-1']! },
        { rank: 2, status: 'held' as const, businessId: ids['pipe-1']! },
        {
          rank: 3,
          status: 'pending' as const,
          businessId: ids['pipe-2']!,
          createdAt: new Date(now.getTime() - 60_000),
        },
      ].map((p) => ({
        ...p,
        townId: town.id,
        product: 'sponsored_slot' as const,
        category: 'roofers',
      })),
    );
    // Plumbers: #2 sold; a stale Checkout from yesterday no longer holds #3.
    await db.insert(placements).values(
      [
        { rank: 2, status: 'active' as const, createdAt: now },
        { rank: 3, status: 'pending' as const, createdAt: new Date(now.getTime() - 86_400_000) },
      ].map((p) => ({
        ...p,
        townId: town.id,
        businessId: ids['pipe-3']!,
        product: 'sponsored_slot' as const,
        category: 'plumbers',
      })),
    );
    // Plumbers' #1 costs more this month than the large-tier list price ($19).
    await db.insert(directoryPrices).values({
      townId: town.id,
      category: 'plumbers',
      product: 'sponsored_slot',
      rank: 1,
      amountCents: 2300,
      setBy: 'monthly',
    });
  });
  afterAll(async () => drop());

  it('lists categories with listings, their open spots and from-prices', async () => {
    const categories = await storefrontCategories(db, town, now);
    expect(
      categories.map((c) => ({
        slug: c.category.slug,
        count: c.count,
        open: c.open,
        prices: c.prices,
        from: c.fromCents,
      })),
    ).toEqual([
      {
        slug: 'roofers',
        count: 1,
        open: [],
        prices: { 1: 1900, 2: 1200, 3: 700 },
        // All taken: the cheapest spot, for the waitlist.
        from: 700,
      },
      {
        slug: 'plumbers',
        count: 3,
        open: [1, 3],
        prices: { 1: 2300, 2: 1200, 3: 700 },
        from: 700,
      },
    ]);
  });

  it('accepts only products that are on, with the category and spot they need', () => {
    expect(
      parseStartRequest({ product: 'sponsored_slot', category: 'plumbers', rank: '1' }),
    ).toMatchObject({
      ok: true,
      request: { product: 'sponsored_slot', category: { slug: 'plumbers' }, rank: 1, period: null },
    });
    expect(
      parseStartRequest({ product: 'sponsored_slot', category: 'plumbers', rank: '4' }),
    ).toEqual({
      ok: false,
      reason: 'rank',
      product: 'sponsored_slot',
    });
    expect(parseStartRequest({ product: 'sponsored_slot', rank: '2' })).toEqual({
      ok: false,
      reason: 'needs_category',
      product: 'sponsored_slot',
      rank: 2,
    });
    expect(parseStartRequest({ product: 'exclusive', category: 'nope' })).toMatchObject({
      reason: 'needs_category',
    });
    expect(parseStartRequest({ product: 'spotlight' })).toEqual({ ok: false, reason: 'product' });
    expect(parseStartRequest({ product: 'free_money' })).toEqual({ ok: false, reason: 'product' });
    // Enhanced and the newsletter aren't per category: a category is ignored.
    expect(parseStartRequest({ product: 'enhanced', category: 'plumbers' })).toMatchObject({
      ok: true,
      request: { product: 'enhanced', category: null, rank: null },
    });
    expect(parseStartRequest({ product: 'newsletter', period: '2026-10-26' })).toMatchObject({
      request: { period: '2026-10-26' },
    });
    expect(parseStartRequest({ product: 'newsletter', period: 'next week' })).toMatchObject({
      request: { period: null },
    });
  });

  it('offers what is open, at the current price, with the trial where it applies', async () => {
    const spot = (rank: string) =>
      parseStartRequest({ product: 'sponsored_slot', category: 'plumbers', rank });
    const one = spot('1');
    const two = spot('2');
    if (!one.ok || !two.ok) throw new Error('parse');
    expect(await startOffer(db, town, one.request, now)).toMatchObject({
      cents: 2300,
      trialDays: 30,
      openRanks: [1, 3],
      available: true,
    });
    expect(await startOffer(db, town, two.request, now)).toMatchObject({ available: false });

    const week = parseStartRequest({ product: 'newsletter', period: '2026-10-26' });
    if (!week.ok) throw new Error('parse');
    const weekly = await startOffer(db, town, week.request, now);
    expect(weekly).toMatchObject({
      cents: 4500,
      trialDays: 0,
      available: true,
      periodTaken: false,
    });
    expect(weekly.windows[0]).toMatchObject({ start: '2026-10-19' });
    // A week that isn't on sale (already started) offers the next open one instead.
    const past = parseStartRequest({ product: 'newsletter', period: '2026-10-12' });
    if (!past.ok) throw new Error('parse');
    expect(await startOffer(db, town, past.request, now)).toMatchObject({ periodTaken: true });

    const month = parseStartRequest({ product: 'exclusive', category: 'roofers' });
    if (!month.ok) throw new Error('parse');
    expect(await startOffer(db, town, month.request, now)).toMatchObject({
      cents: 7500,
      available: true,
    });
  });

  it('buys only from listings that fit, and knows which already have it', async () => {
    const listings = [
      { id: ids['pipe-1']!, category: 'plumbers' },
      { id: ids['roof-1']!, category: 'roofers' },
    ];
    const plumbers = parseStartRequest({
      product: 'sponsored_slot',
      category: 'plumbers',
      rank: '1',
    });
    const enhanced = parseStartRequest({ product: 'enhanced' });
    if (!plumbers.ok || !enhanced.ok) throw new Error('parse');
    expect(eligibleListings(listings, plumbers.request)).toEqual([listings[0]]);
    expect(eligibleListings(listings, enhanced.request)).toEqual(listings);
    const holding = await listingsHolding(
      db,
      [ids['pipe-1']!, ids['roof-1']!, ids['pipe-2']!],
      'sponsored_slot',
    );
    // Active and held count; a pending Checkout doesn't.
    expect([...holding].sort()).toEqual([ids['pipe-1']!, ids['roof-1']!].sort());
    expect(await listingsHolding(db, [ids['pipe-1']!], 'newsletter')).toEqual(new Set());
  });

  it('searches listings within a category', async () => {
    const all = await searchListings(db, town.id, 'one', 10);
    expect(all.map((l) => l.slug).sort()).toEqual(['pipe-1', 'roof-1']);
    const roofers = await searchListings(db, town.id, 'one', 10, 'roofers');
    expect(roofers.map((l) => l.slug)).toEqual(['roof-1']);
  });
});
