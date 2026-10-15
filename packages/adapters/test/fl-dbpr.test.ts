import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILES, flDbprAdapter, parseDbprRow } from '../src/fl-dbpr';
import { Fetcher, NotModified, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { parseCsvLine, streamLines } from '../src/lib/csv';
import type { SourceConfig } from '../src/types';

// Trimmed from the live DBPR files on 2026-10-15 (first 40 statewide rows + up to 60 Boca rows).
const fixture = fileURLToPath(new URL('../fixtures/fl-dbpr/boca.json', import.meta.url));
const source: SourceConfig = {
  id: 'dbpr',
  townId: 't',
  kind: 'business_filings',
  platform: 'fl-dbpr',
  url: null,
  config: { city: 'Boca Raton' },
};
const ctx = (fetchImpl: FetchFn = replayFetch(fixture)) => ({
  fetcher: new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 }),
  now: new Date(),
});

describe('fl-dbpr adapter', () => {
  it('keeps only licensees in the town, with labeled occupations', async () => {
    const records = await flDbprAdapter.fetch(source, null, ctx());
    expect(records.length).toBeGreaterThan(50);
    // Every matched row is kept: IDs are unique even when rows share a license number.
    expect(new Set(records.map((r) => r.externalId)).size).toBe(records.length);
    for (const record of records) {
      expect((record.raw as { city: string }).city).toBe('BOCA RATON');
      expect(record.type).toBe('license');
      expect(record.externalId).toMatch(/^license:[A-Z]{2,4}\d+:[A-Z0-9]{2,4}:[0-9a-f]{12}$/);
    }
    const contractor = records.find((r) => r.externalId.startsWith('license:CBC033099:'))!;
    expect(contractor.text).toMatch(
      /^Certified Building Contractor, license CBC033099 \(Current, Inactive\)\./,
    );
    expect(contractor.text).toContain('170 NE 2ND STREET #111, BOCA RATON, FL 33432');
    expect(contractor.occurredAt!.toISOString()).toBe('1985-03-07T00:00:00.000Z');
    const electrician = records.find((r) => (r.raw as { board: string }).board === '08');
    expect(electrician?.text).toMatch(/Electrical|Alarm|Specialty/);
  });

  it('sends If-Modified-Since and reports an unchanged week as NotModified', async () => {
    const seen: Array<string | null> = [];
    const fetchImpl: FetchFn = async (url, init) => {
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 });
      seen.push(new Headers(init?.headers).get('if-modified-since'));
      return new Response(null, { status: 304 });
    };
    const since = new Date('2026-10-10T10:00:00Z');
    await expect(flDbprAdapter.fetch(source, since, ctx(fetchImpl))).rejects.toBeInstanceOf(
      NotModified,
    );
    expect(seen).toEqual(DEFAULT_FILES.map(() => since.toUTCString()));
  });

  it('requires a city', async () => {
    await expect(flDbprAdapter.fetch({ ...source, config: {} }, null, ctx())).rejects.toThrow(
      /city/,
    );
  });

  it('rejects rows that are not the standard layout', () => {
    expect(
      parseDbprRow(
        '"2502 Real Estate Corporation","PENN FLORIDA REALTY CORP","","CQ RE Corp.","1515 N FEDERAL HWY 306","","","BOCA RATON","FL","33432","Palm Beach","251537","Current","Active","","03-APR-23","31-MAR-27","CQ251537","","",""',
      ),
    ).toBeNull();
  });
});

describe('csv', () => {
  it('parses quoted fields with commas and doubled quotes', () => {
    expect(parseCsvLine('"a","b, c","say ""hi""",""')).toEqual(['a', 'b, c', 'say "hi"', '']);
  });

  it('streams lines across chunk boundaries', async () => {
    const chunks = ['"a","b"\r\n"c', '","d"\n"e","f"'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of streamLines(body)) lines.push(line);
    expect(lines).toEqual(['"a","b"', '"c","d"', '"e","f"']);
  });
});
