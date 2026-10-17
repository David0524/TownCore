import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arcgisAdapter } from '../src/arcgis';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from bocagis.ci.boca-raton.fl.us (the city's own ArcGIS Server; robots.txt
// answers 404, no rules) on 2026-10-17: the Development/InfrastructureAlerts map, one layer per
// stage (0 Proposed, 1 Approved_Not_Built, 2 Under Construction, 3 Completed). Only the listed
// columns are requested; the layers' staff columns (ASSIGNEDTO, SUPERVISOR, LASTEDITOR) never are.
const fixture = fileURLToPath(new URL('../fixtures/arcgis/boca-development.json', import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const service =
  'https://bocagis.ci.boca-raton.fl.us/gisweb/rest/services/Development/InfrastructureAlerts/MapServer';
const source: SourceConfig = {
  id: 'boca-dev',
  townId: 't',
  kind: 'permits',
  platform: 'arcgis',
  url: service,
  config: {
    stages: { '0': 'proposed', '1': 'approved', '2': 'under_construction', '3': 'completed' },
    caseField: 'CASE_FILE_NUM',
    title: '{PROJECT}',
    fields: {
      PROJECT: 'Project',
      FULLADDR: 'Address',
      DESCRIPTION: 'Description',
      TYPE: 'Use',
      UNITS: 'Size',
      BUILD_HEIGHT: 'Height',
      ZONING: 'Zoning',
      CASE_FILE_NUM: 'Case',
    },
    outFields: [
      'GlobalID',
      'PROJECT',
      'FULLADDR',
      'DESCRIPTION',
      'TYPE',
      'UNITS',
      'BUILD_HEIGHT',
      'ZONING',
      'CASE_FILE_NUM',
    ],
  },
};
const ctx = (fetchImpl: FetchFn) => ({
  fetcher: fetcherFor(fetchImpl),
  now: new Date('2026-10-17T12:00:00Z'),
});

describe('arcgis development stages', () => {
  it('makes one undated record per project and stage, the stage first in its text', async () => {
    const records = await arcgisAdapter.fetch(source, null, ctx(replayFetch(fixture)));
    expect(records).toHaveLength(143);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(143);
    const stages = new Map<string, number>();
    for (const r of records) {
      const raw = r.raw as Record<string, unknown>;
      stages.set(raw.stage as string, (stages.get(raw.stage as string) ?? 0) + 1);
      expect(r.type).toBe('development-project');
      expect(r.externalId).toBe(`project:${raw.project as string}:${raw.stage as string}`);
      expect(r.externalId).toMatch(/^project:\{[0-9A-F-]{36}\}:[a-z_]+$/);
      expect(r.occurredAt).toBeNull();
      expect(r.datedOnSight).toBe(true);
      expect(r.text).toMatch(
        /^Stage: (Proposed|Approved, not yet built|Under construction|Completed)\nProject: /,
      );
      expect(r.url).toMatch(/\/MapServer\/[0-3]$/);
      expect(Object.keys(raw)).not.toContain('ASSIGNEDTO');
      expect(Object.keys(raw)).not.toContain('LASTEDITOR');
    }
    expect(Object.fromEntries(stages)).toEqual({
      proposed: 30,
      approved: 62,
      under_construction: 39,
      completed: 12,
    });
    const mizner = records.find((r) => r.title === 'Mizner Plaza')!;
    expect(mizner.text).toContain('Address: 132/170/190 NE 2nd Street');
    expect((mizner.raw as { case: string }).case).toMatch(/^[A-Z0-9]/);
  });

  it('reads one layer with a status column, skipping statuses it does not map', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      urls.push(url);
      return new Response(
        JSON.stringify({
          features: [
            { attributes: { GlobalID: '{A}', NAME: 'Ridge Commons', STATUS: 'Approved' } },
            { attributes: { GlobalID: '{B}', NAME: 'Old Mill Lofts', STATUS: 'Withdrawn' } },
            { attributes: { GlobalID: '{C}', NAME: 'Depot Square', STATUS: 'Under Review' } },
          ],
        }),
      );
    };
    const layer = 'https://gis.example.gov/server/rest/services/Planning/Projects/FeatureServer/2';
    const records = await arcgisAdapter.fetch(
      {
        ...source,
        url: layer,
        config: {
          stages: { 'Under Review': 'proposed', Approved: 'approved' },
          stageField: 'STATUS',
          title: '{NAME}',
          outFields: ['NAME'],
        },
      },
      null,
      ctx(fetchImpl),
    );
    expect(records.map((r) => [r.title, (r.raw as { stage: string }).stage])).toEqual([
      ['Ridge Commons', 'approved'],
      ['Depot Square', 'proposed'],
    ]);
    const q = new URL(urls[0]!).searchParams;
    expect(new URL(urls[0]!).pathname).toMatch(/\/FeatureServer\/2\/query$/);
    expect(q.get('where')).toBe('1=1');
    expect(q.get('outFields')).toBe('NAME,GlobalID,STATUS');
    expect(q.get('returnGeometry')).toBe('false');
  });

  it('pages through a large layer and rejects a bad config', async () => {
    let calls = 0;
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      calls++;
      const offset = Number(new URL(url).searchParams.get('resultOffset'));
      return new Response(
        JSON.stringify({
          features: [{ attributes: { GlobalID: `{${offset}}` } }],
          exceededTransferLimit: offset === 0,
        }),
      );
    };
    const records = await arcgisAdapter.fetch(
      { ...source, config: { stages: { '0': 'proposed' } } },
      null,
      ctx(fetchImpl),
    );
    expect(calls).toBe(2);
    expect(records.map((r) => r.externalId)).toEqual([
      'project:{0}:proposed',
      'project:{1000}:proposed',
    ]);
    await expect(
      arcgisAdapter.fetch(
        { ...source, config: { stages: { '0': 'built' } } },
        null,
        ctx(fetchImpl),
      ),
    ).rejects.toThrow(/config.stages maps to/);
    await expect(
      arcgisAdapter.fetch(
        { ...source, url: `${service}/0`, config: { stages: { '0': 'proposed' } } },
        null,
        ctx(fetchImpl),
      ),
    ).rejects.toThrow(/needs url …\/MapServer$/);
  });
});
