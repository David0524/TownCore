import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cityLimitsFilter,
  countySlug,
  countySourcesFor,
  loadCountyRegistry,
  parseCountyConfig,
  townSourceFromCounty,
} from '../src/county';
import { loadTownConfigs } from '../src/town';

// The county source registry (owner, 2026-10-17): one verified entry per county data set,
// built into each town's source with its own city-limits filter.

const root = fileURLToPath(new URL('../../../', import.meta.url));
const registry = loadCountyRegistry(join(root, 'counties'));
const pbc = registry.get('FL:palm-beach')!;

describe('county registry', () => {
  it('loads Palm Beach County and names its file by state and county', () => {
    expect(countySlug('Palm Beach')).toBe('palm-beach');
    expect(countySlug('Miami-Dade County')).toBe('miami-dade');
    expect(pbc.sources.map((s) => s.kind)).toEqual(['property_sales']);
  });

  it('builds the same source Boca had by hand, so its database row is kept', () => {
    const built = townSourceFromCounty(pbc.sources[0]!, 'Boca Raton');
    expect(built).toEqual({
      source: {
        kind: 'property_sales',
        platform: 'arcgis',
        url: 'https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Tables/MapServer/1',
        options: {
          dateField: 'SALE_DATE',
          idField: 'SALEKEY',
          title: '{SITE_ADDR_STR}',
          where:
            "PARCEL_NUMBER LIKE '06%' AND PRICE >= 1000 AND (CONFID_FLG IS NULL OR CONFID_FLG <> 'Y')",
          outFields: [
            'SALEKEY',
            'PARCEL_NUMBER',
            'SITE_ADDR_STR',
            'SUBDIV_NAME',
            'SALE_DATE',
            'PRICE',
            'INSTRUMENT',
            'PROPERTY_USE',
            'TOTAL_MARKET',
          ],
          fields: {
            SITE_ADDR_STR: 'Address',
            PRICE: 'Price',
            SALE_DATE: 'Sale date',
            INSTRUMENT: 'Deed',
            PROPERTY_USE: 'Use',
            SUBDIV_NAME: 'Subdivision',
            PARCEL_NUMBER: 'Parcel',
          },
          lagDays: 21,
          type: 'sale',
        },
      },
    });
    // The key order is part of the source's identity (sourceKey in packages/db).
    const options = (built as { source: { options: object } }).source.options;
    expect(Object.keys(options)).toEqual([
      'dateField',
      'idField',
      'title',
      'where',
      'outFields',
      'fields',
      'lagDays',
      'type',
    ]);
  });

  it('gives Boca the county source when towns load', () => {
    const boca = loadTownConfigs(join(root, 'towns')).find((t) => t.slug === 'boca-raton')!;
    expect(boca.county_sources).toEqual(['property_sales']);
    expect(boca.sources.filter((s) => s.kind === 'property_sales')).toHaveLength(1);
  });

  it('builds city limits from the jurisdiction, never guessing a code', () => {
    const prefix = pbc.sources[0]!.cityLimits;
    expect(cityLimitsFilter(prefix, 'boca raton')).toEqual({
      where: "PARCEL_NUMBER LIKE '06%'",
    });
    expect(cityLimitsFilter(prefix, 'Delray Beach')).toEqual({
      error: 'no verified PARCEL_NUMBER municipality code for Delray Beach',
    });
    expect(
      cityLimitsFilter({ method: 'jurisdiction_field', field: 'JURIS', values: {} }, "O'Brien"),
    ).toEqual({ where: "JURIS = 'O''BRIEN'" });
    expect(
      cityLimitsFilter(
        { method: 'jurisdiction_field', field: 'JURIS', values: { 'Port St. Lucie': 'PSL' } },
        'Port St. Lucie',
      ),
    ).toEqual({ where: "JURIS = 'PSL'" });
    expect(cityLimitsFilter({ method: 'geocode' }, 'Boca Raton')).toHaveProperty('error');
  });

  it('refuses a town the county has no verified city limits for, or a missing county', () => {
    const delray = { name: 'Delray Beach', state: 'FL', county: 'Palm Beach' };
    expect(() =>
      countySourcesFor(registry, { ...delray, county_sources: ['property_sales'] }),
    ).toThrow(/no verified PARCEL_NUMBER municipality code for Delray Beach/);
    expect(() => countySourcesFor(registry, { ...delray, county_sources: ['permits'] })).toThrow(
      /Palm Beach County has no permits source/,
    );
    expect(() =>
      countySourcesFor(registry, {
        name: 'Fort Lauderdale',
        state: 'FL',
        county: 'Broward',
        county_sources: ['property_sales'],
      }),
    ).toThrow(/counties\/fl\/broward\.yaml/);
    expect(countySourcesFor(registry, delray)).toEqual([]);
  });

  it('refuses property sales that could fetch owners, and misplaced files', () => {
    const base = `state: FL
county: Test
sources:
  - kind: property_sales
    platform: socrata
    url: https://data.example.gov/resource/abcd-1234.json
    label: Sales
    verified: 2026-10-17
    robots: allows /resource/
    roles: { date: sale_date }
    cityLimits: { method: geocode }
`;
    expect(() => parseCountyConfig(base)).toThrow(/owners are never fetched/);
    const dir = mkdtempSync(join(tmpdir(), 'counties-'));
    mkdirSync(join(dir, 'fl'));
    writeFileSync(
      join(dir, 'fl', 'wrong.yaml'),
      base
        .replace('platform: socrata', 'platform: arcgis')
        .replace('    roles:', '    outFields: [sale_date]\n    roles:'),
    );
    expect(() => loadCountyRegistry(dir)).toThrow(/counties\/fl\/test\.yaml/);
    expect(loadCountyRegistry(join(dir, 'missing')).size).toBe(0);
  });
});
