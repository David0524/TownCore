import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILES, flDbprAdapter, parseDbprRow } from '../src/fl-dbpr';
import { parseFoodRow } from '../src/fl-dbpr/food';
import { inspectionSeverity, parseInspectionRow } from '../src/fl-dbpr/inspections';
import { Fetcher, NotModified, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { isNewLiquorLicense, liquorRecord, parseLiquorRow } from '../src/fl-dbpr/liquor';
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

  it('skips a file it already read as NotModified, and reads one that may be newer', async () => {
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 });
      return new Response('', { headers: { 'last-modified': 'Thu, 01 Oct 2026 00:00:00 GMT' } });
    };
    const shared = ctx(fetchImpl);
    // Last run Oct. 10: the Oct. 1 files were read then.
    await expect(
      flDbprAdapter.fetch(source, new Date('2026-10-10T10:00:00Z'), shared),
    ).rejects.toBeInstanceOf(NotModified);
    // Last run within the 6-hour sharing window of that version: read again (dedupe keeps it).
    expect(await flDbprAdapter.fetch(source, new Date('2026-10-01T03:00:00Z'), shared)).toEqual([]);
  });

  it('downloads each statewide file once for every town and gives each town its own rows', async () => {
    const requests: string[] = [];
    const replay = replayFetch(fixture);
    const fetchImpl: FetchFn = async (url, init) => {
      if (!url.endsWith('robots.txt')) requests.push(url);
      return replay(url, init);
    };
    const shared = ctx(fetchImpl);
    const boca = await flDbprAdapter.fetch(source, null, shared);
    const jax = await flDbprAdapter.fetch(
      { ...source, id: 'dbpr-jax', townId: 'jax', config: { city: 'Jacksonville' } },
      null,
      shared,
    );
    expect(requests.sort()).toEqual(
      DEFAULT_FILES.map(
        (f) => `https://www2.myfloridalicense.com/sto/file_download/extracts/${f}`,
      ).sort(),
    );
    expect(boca.length).toBeGreaterThan(0);
    expect(jax.length).toBeGreaterThan(0);
    expect(boca.every((r) => /BOCA RATON/.test(r.text ?? ''))).toBe(true);
    expect(jax.every((r) => /JACKSONVILLE/.test(r.text ?? ''))).toBe(true);
  });

  it('asks the server again once the sharing window ends, with If-Modified-Since', async () => {
    let clock = 0;
    const seen: Array<string | null> = [];
    const fetchImpl: FetchFn = async (url, init) => {
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 });
      const since = new Headers(init?.headers).get('if-modified-since');
      seen.push(since);
      return since
        ? new Response(null, { status: 304 })
        : new Response('', { headers: { 'last-modified': 'Thu, 15 Oct 2026 10:48:12 GMT' } });
    };
    const fetcher = new Fetcher({
      fetchImpl,
      sleep: async () => {},
      now: () => clock,
      minIntervalMs: 0,
    });
    const shared = { fetcher, now: new Date() };
    const one = { ...source, config: { city: 'Boca Raton', files: ['lic08el.csv'] } };
    await flDbprAdapter.fetch(one, null, shared);
    await flDbprAdapter.fetch(one, null, shared); // within the window: no request
    clock = 7 * 3_600_000;
    await flDbprAdapter.fetch(one, null, shared); // window over: a conditional GET, 304
    expect(seen).toEqual([null, 'Thu, 15 Oct 2026 10:48:12 GMT']);
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

