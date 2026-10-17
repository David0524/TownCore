import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { findPdfLink, issueDate, parseEntries, pdfListAdapter } from '../src/pdf-list';
import type { SourceConfig } from '../src/types';

// Recorded live from discover.pbc.gov (robots.txt allows the page and the PDF) on 2026-10-17.
const fixture = fileURLToPath(new URL('../fixtures/pdf-list/pbc-roads.json', import.meta.url));
const ctx = () => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now: new Date('2026-10-17T03:00:00Z'),
});
const source: SourceConfig = {
  id: 'roads',
  townId: 't',
  kind: 'roads',
  platform: 'pdf-list',
  url: 'https://discover.pbc.gov/Pages/Roads.aspx',
  config: {
    link: 'Road and Bridge Construction List',
    match: '(City of Boca Raton)',
    type: 'road-work',
  },
};

describe('pdf-list adapter: a county road construction list', () => {
  it("keeps only this town's projects, keyed by issue and project", async () => {
    const records = await pdfListAdapter.fetch(source, null, ctx());
    expect(records.length).toBe(10);
    for (const r of records) {
      expect(r.type).toBe('road-work');
      expect(r.url).toMatch(/\.pdf/i);
      expect(r.externalId).toMatch(/^\d{4}-\d{2}-\d{2}:[0-9a-f]{16}$/);
      expect(r.title).not.toMatch(/City of|District/);
      expect(r.text).toMatch(/Location: .*\(City of Boca Raton\)/);
      const raw = r.raw as Record<string, string>;
      expect(raw.from).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
      expect(raw.to).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    }
    expect(new Set(records.map((r) => r.externalId)).size).toBe(records.length);
    // Entries 79 and 161 are one project: one record, with both restrictions.
    const twice = records.find((r) => r.title === 'N. Military Trail at N.W. 19th Street')!;
    expect(twice.text).toMatch(/right lane closure.*southbound left turn/s);
  });

  it('is healthy when the index page links the list', async () => {
    expect(await pdfListAdapter.healthCheck(source, ctx())).toEqual({ ok: true });
  });
});

describe('pdf-list parsing', () => {
  it('finds the newest matching PDF link, ignoring other PDFs', () => {
    const html =
      '<a href="/docs/Other.pdf">Bridge map</a>' +
      '<a href="/docs/Road-and-Bridge-Construction-List.pdf">This week</a>' +
      '<a href="/docs/old/Road-and-Bridge-Construction-List.pdf">Last week</a>';
    expect(
      findPdfLink(
        html,
        'https://discover.pbc.gov/Pages/Roads.aspx',
        'Road and Bridge Construction List',
      ),
    ).toBe('https://discover.pbc.gov/docs/Road-and-Bridge-Construction-List.pdf');
    expect(findPdfLink('<a href="/x.pdf">x</a>', 'https://a.gov/', 'Road')).toBeNull();
  });

  it('splits numbered entries, continues wrapped lines and drops page footers', () => {
    const text = [
      'DATE OF ISSUE: October 16, 2026',
      '*** ROADWAY ***',
      '1. LOCATION: Military Trl. and Clint Moore Rd.',
      '(City of Boca Raton)',
      'DESCRIPTION: Turn lane',
      'Page 1 of 40',
      'construction.',
      'RESTRICTION: Lane closures 9 a.m. to 3 p.m.',
      '2. LOCATION: Lyons Rd. (Unincorporated)',
      'DESCRIPTION: Resurfacing.',
    ].join('\n');
    const entries = parseEntries(text, ['LOCATION', 'DESCRIPTION', 'RESTRICTION']);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      number: 1,
      section: 'ROADWAY',
      parts: {
        LOCATION: 'Military Trl. and Clint Moore Rd. (City of Boca Raton)',
        DESCRIPTION: 'Turn lane construction.',
        RESTRICTION: 'Lane closures 9 a.m. to 3 p.m.',
      },
    });
    expect(issueDate(text, 'DATE OF ISSUE')?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });
});
