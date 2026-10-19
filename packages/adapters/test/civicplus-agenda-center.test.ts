import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { civicplusAdapter } from '../src/civicplus';
import {
  agendaCenterCategories,
  agendaCenterRows,
  agendaSearchUrl,
  meetingTitle,
  titleTime,
} from '../src/civicplus/agenda-center';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live on 2026-10-19 through the Fetcher (robots.txt allows /AgendaCenter on both):
// Hollywood, FL (every board; agendas, no minutes in the window) and Hialeah, FL (Planning and
// Zoning Board; agendas and minutes). Boca Raton's Agenda Center is an empty module (its
// agendas are on Granicus, which robots.txt puts off-limits), so it has no fixture.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/civicplus/${name}.json`, import.meta.url));
const NOW = new Date('2026-10-19T12:00:00Z');
const ctx = (name: string, now = NOW) => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture(name)),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now,
});
const hollywood: SourceConfig = {
  id: 'hw',
  townId: 't',
  kind: 'agenda',
  platform: 'civicplus',
  url: 'https://www.hollywoodfl.org/',
  config: { module: 'agenda-center', catId: 'all', timezone: 'America/New_York' },
};
const hialeah: SourceConfig = {
  ...hollywood,
  id: 'hia',
  url: 'https://www.hialeahfl.gov/',
  config: { module: 'agenda-center', catId: '3' },
};

/** The recorded body of one URL in a fixture. */
function recorded(name: string, url: string): string {
  const data = JSON.parse(readFileSync(fixture(name), 'utf8')) as {
    exchanges: Array<{ url: string; body?: string }>;
  };
  return data.exchanges.find((e) => e.url === url)!.body!;
}

describe('civicplus agenda-center', () => {
  it('searches a date window around now, in the town time zone', () => {
    expect(
      agendaSearchUrl(
        'https://www.hollywoodfl.org',
        { catId: 'all', timezone: 'America/New_York', meetings: true },
        NOW,
      ),
    ).toBe(
      'https://www.hollywoodfl.org/AgendaCenter/Search/?term=&CIDs=all&startDate=09/04/2026&endDate=12/18/2026&dateRange=&dateSelector=',
    );
  });

  it('reads the rows of every board with dates, posted times and file links', () => {
    const url = agendaSearchUrl(
      'https://www.hollywoodfl.org',
      { catId: 'all', timezone: 'America/New_York', meetings: true },
      NOW,
    );
    const html = recorded('hollywood-agenda-center', url);
    const rows = agendaCenterRows(html, 'https://www.hollywoodfl.org', 'America/New_York');
    expect(rows.length).toBe(9);
    const row = rows.find((r) => r.id === '867')!;
    expect(row).toMatchObject({
      key: '10142026-867',
      category: 'Code Compliance Special Magistrate',
      title: 'SPECIAL MAGISTRATE AGENDA OCTOBER 14, 2026',
      year: 2026,
      month: 10,
      day: 14,
      agendaUrl: 'https://www.hollywoodfl.org/AgendaCenter/ViewFile/Agenda/_10142026-867',
      minutesUrl: null,
    });
    // "Posted Oct 1, 2026 7:41 AM" Eastern.
    expect(row.posted?.toISOString()).toBe('2026-10-01T11:41:00.000Z');
    expect(agendaCenterCategories(html).map((c) => c.name)).toContain(
      'Planning and Development Board',
    );
  });

  it('names meetings without the dates and times around them', () => {
    expect(
      meetingTitle(
        'SCHOOL ZONE SAFETY CAMERA PROGRAM SPECIAL MAGISTRATE AGENDA OCTOBER 27, 2026 AT 1 PM',
        'Code Compliance Special Magistrate',
      ),
    ).toBe('School Zone Safety Camera Program Special Magistrate');
    expect(meetingTitle('Charter Review Committee Meeting 3/26/2024', 'Charter Review')).toBe(
      'Charter Review Committee Meeting',
    );
    expect(meetingTitle('Planning and Zoning Board Special Land Use (PDF)', 'P&Z')).toBe(
      'Planning and Zoning Board Special Land Use',
    );
    expect(meetingTitle('AGENDA', 'City Council')).toBe('City Council');
    expect(titleTime('… OCTOBER 27, 2026 AT 1 PM')).toEqual({ hour: 13, minute: 0 });
    expect(titleTime('Workshop 6:30 p.m.')).toEqual({ hour: 18, minute: 30 });
    expect(titleTime('Regular Meeting')).toBeNull();
  });

  it('turns rows into meetings and upcoming agendas with their PDF text', async () => {
    const records = await civicplusAdapter.fetch(hollywood, null, ctx('hollywood-agenda-center'));
    const meetings = records.filter((r) => r.type === 'meeting');
    const agendas = records.filter((r) => r.type === 'agenda');
    expect(meetings).toHaveLength(9);
    // Agendas of meetings from a week ago on; older ones aren't read on a first run.
    expect(agendas.map((r) => r.externalId).sort()).toEqual([
      'agenda:867',
      'agenda:868',
      'agenda:869',
      'agenda:870',
    ]);
    const timed = meetings.find((r) => r.externalId === 'meeting:870')!;
    expect(timed).toMatchObject({
      title: 'School Zone Safety Camera Program Special Magistrate',
      text: 'When: Tuesday, October 27, 2026, 1:00 PM\nBody: Code Compliance Special Magistrate',
      url: 'https://www.hollywoodfl.org/AgendaCenter/ViewFile/Agenda/_10272026-870',
    });
    expect(timed.occurredAt?.toISOString()).toBe('2026-10-27T17:00:00.000Z');
    // No time in the title: the date at local noon, and no time in "When".
    const dated = meetings.find((r) => r.externalId === 'meeting:868')!;
    expect(dated.occurredAt?.toISOString()).toBe('2026-10-28T16:00:00.000Z');
    expect(dated.text).toMatch(/^When: Wednesday, October 28, 2026\n/);
    const agenda = agendas.find((r) => r.externalId === 'agenda:867')!;
    expect(agenda.title).toBe('Agenda: Special Magistrate');
    expect(agenda.text).toMatch(/NOTICE OF HEARING/);
    expect(agenda.text).toMatch(/2600 Hollywood Blvd/);
  });

  it('reads minutes of recent meetings as minutes records, for recaps', async () => {
    const records = await civicplusAdapter.fetch(hialeah, null, ctx('hialeah-planning-zoning'));
    const minutes = records.filter((r) => r.type === 'minutes');
    expect(minutes.map((r) => r.externalId)).toEqual(['minutes:1405', 'minutes:1392']);
    expect(minutes[0]).toMatchObject({
      title: 'Minutes: Planning and Zoning Board Special Land Use',
      url: 'https://www.hialeahfl.gov/AgendaCenter/ViewFile/Minutes/_09232026-1405',
    });
    expect(minutes[0]!.text).toMatch(
      /^When: Wednesday, September 23, 2026\nBody: Planning & Zoning/,
    );
    expect(minutes[0]!.text).toMatch(/called the meeting to order/);
    // Same ID as the meeting, so the finder can pair them.
    expect(records.some((r) => r.externalId === 'meeting:1405')).toBe(true);
  });

  it('reads only agendas posted since the last run, and leaves meetings to the calendar when asked', async () => {
    const since = new Date('2026-10-14T00:00:00Z');
    const records = await civicplusAdapter.fetch(
      { ...hollywood, config: { ...hollywood.config, meetings: 'false' } },
      since,
      ctx('hollywood-agenda-center'),
    );
    expect(records.some((r) => r.type === 'meeting')).toBe(false);
    // 869, 870 and 868 were posted Oct. 13 or later; 867 on Oct. 1.
    expect(records.map((r) => r.externalId).sort()).toEqual([
      'agenda:868',
      'agenda:869',
      'agenda:870',
    ]);
  });

  it('health-checks the search page', async () => {
    expect(await civicplusAdapter.healthCheck(hollywood, ctx('hollywood-agenda-center'))).toEqual({
      ok: true,
    });
  });
});

