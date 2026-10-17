import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arcgisAdapter } from '../src/arcgis';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from gis.fortlauderdale.gov (ArcGIS Server; robots.txt answers 404, no rules)
// on 2026-10-16: building permits submitted from March 12, 2026, the newest in the layer.
// Trimmed to 60 features with owner and applicant columns blanked.
const fixture = fileURLToPath(
  new URL('../fixtures/arcgis/fortlauderdale-permits.json', import.meta.url),
);
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const layer = 'https://gis.fortlauderdale.gov/server/rest/services/BuildingPermits/FeatureServer/0';
const source: SourceConfig = {
  id: 'ftl',
  townId: 't',
  kind: 'permits',
  platform: 'arcgis',
  url: layer,
  config: {
    dateField: 'SUBMITDT',
    idField: 'CASEKEY',
    title: '{PERMITTYPE}: {PERMITDESC} at {FULLADDR}',
    fields: {
      PERMITID: 'Permit',
      PERMITTYPE: 'Type',
      PERMITDESC: 'Work',
      FULLADDR: 'Address',
      PERMITSTAT: 'Status',
      ESTCOST: 'Estimated cost',
      CONTRACTOR: 'Contractor',
      SUBMITDT: 'Submitted',
      APPROVEDT: 'Approved',
    },
  },
};

describe('arcgis adapter', () => {
  it('turns features into records with dates as days and the field map', async () => {
    const records = await arcgisAdapter.fetch(source, new Date('2026-03-12T00:00:00Z'), {
      fetcher: fetcherFor(replayFetch(fixture)),
      now: new Date('2026-03-17T00:00:00Z'),
    });
    expect(records).toHaveLength(60);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(60);
    for (const r of records) {
      expect(r.type).toBe('permit');
      expect(r.externalId).toMatch(/^feature:\S+/);
      expect(r.url).toBe(layer);
      expect(r.occurredAt!.getTime()).toBeGreaterThan(Date.parse('2026-03-12T00:00:00Z'));
      expect(r.text).toMatch(/Submitted: 2026-03-\d{2}/);
      expect(r.text).not.toMatch(/OWNER(NAME|ADDR|CITY)/);
    }
  });

  it('queries newer features, newest first, without geometry, and surfaces query errors', async () => {
    const urls: string[] = [];
    let reply = '{"features":[]}';
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      urls.push(url);
      return new Response(reply);
    };
    const ctx = { fetcher: fetcherFor(fetchImpl), now: new Date('2026-10-02T00:00:00Z') };
    await arcgisAdapter.fetch(
      { ...source, config: { ...source.config, where: "PERMITSTAT = 'ISSUED'" } },
      new Date('2026-10-01T04:00:00Z'),
      ctx,
    );
    const q = new URL(urls[0]!).searchParams;
    expect(new URL(urls[0]!).pathname).toMatch(/\/FeatureServer\/0\/query$/);
    expect(q.get('where')).toBe(
      "(SUBMITDT > timestamp '2026-10-01 04:00:00') AND (PERMITSTAT = 'ISSUED')",
    );
    expect(q.get('orderByFields')).toBe('SUBMITDT DESC');
    expect(q.get('returnGeometry')).toBe('false');
    reply = '{"error":{"code":400,"message":"Invalid query"}}';
    await expect(arcgisAdapter.fetch(source, null, ctx)).rejects.toThrow(/Invalid query/);
  });

  it('refuses sources that are not a layer or have no date column', async () => {
    const ctx = { fetcher: fetcherFor(async () => new Response('{}')), now: new Date() };
    await expect(
      arcgisAdapter.fetch({ ...source, url: 'https://gis.x.test/' }, null, ctx),
    ).rejects.toThrow(/FeatureServer/);
    await expect(arcgisAdapter.fetch({ ...source, config: {} }, null, ctx)).rejects.toThrow(
      /dateField/,
    );
    expect(await arcgisAdapter.detect(`${layer}`, '')).toBe(0.95);
  });

  // Recorded live from maps.co.palm-beach.fl.us (ArcGIS Server; robots.txt answers 404, no
  // rules) on 2026-10-17: the Property Appraiser's sales table for Boca Raton, asking only for
  // the columns a story may use. Trimmed to the newest 120 sales.
  it('requests only the listed columns and re-reads lagging records (property sales)', async () => {
    const sales = fileURLToPath(new URL('../fixtures/arcgis/pbc-boca-sales.json', import.meta.url));
    const salesSource: SourceConfig = {
      id: 'pbc-sales',
      townId: 't',
      kind: 'property_sales',
      platform: 'arcgis',
      url: 'https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Tables/MapServer/1',
      config: {
        dateField: 'SALE_DATE',
        idField: 'SALEKEY',
        title: '{SITE_ADDR_STR}',
        where:
          "MUNICIPALITY = 'BOCA RATON' AND PRICE >= 1000 AND (CONFID_FLG IS NULL OR CONFID_FLG <> 'Y')",
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
    };
    const urls: string[] = [];
    const replay = replayFetch(sales);
    const fetchImpl: FetchFn = async (url, init) => {
      urls.push(String(url));
      return replay(url, init);
    };
    // The last run was Sept. 20; with 21 days of lag the query starts Aug. 30.
    const records = await arcgisAdapter.fetch(salesSource, new Date('2026-09-20T00:00:00Z'), {
      fetcher: fetcherFor(fetchImpl),
      now: new Date('2026-10-17T00:00:00Z'),
    });
    expect(records).toHaveLength(120);
    const q = new URL(urls.find((u) => u.includes('/query'))!).searchParams;
    expect(q.get('where')).toMatch(/^\(SALE_DATE > timestamp '2026-08-30 00:00:00'\)/);
    expect(q.get('outFields')!.split(',')).not.toContain('OWNER_NAME1');
    for (const r of records) {
      expect(r.type).toBe('sale');
      expect(r.externalId).toMatch(/^feature:\d+$/);
      expect(Object.keys(r.raw as object).sort()).toEqual(
        [
          'INSTRUMENT',
          'PARCEL_NUMBER',
          'PRICE',
          'PROPERTY_USE',
          'SALEKEY',
          'SALE_DATE',
          'SITE_ADDR_STR',
          'SUBDIV_NAME',
          'TOTAL_MARKET',
        ].sort(),
      );
      expect(r.text).toMatch(/^Address: .+\nPrice: \d+\nSale date: 2026-\d{2}-\d{2}/);
    }
  });
});