describe('fl-dbpr food service files', () => {
  const foodFixture = fileURLToPath(new URL('../fixtures/fl-dbpr/boca-food.json', import.meta.url));
  const food: SourceConfig = { ...source, config: { city: 'BOCA RATON', files: ['hrfood2.csv'] } };

  it('keeps Boca Raton locations, skips the header, and uses its own record type', async () => {
    const records = await flDbprAdapter.fetch(food, null, ctx(replayFetch(foodFixture)));
    expect(records).toHaveLength(40);
    for (const record of records) {
      expect(record.type).toBe('food_license');
      expect(record.externalId).toMatch(/^food:[A-Z0-9]{6,12}$/);
      expect((record.raw as { city: string }).city).toBe('BOCA RATON');
    }
    const bagels = records.find((r) => r.externalId === 'food:SEA6010779')!;
    expect(bagels.title).toBe('BAGEL CITY SOUTH');
    expect(bagels.text).toMatch(/^Permanent Food Service, seating, license SEA6010779\./);
    expect(bagels.text).toContain('Location: 6006 SW 18 ST, BOCA RATON, FL 33433-7188.');
    const kinds = new Set(records.map((r) => (r.raw as { occupation: string }).occupation));
    expect(kinds).toContain('Mobile Food Dispensing Vehicle');
    expect(kinds).toContain('Catering');
  });

  it('reads new establishments with their approval date', async () => {
    const newFixture = fileURLToPath(
      new URL('../fixtures/fl-dbpr/boca-newfood.json', import.meta.url),
    );
    const records = await flDbprAdapter.fetch(
      { ...source, config: { city: 'BOCA RATON', files: ['newfood.csv'] } },
      null,
      ctx(replayFetch(newFixture)),
    );
    expect(records).toHaveLength(20);
    const juici = records.find((r) => r.title === 'JUICI PATTIES')!;
    expect(juici).toMatchObject({ type: 'new_food_license', externalId: 'newfood:1795329' });
    expect(juici.occurredAt!.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(juici.text).toContain('Application approved 09/04/2026.');
    expect((juici.raw as { licenseNumber: string }).licenseNumber).toMatch(/^NOS\d+$/);
  });

  it('ignores the header row', () => {
    expect(parseFoodRow('"Board Code","License Type Code","Licensee Name"')).toBeNull();
  });
});

describe('fl-dbpr food service inspections', () => {
  // Trimmed from the live 2fdinspi.csv on 2026-10-16 (header, 30 other rows, 60 Boca rows).
  const inspections = fileURLToPath(
    new URL('../fixtures/fl-dbpr/boca-inspections.json', import.meta.url),
  );
  const src = {
    ...source,
    kind: 'inspections' as const,
    config: { city: 'BOCA RATON', files: ['2fdinspi.csv'] },
  };

  it('turns Boca inspection visits into records with what was cited', async () => {
    const records = await flDbprAdapter.fetch(src, null, ctx(replayFetch(inspections)));
    expect(records).toHaveLength(60);
    expect(new Set(records.map((r) => r.externalId)).size).toBe(60);
    for (const r of records) {
      expect(r.type).toBe('inspection');
      expect(r.externalId).toMatch(/^inspection:\d+$/);
      expect(r.occurredAt).toBeInstanceOf(Date);
      expect(r.url).toBe(
        'https://www2.myfloridalicense.com/sto/file_download/extracts/2fdinspi.csv',
      );
      expect(r.text).toMatch(/^Florida food service inspection \(.+\) on \d{2}\/\d{2}\/2026 at /);
      expect(r.text).toMatch(/Result: .+\. Violations cited: \d+ \(\d+ high priority/);
    }
    const serious = records.filter((r) => (r.raw as { severity: string }).severity !== 'ok');
    expect(serious.length).toBeGreaterThanOrEqual(25);
    const cited = records.find((r) => /Categories cited: /.test(r.text ?? ''))!;
    expect(cited.text).not.toMatch(/Category \d{2}/);
  });

  it('reads one row and rates outcomes', () => {
    const cells = [
      'D2',
      '50',
      'Palm Beach',
      '2010',
      '6012345',
      'TEST CAFE',
      '1 MAIN ST',
      'BOCA RATON',
      '33432',
      '9',
      '2',
      'Food',
      'Routine - Food',
      'Call Back - Complied',
      '10/01/2026',
      '',
      '',
      '3',
      '1',
      '1',
      '1',
      'Y',
    ];
    const counts = Array.from({ length: 58 }, (_, i) => (i === 2 ? '2' : i === 34 ? '1' : '0'));
    const row = parseInspectionRow(
      [...cells, ...counts, '111', '222'].map((c) => `"${c}"`).join(','),
    )!;
    expect(row).toMatchObject({
      business: 'TEST CAFE',
      visit: 2,
      total: 3,
      highPriority: 1,
      visitId: '222',
    });
    expect(row.violations).toEqual({ '03': 2, '35': 1 });
    expect(parseInspectionRow('"District","County Number"')).toBeNull();
    expect(inspectionSeverity('Emergency order recommended')).toBe('closure');
    expect(inspectionSeverity('Emergency Order Callback Complied')).toBe('ok');
    expect(inspectionSeverity('Emergency Order Callback Not Complied')).toBe('closure');
    expect(inspectionSeverity('Call Back - Admin. complaint recommended')).toBe('complaint');
    expect(inspectionSeverity('Administrative complaint recommended')).toBe('complaint');
    expect(inspectionSeverity('Warning Issued')).toBe('warning');
    expect(inspectionSeverity('Inspection Completed - No Further Action')).toBe('ok');
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

describe('fl-dbpr alcoholic beverage daily activity', () => {
  // Trimmed from the live daily.csv of 2026-10-17 (Oct. 15 activity): Palm Beach rows and others,
  // license holders who aren't companies replaced by "SAMPLE HOLDER".
  const liquor = fileURLToPath(new URL('../fixtures/fl-dbpr/boca-liquor.json', import.meta.url));

  it('keeps only new liquor licenses in the city, named by trade name', async () => {
    const records = await flDbprAdapter.fetch(
      { ...source, config: { city: 'BOCA RATON', files: ['daily.csv'] } },
      null,
      ctx(replayFetch(liquor)),
    );
    // Three Boca rows that day: a license print, a vape permit and one approval.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'liquor_license',
      title: 'MAISON BRUNCH',
      externalId: 'abt:6019425:1080:10/15/2026',
    });
    expect(records[0]!.text).toContain('License: 2COP (beer and wine served on site)');
    expect(records[0]!.text).toContain('Action: Application Approval, 10/15/2026');
    expect(records[0]!.occurredAt!.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(JSON.stringify(records[0]!.raw)).not.toContain('licenseeName');
  });

  it('never names a person: no trade name and no company means no record', () => {
    const row = parseLiquorRow(
      '"4006","Palm Beach","1","2COP","","","JANE DOE","1 MAIN ST","","","BOCA RATON","FL","33432","10/15/2026","1080","Application Approval",""',
    )!;
    expect(isNewLiquorLicense(row)).toBe(true);
    expect(liquorRecord(row, 'https://x')).toBeNull();
    expect(liquorRecord({ ...row, licenseeName: 'MAIN ST BISTRO LLC' }, 'https://x')!.title).toBe(
      'MAIN ST BISTRO LLC',
    );
    expect(isNewLiquorLicense({ ...row, activity: 'Approve Transfer Request' })).toBe(false);
  });
});