describe('civicplus propose: Agenda Center', () => {
  const searchUrl =
    'https://www.hollywoodfl.org/AgendaCenter/Search/?term=&CIDs=all&startDate=09/04/2026&endDate=12/18/2026&dateRange=&dateSelector=';
  const calendarWith = (names: Array<[string, string]>) =>
    `<html><body>${names
      .map(([id, name]) => `<label for="chkCalendarID_${id}">${name}</label>`)
      .join('')}</body></html>`;
  const site =
    (calendar: string, search: string): FetchFn =>
    async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /admin\n');
      if (url.endsWith('/Calendar.aspx')) return new Response(calendar);
      if (url === searchUrl) return new Response(search);
      return new Response('not found', { status: 404 });
    };
  const proposeWith = (fetchImpl: FetchFn) =>
    civicplusAdapter.propose!('https://www.hollywoodfl.org/AgendaCenter', '', 'agenda', {
      fetcher: new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 }),
      now: NOW,
    });
  const search = () => recorded('hollywood-agenda-center', searchUrl);

  it('detects an Agenda Center page', async () => {
    expect(
      await civicplusAdapter.detect(
        'https://www.hollywoodfl.org/AgendaCenter',
        '<a href="/AgendaCenter/ViewFile/Agenda/_10142026-867">Agenda</a>',
      ),
    ).toBeGreaterThan(0);
  });

  it('proposes the Agenda Center when it lists meetings', async () => {
    const proposals = await proposeWith(site(calendarWith([['5', 'Parks']]), search()));
    expect(proposals).toEqual([
      expect.objectContaining({
        kind: 'agenda',
        url: 'https://www.hollywoodfl.org/',
        options: { module: 'agenda-center', catId: 'all' },
      }),
    ]);
  });

  it('leaves meetings to a meetings calendar when there is one', async () => {
    const proposals = await proposeWith(site(calendarWith([['29', 'City Commission']]), search()));
    expect(proposals.map((p) => p.options)).toEqual([
      { module: 'calendar', catId: '29' },
      { module: 'agenda-center', catId: 'all', meetings: 'false' },
    ]);
  });

  it('skips an empty Agenda Center (a module the city never used)', async () => {
    const empty = '<html><body><div class="agendaCenterContent">Agenda Center</div></body></html>';
    const proposals = await proposeWith(site(calendarWith([['29', 'City Council']]), empty));
    expect(proposals.map((p) => p.options?.module)).toEqual(['calendar']);
  });
});
