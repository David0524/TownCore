import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { fillTemplate, rowText } from '../src/lib/rows';
import { parseDatasetUrl, socrataAdapter, socrataDate } from '../src/socrata';
import type { SourceConfig } from '../src/types';

// Recorded live from data.cityoforlando.net (SODA API; robots.txt leaves /resource/ open,
// Crawl-delay 1) on 2026-10-16: building permits issued Sept. 22–23, 2026.
const fixture = fileURLToPath(new URL('../fixtures/socrata/orlando-permits.json', import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const source: SourceConfig = {
  id: 'orl',
  townId: 't',
  kind: 'permits',
  platform: 'socrata',
  url: 'https://data.cityoforlando.net/resource/ryhf-m453.json',
  config: {
    dateField: 'issue_permit_date',
    idField: 'permit_number',
    title: '{application_type}: {worktype} at {permit_address}',
    fields: {
      permit_number: 'Permit',
      application_type: 'Type',
      worktype: 'Work',
      permit_address: 'Address',
      project_name: 'Project',
      estimated_cost: 'Estimated cost',
      contractor_name: 'Contractor',
      application_status: 'Status',
      issue_permit_date: 'Issued',
      neighborhood: 'Neighborhood',
    },
  },
};

describe('socrata adapter', () => {
  it('turns new permit rows into records with the field map, never owner names', async () => {
    const records = await socrataAdapter.fetch(source, new Date('2026-09-22T04:00:00Z'), {
      fetcher: fetcherFor(replayFetch(fixture)),
      now: new Date('2026-09-24T12:00:00Z'),
    });
    expect(records).toHaveLength(166);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(166);
    for (const r of records) {
      expect(r.type).toBe('permit');
      expect(r.externalId).toMatch(/^row:[A-Z]{3}\d{4}-\d+/);
      expect(r.title).toMatch(/^[\w ]+(: .+)? at .+/);
      expect(r.text).toMatch(/^Permit: [A-Z]{3}\d{4}-\d+\nType: /);
      expect(r.text).not.toMatch(/owner/i);
      expect(r.url).toBe('https://data.cityoforlando.net/d/ryhf-m453');
      expect(r.occurredAt!.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-09-22T04:00:00Z'));
    }
  });

  it('asks for rows newer than the last run, newest first, with the extra filter', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nCrawl-delay: 1\n');
      urls.push(url);
      return new Response('[]');
    };
    await socrataAdapter.fetch(
      { ...source, config: { ...source.config, where: "neighborhood = 'Lake Eola Heights'" } },
      new Date('2026-10-01T04:00:00Z'),
      { fetcher: fetcherFor(fetchImpl), now: new Date('2026-10-02T00:00:00Z') },
    );
    const q = new URL(urls[0]!).searchParams;
    expect(q.get('$select')).toBe('*, :id');
    expect(q.get('$where')).toBe(
      "(issue_permit_date > '2026-10-01T00:00:00') AND (neighborhood = 'Lake Eola Heights')",
    );
    expect(q.get('$order')).toBe('issue_permit_date DESC');
  });

  it('refuses a source without a dataset URL or date column', async () => {
    const ctx = { fetcher: fetcherFor(async () => new Response('[]')), now: new Date() };
    await expect(
      socrataAdapter.fetch({ ...source, url: 'https://x.test/' }, null, ctx),
    ).rejects.toThrow(/needs url/);
    await expect(socrataAdapter.fetch({ ...source, config: {} }, null, ctx)).rejects.toThrow(
      /dateField/,
    );
    await expect(
      socrataAdapter.fetch({ ...source, config: { dateField: "x'; drop" } }, null, ctx),
    ).rejects.toThrow(/dateField/);
  });

  it('parses dataset URLs and floating timestamps, and fills templates', () => {
    expect(parseDatasetUrl('https://data.cityofchicago.org/resource/4ijn-s7e5.json')).toEqual({
      domain: 'data.cityofchicago.org',
      dataset: '4ijn-s7e5',
    });
    expect(parseDatasetUrl('https://data.sf.gov/d/i98e-djp9')?.dataset).toBe('i98e-djp9');
    expect(socrataDate('2026-10-15T13:30:00.000', 'America/New_York')?.toISOString()).toBe(
      '2026-10-15T17:30:00.000Z',
    );
    expect(socrataDate('2026-10-15', 'America/Chicago')?.toISOString()).toBe(
      '2026-10-15T05:00:00.000Z',
    );
    expect(fillTemplate('{a}: {b} at {c}', { a: 'Roof', c: '1 Main St' })).toBe(
      'Roof at 1 Main St',
    );
    expect(rowText({ a: 'x', b: '', c: 3, d: { nested: true } }, null)).toBe('a: x\nc: 3');
    expect(rowText({ a: 'x', b: 'y' }, { b: 'Bee' })).toBe('Bee: y');
  });
});
