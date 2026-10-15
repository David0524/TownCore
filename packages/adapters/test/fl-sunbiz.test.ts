import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dailyFileNames, flSunbizAdapter } from '../src/fl-sunbiz';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { DOCUMENTED_APIS } from '../src/http/policy';
import type { SourceConfig } from '../src/types';

// Trimmed from the live daily files for 10/13 and 10/14/2026.
const fixture = fileURLToPath(new URL('../fixtures/fl-sunbiz/boca.json', import.meta.url));
const source: SourceConfig = {
  id: 'sunbiz',
  townId: 't',
  kind: 'business_filings',
  platform: 'fl-sunbiz',
  url: null,
  config: { city: 'Boca Raton' },
};
const since = new Date('2026-10-13T00:00:00Z');
const now = new Date('2026-10-14T23:00:00Z');
const ctx = (fetchImpl: FetchFn = replayFetch(fixture)) => ({
  fetcher: new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 }),
  now,
});

describe('fl-sunbiz adapter', () => {
  it('returns new filings with a principal address in the town', async () => {
    const records = await flSunbizAdapter.fetch(source, since, ctx());
    expect(records.length).toBeGreaterThan(20);
    for (const record of records) {
      expect((record.raw as { city: string }).city).toBe('BOCA RATON');
      expect(record.externalId).toMatch(/^filing:[A-Z0-9]{6,12}$/);
      expect(record.type).toBe('new-filing');
      expect(record.text).toMatch(
        /document number [A-Z0-9]+, filed \d{2}\/\d{2}\/\d{4}\. Principal address: .*BOCA RATON, (FL )?\d{5}/,
      );
    }
    const llc = records.find((r) => (r.raw as { filingType: string }).filingType === 'FLAL')!;
    expect(llc.text).toMatch(/^Florida limited liability company/);
  });

  it('keeps officer names out of the text (they stay in raw only)', async () => {
    const records = await flSunbizAdapter.fetch(source, since, ctx());
    for (const record of records) {
      const officers = (record.raw as { officers: Array<{ name: string }> }).officers;
      for (const officer of officers) expect(record.text).not.toContain(officer.name);
    }
    expect(records.some((r) => (r.raw as { officers: unknown[] }).officers.length > 0)).toBe(true);
  });

  it('sends the published public login and skips missing days (weekends, holidays)', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl: FetchFn = async (url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response('', { status: 404 });
    };
    expect(await flSunbizAdapter.fetch(source, since, ctx(fetchImpl))).toEqual([]);
    expect(seen.map((s) => s.url.split('/').pop())).toEqual(['20261013c.txt', '20261014c.txt']);
    expect(seen.every((s) => s.auth?.startsWith('Basic '))).toBe(true);
  });

  it('is on the documented-API allowlist with its terms URL', () => {
    expect(DOCUMENTED_APIS['sftp.floridados.gov']?.terms).toBe(
      'https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/',
    );
  });
});

describe('dailyFileNames', () => {
  it('covers the days since the last run, oldest first', () => {
    expect(
      dailyFileNames(new Date('2026-10-12T15:00:00Z'), new Date('2026-10-14T01:00:00Z')),
    ).toEqual(['20261012c.txt', '20261013c.txt', '20261014c.txt']);
  });

  it('looks back a week on the first run and caps long gaps at 14 days', () => {
    expect(dailyFileNames(null, new Date('2026-10-14T00:00:00Z'))).toHaveLength(8);
    const long = dailyFileNames(new Date('2026-08-01T00:00:00Z'), new Date('2026-10-14T00:00:00Z'));
    expect(long).toHaveLength(14);
    expect(long.at(-1)).toBe('20261014c.txt');
  });
});
