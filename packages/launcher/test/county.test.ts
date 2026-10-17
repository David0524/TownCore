import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fetcher, replayFetch, type FetchFn } from '@towncore/adapters';
import { loadCountyRegistry } from '@towncore/config';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  countyDiscovery,
  DEFAULT_COUNTIES_DIR,
  draftCountyYaml,
  mentionsCounty,
} from '../src/county';
import { withCountyKinds } from '../src/sources-step';

// County data in a launch (owner, 2026-10-17): the registry when the county has an entry,
// otherwise a draft from the ArcGIS Online and Socrata catalogs for a person to confirm.

const fixtures = fileURLToPath(new URL('./fixtures/county/', import.meta.url));
const registry = loadCountyRegistry(DEFAULT_COUNTIES_DIR);
const now = new Date('2026-10-17T03:00:00Z');
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });

describe('county discovery', () => {
  it('takes a registered county for a town with a verified code, a to-do for one without', async () => {
    const asked: string[] = [];
    const stub: FetchFn = async (input) => {
      asked.push(input);
      if (input.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return Response.json({ features: [], exceededTransferLimit: false });
    };
    const boca = await countyDiscovery(
      fetcherFor(stub),
      { name: 'Boca Raton', state: 'FL', county: 'Palm Beach' },
      registry,
      now,
    );
    expect(boca).toMatchObject({
      registered: true,
      kinds: ['property_sales'],
      todos: [],
      draft: null,
    });
    const query = new URL(asked.find((u) => u.includes('/query'))!);
    expect(query.searchParams.get('where')).toContain("PARCEL_NUMBER LIKE '06%'");
    expect(query.searchParams.get('outFields')).not.toMatch(/OWNER|MAIL/i);

    const delray = await countyDiscovery(
      fetcherFor(stub),
      { name: 'Delray Beach', state: 'FL', county: 'Palm Beach' },
      registry,
      now,
    );
    expect(delray.kinds).toEqual([]);
    expect(delray.todos[0]).toMatch(
      /no verified PARCEL_NUMBER municipality code for Delray Beach.*counties\/fl\/palm-beach\.yaml/,
    );
  });

  it('searches the catalogs for a county not in the registry, keeping only its own data (recorded)', async () => {
    // Recorded live 2026-10-17. Broward's tax roll has sale dates but deed stamps, not prices,
    // and a split street address, so nothing is drafted: a person gets the near misses instead.
    const detail = await countyDiscovery(
      fetcherFor(replayFetch(join(fixtures, 'broward.json'))),
      { name: 'Fort Lauderdale', state: 'FL', county: 'Broward' },
      new Map(),
      now,
    );
    expect(detail).toMatchObject({ registered: false, kinds: [], draft: null });
    // Only Broward's own data sets: the catalogs' hits from Austin, Chicago or Marin are dropped.
    expect(detail.candidates.map((c) => c.url)).toEqual([
      'https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/Real_Property_TEST/FeatureServer/11',
      'https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/QAlertBCPA_Parcel_TaxRoll/FeatureServer/3',
      'https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/Infrastructure_WFL1/FeatureServer/117',
    ]);
    for (const c of detail.candidates)
      expect(Object.values(c.roles).join()).not.toMatch(/owner|name|mail/i);
    expect(detail.candidates[1]!.personal).toEqual(
      expect.arrayContaining(['NAME_LINE_1', 'NAME_LINE_2']),
    );
    expect(detail.todos[0]).toMatch(
      /Broward County isn't in the county registry.*partial matches: Broward County Real Property Records/,
    );
  });

  it('keeps only data sets that name the county', () => {
    expect(mentionsCounty('Broward', ['Broward County Parcel Tax Roll'])).toBe(true);
    expect(mentionsCounty('Marin', ['data.marincounty.gov'])).toBe(true);
    expect(mentionsCounty('Marin', ['County of Marin, CA'])).toBe(true);
    expect(mentionsCounty('Broward', ['data.cityofchicago.org', 'City of Chicago'])).toBe(false);
    expect(mentionsCounty('Palm Beach', ['Palm Beach County Property Appraiser'])).toBe(true);
  });

  it('never drafts a column that can name a person, and needs most required roles', () => {
    const base = {
      kind: 'property_sales' as const,
      platform: 'arcgis' as const,
      url: 'https://gis.example.gov/arcgis/rest/services/Sales/MapServer/0',
      title: 'Sales',
      placeColumns: ['MUNICIPALITY'],
      personal: ['OWNER_NAME1', 'MAILING_ADDR'],
    };
    const yaml = draftCountyYaml({ state: 'FL', county: 'Test' }, [
      { ...base, roles: { date: 'SALE_DATE', price: 'PRICE', address: 'SITE_ADDR' }, score: 1 },
      { ...base, kind: 'permits', roles: { date: 'ISSUED' }, score: 1 / 3 },
    ])!;
    expect(yaml).toContain('Left out as personal: OWNER_NAME1, MAILING_ADDR');
    const doc = parse(yaml);
    expect(doc.sources).toHaveLength(1);
    expect(doc.sources[0].outFields).toEqual(['SALE_DATE', 'PRICE', 'SITE_ADDR']);
    expect(draftCountyYaml({ state: 'FL', county: 'Test' }, [])).toBeNull();
  });

  it('writes the county kinds into the town file', () => {
    const town = 'slug: x\nsources:\n  - kind: weather\n    platform: nws\npricing: {}\n';
    const once = withCountyKinds(town, ['property_sales']);
    expect(once).toContain('county_sources: [property_sales]');
    expect(withCountyKinds(once, ['property_sales', 'permits'])).toContain(
      'county_sources: [property_sales, permits]',
    );
    expect(withCountyKinds(town, [])).toBe(town);
  });
});
