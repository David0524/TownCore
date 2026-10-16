import type { OsmPlace } from '@towncore/adapters';
import { businesses, eq, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contactShown, listingPlace, matchName, seedOsmPlaces } from '../src';

// Mapped places in the directory (owner, 2026-10-16): only the town's area, a place we already
// list is enriched rather than duplicated, a claimed listing keeps its owner's details, and a
// place gone from the map is hidden.

const now = new Date('2026-10-16T12:00:00Z');

const place = (over: Partial<OsmPlace>): OsmPlace => ({
  ref: 'node/1',
  name: 'Sample Café',
  category: 'coffee-and-bakeries',
  lat: 26.35,
  lon: -80.08,
  street: '12 Test Road',
  city: null,
  zip: null,
  phone: '(561) 555-0100',
  website: 'https://samplecafe.example/',
  cuisine: 'coffee shop',
  hours: null,
  ...over,
});

describe('mapped places in the directory', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let town: { id: string; name: string; censusId: string | null };
  const lookups: Array<[number, number]> = [];
  // Inside the city at latitude 26.35; unincorporated in 33434 at 26.37; elsewhere beyond.
  const lookup = async (lat: number, lng: number) => {
    lookups.push([lat, lng]);
    if (lat < 26.36) return { placeGeoid: '1207300', zcta: '33432' };
    if (lat < 26.38) return { placeGeoid: null, zcta: '33434' };
    return { placeGeoid: '1217100', zcta: '33444' };
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [row] = await db
      .insert(towns)
      .values({
        slug: 'boca',
        name: 'Boca Raton',
        state: 'FL',
        county: 'Palm Beach',
        censusId: '1207300',
        timezone: 'America/New_York',
        domain: 'boca.test',
        siteName: 'Boca Test',
        tier: 'large',
        config: {},
      })
      .returning();
    town = { id: row!.id, name: row!.name, censusId: row!.censusId };
    // License listings: a restaurant the map also has, one in 33434 (so that ZIP is the town's),
    // and a claimed one whose owner set the phone.
    await db.insert(businesses).values([
      {
        townId: town.id,
        slug: 'sample-grill-sea1',
        name: 'SAMPLE GRILL LLC',
        category: 'restaurants',
        address: '1 Home Lane',
        city: 'BOCA RATON',
        zip: '33432',
        licenseNumber: 'SEA1',
        licenseVerified: true,
        dataSource: 'fl-dbpr',
      },
      {
        townId: town.id,
        slug: 'west-boca-roofing-ccc1',
        name: 'West Boca Roofing',
        category: 'roofers',
        city: 'BOCA RATON',
        zip: '33434',
        licenseNumber: 'CCC1',
        dataSource: 'fl-dbpr',
      },
      {
        townId: town.id,
        slug: 'pei-wei-sea3',
        name: 'PEI WEI FRESH KITCHEN #0256',
        category: 'restaurants',
        city: 'BOCA RATON',
        zip: '33432',
        licenseNumber: 'SEA3',
        dataSource: 'fl-dbpr',
      },
      {
        townId: town.id,
        slug: 'owned-diner-sea2',
        name: 'Owned Diner',
        category: 'restaurants',
        city: 'BOCA RATON',
        zip: '33432',
        phone: '(561) 555-0999',
        licenseNumber: 'SEA2',
        dataSource: 'fl-dbpr',
        claimedAt: now,
      },
    ]);
  });
  afterAll(async () => drop());

  it('compares names without case, punctuation or company suffixes', () => {
    expect(matchName('SAMPLE GRILL LLC')).toBe(matchName('The Sample Grill'));
    expect(matchName("Taso's Greek Taverna & Bar")).toBe('tasosgreektavernaandbar');
  });

  it('lists the town area, enriches what we have, and leaves the rest out', async () => {
    const result = await seedOsmPlaces(
      db,
      town,
      [
        place({}),
        place({
          ref: 'way/2',
          name: 'The Sample Grill',
          category: 'restaurants',
          cuisine: 'grill',
        }),
        place({
          ref: 'node/3',
          name: 'West Side Pets',
          category: 'pets',
          lat: 26.37,
          street: null,
        }),
        place({ ref: 'node/4', name: 'Next Town Bar', category: 'bars-and-nightlife', lat: 26.4 }),
        place({
          ref: 'node/5',
          name: 'Owned Diner',
          category: 'restaurants',
          phone: '(561) 555-0000',
        }),
        place({ ref: 'node/6', name: 'Pei Wei', category: 'restaurants' }),
      ],
      { lookup, now },
    );
    expect(result).toMatchObject({ created: 2, matched: 3, outside: 1, lookupFailed: false });

    const all = await db.select().from(businesses).where(eq(businesses.townId, town.id));
    const by = (name: string) => all.find((b) => b.name === name)!;
    const cafe = by('Sample Café');
    expect(cafe).toMatchObject({
      dataSource: 'osm',
      osmRef: 'node/1',
      category: 'coffee-and-bakeries',
      address: '12 Test Road',
      addressPublic: true,
      city: 'Boca Raton',
      zip: '33432',
      inCityLimits: true,
      licenseVerified: false,
    });
    expect(contactShown(cafe)).toBe(true);
    expect(listingPlace(cafe, 'Boca Raton')).toBe('12 Test Road, Boca Raton area, 33432');
    // West Boca is outside the city but in a town ZIP; no street, so none is shown.
    expect(by('West Side Pets')).toMatchObject({ inCityLimits: false, zip: '33434' });
    expect(all.some((b) => b.name === 'Next Town Bar')).toBe(false);

    // The license listing gets the storefront's details; its home address is replaced by the
    // public one.
    expect(by('SAMPLE GRILL LLC')).toMatchObject({
      osmRef: 'way/2',
      cuisine: 'grill',
      address: '12 Test Road',
      addressPublic: true,
      phone: '(561) 555-0100',
    });
    // A name that starts the license name, in the same ZIP, is the same place.
    expect(by('PEI WEI FRESH KITCHEN #0256')).toMatchObject({ osmRef: 'node/6' });
    // A claimed listing keeps its owner's phone.
    expect(by('Owned Diner')).toMatchObject({ osmRef: 'node/5', phone: '(561) 555-0999' });
  });

  it('looks up only new places, and hides places gone from the map', async () => {
    lookups.length = 0;
    const result = await seedOsmPlaces(
      db,
      town,
      [
        place({ phone: '(561) 555-0111' }),
        place({ ref: 'way/2', name: 'The Sample Grill', category: 'restaurants' }),
      ],
      { lookup, now },
    );
    expect(lookups).toEqual([]);
    expect(result).toMatchObject({ updated: 2, hidden: 1 });
    const [pets] = await db.select().from(businesses).where(eq(businesses.osmRef, 'node/3'));
    expect(pets!.active).toBe(false);
    const [cafe] = await db.select().from(businesses).where(eq(businesses.osmRef, 'node/1'));
    expect(cafe!.phone).toBe('(561) 555-0111');
  });

  it('decides by a mapped ZIP without a lookup', async () => {
    lookups.length = 0;
    const result = await seedOsmPlaces(
      db,
      town,
      [
        place({ ref: 'node/1' }),
        place({ ref: 'way/2', name: 'The Sample Grill', category: 'restaurants' }),
        place({ ref: 'node/8', name: 'Zip Bakery', zip: '33432' }),
        place({
          ref: 'node/9',
          name: 'Delray Deli',
          category: 'grocery-and-markets',
          zip: '33444',
        }),
      ],
      { lookup, now },
    );
    expect(lookups).toEqual([]);
    expect(result).toMatchObject({ created: 1, outside: 1 });
    const [bakery] = await db.select().from(businesses).where(eq(businesses.osmRef, 'node/8'));
    // Inside or outside city limits is left to the address geocoder.
    expect(bakery).toMatchObject({ zip: '33432', inCityLimits: null, geocodedAt: null });
  });
});
