import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cmsAdapter,
  inspections,
  queryUrl,
  severityLevel,
  severityWords,
  type NursingHomeInspection,
} from '../src/cms';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from data.cms.gov's Provider Data Catalog (no key; robots.txt allows
// /provider-data/ with a 10-second crawl delay) on 2026-10-17, September 2026 release: the
// nursing homes with a Boca Raton, FL and a West Palm Beach, FL address, their health citations
// and their penalties.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/cms/${name}.json`, import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const source = (city: string): SourceConfig => ({
  id: 's',
  townId: 't',
  kind: 'health_facilities',
  platform: 'cms',
  url: null,
  config: { city, state: 'FL' },
});
const NOW = new Date('2026-10-17T12:00:00Z');
const read = (name: string, city: string) =>
  cmsAdapter.fetch(source(city), null, {
    fetcher: fetcherFor(replayFetch(fixture(name))),
    now: NOW,
  });

describe('cms adapter', () => {
  it("turns a town's recent nursing-home inspections into one record per home and date", async () => {
    const records = await read('boca-raton', 'Boca Raton');
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(records.length);
    for (const r of records) {
      expect(r.type).toBe('nursing-home-inspection');
      expect(r.externalId).toMatch(/^inspection:\d{6}:\d{4}-\d{2}-\d{2}$/);
      expect(r.url).toMatch(
        /^https:\/\/www\.medicare\.gov\/care-compare\/details\/nursing-home\/\d{6}\?state=FL$/,
      );
      expect(r.text).toMatch(/^Facility: .+\nAddress: .+, BOCA RATON, FL \d{5}\n/);
      expect(r.text).toMatch(/\nCitations: \d+\nMost serious: [A-L]: /);
      // Inside the 240-day window read.
      expect(r.occurredAt!.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 240 * 86_400_000);
      const raw = r.raw as NursingHomeInspection;
      expect(raw.citations.length).toBeGreaterThan(0);
      expect(raw.homesInTown).toBe(11);
    }
    // The home's previous inspection with citations comes from the earlier cycles on file.
    const menorah = records.find((r) => r.externalId === 'inspection:105685:2026-07-10')!;
    expect((menorah.raw as NursingHomeInspection).previous).toEqual({
      date: '2026-03-04',
      citations: 2,
    });
    expect(menorah.text).toContain('Certified beds: 120');
    expect(menorah.text).toContain('Citation F0807 (D), Nutrition and Dietary Deficiencies');
  });

  it('reads penalties once each, and immediate jeopardy findings', async () => {
    const records = await read('west-palm-beach', 'West Palm Beach');
    const penalties = records.filter((r) => r.type === 'nursing-home-penalty');
    // CMS lists the one fine twice, under two ids; it's stored once.
    expect(penalties.map((r) => r.externalId)).toEqual(['penalty:105558:fine:2026-03-13:13065']);
    expect(penalties[0]!.text).toContain('Penalty: fine\nDate: 2026-03-13\nAmount: 13065');
    const aviata = records.find((r) => r.externalId === 'inspection:105558:2026-03-13')!;
    expect((aviata.raw as NursingHomeInspection).worst).toBe('J');
    expect(aviata.text).toContain('immediate jeopardy to resident health or safety');
  });

  it('asks only for the town, in full pages with a stable order', () => {
    const url = new URL(
      queryUrl(
        'penalties',
        { city: 'Boca Raton', state: 'FL' },
        { from: { field: 'penalty_date', date: new Date('2025-10-17T00:00:00Z') } },
      ),
    );
    expect(url.pathname).toBe('/provider-data/api/1/datastore/query/g6vv-u9sr/0');
    const q = url.searchParams;
    expect([q.get('conditions[0][property]'), q.get('conditions[0][value]')]).toEqual([
      'citytown',
      'BOCA RATON',
    ]);
    expect(q.get('conditions[1][value]')).toBe('FL');
    expect([q.get('conditions[2][property]'), q.get('conditions[2][operator]')]).toEqual([
      'penalty_date',
      '>=',
    ]);
    expect(q.get('conditions[2][value]')).toBe('2025-10-17');
    expect(q.get('limit')).toBe('1500');
    expect(q.get('sorts[1][property]')).toBe('record_number');
  });

  it('ranks scope and severity codes on the CMS grid', () => {
    expect(severityLevel('C')).toBe(1);
    expect(severityLevel('F')).toBe(2);
    expect(severityLevel('G')).toBe(3);
    expect(severityLevel('L')).toBe(4);
    expect(severityLevel('')).toBe(0);
    expect(severityWords('K')).toBe('K: pattern; immediate jeopardy to resident health or safety');
  });

  it('keeps health citations only, one per tag, and skips rows without a date', () => {
    const row = (tag: string, extra: Record<string, string> = {}) => ({
      cms_certification_number_ccn: '100001',
      provider_name: 'EXAMPLE CARE CENTER',
      survey_date: '2026-06-01',
      survey_type: 'Health',
      deficiency_prefix: 'F',
      deficiency_tag_number: tag,
      scope_severity_code: 'D',
      ...extra,
    });
    const out = inspections(
      [
        row('0880', { scope_severity_code: 'G', complaint_deficiency: 'Y' }),
        row('0880'),
        row('0689'),
        row('0001', { survey_type: 'Fire Safety' }),
        row('0002', { survey_date: '' }),
      ],
      new Map(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.citations.map((c) => c.tag)).toEqual(['F0880', 'F0689']);
    expect(out[0]!).toMatchObject({ worst: 'G', kinds: ['complaint'] });
  });

  it('costs one request in a town with no nursing home, and needs a city and state', async () => {
    const asked: string[] = [];
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n');
      asked.push(url);
      return Response.json({ results: [], count: 0 });
    };
    expect(
      await cmsAdapter.fetch(source('Pine Hollow'), null, {
        fetcher: fetcherFor(fetchImpl),
        now: NOW,
      }),
    ).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('/4pq5-n9py/0?');
    await expect(
      cmsAdapter.fetch({ ...source('Boca Raton'), config: { city: 'Boca Raton' } }, null, {
        fetcher: fetcherFor(fetchImpl),
        now: NOW,
      }),
    ).rejects.toThrow(/config.city and config.state/);
  });
});
