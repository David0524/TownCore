import { directoryCategories } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { displayName, listingFromRecord, listingSlug, titleCase } from '../src';

const now = new Date('2026-10-15T12:00:00Z');

const contractor = (over: Record<string, string> = {}) => ({
  type: 'license',
  raw: {
    board: '06',
    occupationCode: 'CGC',
    occupation: 'Certified General Contractor',
    licenseeName: 'ERGLE, GERALD K',
    dbaName: '',
    address1: '170 NE 2ND STREET #111',
    address2: '',
    address3: '',
    city: 'BOCA RATON',
    zip: '33432-1234',
    licenseNumber: '0006261',
    alternateLicenseNumber: 'CGC006261',
    primaryStatus: 'C',
    secondaryStatus: 'A',
    expirationDate: '08/31/2028',
    ...over,
  },
});

const restaurant = (over: Record<string, string> = {}) => ({
  type: 'food_license',
  raw: {
    board: '200',
    licenseType: '2010',
    rank: 'SEAT',
    occupation: 'Permanent Food Service, seating',
    licenseeName: '18TH STREET BAGELS INC',
    businessName: 'BAGEL CITY SOUTH',
    address1: '6006 SW 18 ST',
    city: 'BOCA RATON',
    zip: '33433-7188',
    licenseNumber: 'SEA6010779',
    expirationDate: '12/01/2026',
    ...over,
  },
});

describe('names', () => {
  it('title-cases state names and keeps legal suffixes', () => {
    expect(titleCase('BAGEL CITY SOUTH')).toBe('Bagel City South');
    expect(titleCase('SUNSHINE A/C AND HEATING LLC')).toBe('Sunshine A/C and Heating LLC');
    expect(titleCase('MCDONALD ROOFING CO')).toBe('McDonald Roofing Co');
  });

  it('turns "LAST, FIRST" into a person’s name, but not company names', () => {
    expect(displayName('ERGLE, GERALD K')).toBe('Gerald K Ergle');
    expect(displayName('SMITH, JONES & CO')).toBe('Smith, Jones & Co');
  });

  it('builds stable slugs from the name and license', () => {
    expect(listingSlug('Bagel City South', 'SEA6010779')).toBe('bagel-city-south-sea6010779');
    expect(listingSlug('Café & Co.', 'CGC1')).toBe('cafe-and-co-cgc1');
  });
});

describe('listingFromRecord', () => {
  it('lists an active contractor in its category, with a five-digit ZIP', () => {
    expect(listingFromRecord(contractor(), now)).toMatchObject({
      licenseNumber: 'CGC006261',
      category: 'general-contractors',
      name: 'Gerald K Ergle',
      city: 'BOCA RATON',
      zip: '33432',
      active: true,
    });
  });

  it('prefers the DBA name', () => {
    const listing = listingFromRecord(contractor({ dbaName: 'ERGLE BUILDERS' }), now);
    expect(listing).toMatchObject({ name: 'Ergle Builders', hasDba: true });
  });

  it('marks inactive, expired and suspended licenses inactive', () => {
    expect(listingFromRecord(contractor({ secondaryStatus: 'I' }), now)).toMatchObject({
      active: false,
    });
    expect(listingFromRecord(contractor({ primaryStatus: 'S' }), now)).toMatchObject({
      active: false,
    });
    expect(listingFromRecord(contractor({ expirationDate: '08/31/2026' }), now)).toMatchObject({
      active: false,
    });
  });

  it('skips licenses outside the directory categories and rows without a license', () => {
    expect(listingFromRecord(contractor({ occupationCode: 'FRO' }), now)).toEqual({
      skip: 'uncategorized',
    });
    expect(
      listingFromRecord(contractor({ licenseNumber: '', alternateLicenseNumber: '' }), now),
    ).toEqual({ skip: 'no license number' });
  });

  it('lists restaurants by location, and lapsed ones as inactive', () => {
    expect(listingFromRecord(restaurant(), now)).toMatchObject({
      licenseNumber: 'SEA6010779',
      category: 'restaurants',
      name: 'Bagel City South',
      address: '6006 SW 18 ST',
      zip: '33433',
      active: true,
    });
    expect(listingFromRecord(restaurant({ expirationDate: '12/01/2025' }), now)).toMatchObject({
      active: false,
    });
    expect(listingFromRecord(restaurant({ licenseType: '2015', rank: 'VEND' }), now)).toEqual({
      skip: 'uncategorized',
    });
  });
});

describe('categories', () => {
  it('have unique slugs, and each license maps to one category', () => {
    const slugs = directoryCategories.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const licenses = directoryCategories.flatMap((c) => c.licenses);
    expect(new Set(licenses).size).toBe(licenses.length);
  });
});
