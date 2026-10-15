import { fileURLToPath } from 'node:url';
import { Fetcher, replayFetch } from '@towncore/adapters';
import { businesses, eq, records, sources, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { geocodeListings, seedDirectory } from '../src';

const now = new Date('2026-10-15T12:00:00Z');
const geocoderFixture = fileURLToPath(
  new URL('../../adapters/fixtures/census/geocoder.json', import.meta.url),
);

describe('seeding the directory', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let sourceId: string;
  let n = 0;

  const addRecord = async (type: string, raw: Record<string, string>) => {
    await db
      .insert(records)
      .values({ sourceId, townId, externalId: `r${++n}`, type, raw, contentHash: `h${n}` });
  };
  const listing = async (licenseNumber: string) =>
    (await db.select().from(businesses).where(eq(businesses.licenseNumber, licenseNumber)))[0];

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'seedville',
        name: 'Boca Raton',
        state: 'FL',
        county: 'Palm Beach',
        censusId: '1207300',
        timezone: 'America/New_York',
        domain: 'seedville.test',
        siteName: 'Seedville Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'business_filings', platform: 'fl-dbpr', adapter: 'fl-dbpr' })
      .returning();
    sourceId = source!.id;

    const base = {
      board: '06',
      occupationCode: 'CGC',
      city: 'BOCA RATON',
      zip: '33432',
      primaryStatus: 'C',
      secondaryStatus: 'A',
      expirationDate: '08/31/2028',
    };
    // One license, two rows: the qualifier and the company with a DBA.
    await addRecord('license', {
      ...base,
      licenseeName: 'DOE, JANE',
      alternateLicenseNumber: 'CGC1',
      address1: '201 W PALMETTO PARK RD',
    });
    await addRecord('license', {
      ...base,
      licenseeName: 'DOE, JANE',
      dbaName: 'DOE BUILDERS LLC',
      alternateLicenseNumber: 'CGC1',
      address1: '201 W PALMETTO PARK RD',
    });
    await addRecord('license', {
      ...base,
      licenseeName: 'ROE, RICK',
      alternateLicenseNumber: 'CGC2',
      secondaryStatus: 'I',
    });
    await addRecord('license', { ...base, occupationCode: 'FRO', licenseeName: 'X' });
    await addRecord('food_license', {
      licenseType: '2010',
      rank: 'SEAT',
      businessName: 'BAGEL CITY SOUTH',
      licenseeName: '18TH STREET BAGELS INC',
      address1: '6006 SW 18 ST',
      city: 'BOCA RATON',
      zip: '33433-7188',
      licenseNumber: 'SEA6010779',
      expirationDate: '12/01/2026',
    });
    await addRecord('food_license', {
      licenseType: '2010',
      rank: 'SEAT',
      businessName: 'BOCA WEST COUNTRY CLUB',
      address1: '20583 BOCA WEST DR',
      city: 'BOCA RATON',
      zip: '33434-9990',
      licenseNumber: 'SEA6011713',
      expirationDate: '12/01/2026',
    });
  });
  afterAll(async () => drop());

  it('creates one listing per license, preferring the DBA row, with active flags', async () => {
    const result = await seedDirectory(db, townId, now);
    expect(result).toMatchObject({ created: 4, updated: 0, active: 3, inactive: 1 });
    expect(result.skipped).toEqual({ uncategorized: 1 });
    expect(await listing('CGC1')).toMatchObject({
      name: 'Doe Builders LLC',
      slug: 'doe-builders-llc-cgc1',
      category: 'general-contractors',
      licenseVerified: true,
      dataSource: 'fl-dbpr',
      active: true,
    });
    expect(await listing('CGC2')).toMatchObject({ active: false });
    expect(await listing('SEA6010779')).toMatchObject({ category: 'restaurants', zip: '33433' });
  });

  it('is idempotent and keeps a claimed owner’s edits', async () => {
    await db
      .update(businesses)
      .set({ name: 'Doe Builders', claimedAt: now, claimedByEmail: 'jane@example.com' })
      .where(eq(businesses.licenseNumber, 'CGC1'));
    const again = await seedDirectory(db, townId, now);
    expect(again).toMatchObject({ created: 0, updated: 4 });
    expect(await listing('CGC1')).toMatchObject({
      name: 'Doe Builders',
      slug: 'doe-builders-llc-cgc1',
    });
  });

  it('geocodes active listings and marks city limits from the Census place', async () => {
    const fetcher = new Fetcher({
      fetchImpl: replayFetch(geocoderFixture),
      sleep: async () => {},
      minIntervalMs: 0,
    });
    const result = await geocodeListings(db, fetcher, townId, { now });
    expect(result).toEqual({ matched: 2, noMatch: 1, failed: false });
    expect(await listing('CGC1')).toMatchObject({ inCityLimits: true, geocodeStatus: 'match' });
    expect(await listing('SEA6010779')).toMatchObject({
      inCityLimits: false,
      geocodeStatus: 'match',
    });
    expect(await listing('SEA6011713')).toMatchObject({
      inCityLimits: null,
      geocodeStatus: 'no_match',
    });
    // Inactive listings aren't geocoded; nothing is left pending.
    expect(await listing('CGC2')).toMatchObject({ geocodedAt: null });
    expect(await geocodeListings(db, fetcher, townId, { now })).toEqual({
      matched: 0,
      noMatch: 0,
      failed: false,
    });
  });

  it('re-geocodes when an unclaimed listing’s address changes, and hides lapsed licenses', async () => {
    await db
      .update(records)
      .set({
        raw: {
          licenseType: '2010',
          rank: 'SEAT',
          businessName: 'BAGEL CITY SOUTH',
          address1: '6010 SW 18 ST',
          city: 'BOCA RATON',
          zip: '33433',
          licenseNumber: 'SEA6010779',
          expirationDate: '12/01/2026',
        },
      })
      .where(eq(records.externalId, 'r5'));
    await seedDirectory(db, townId, now);
    expect(await listing('SEA6010779')).toMatchObject({
      address: '6010 SW 18 ST',
      geocodedAt: null,
    });

    await seedDirectory(db, townId, new Date('2026-12-02T00:00:00Z'));
    expect(await listing('SEA6010779')).toMatchObject({ active: false });
  });
});
