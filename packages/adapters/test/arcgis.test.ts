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
});
