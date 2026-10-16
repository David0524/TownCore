import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { escribeAdapter, escribeDate } from '../src/escribe';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from pub-cityofgainesville.escribemeetings.com (robots.txt disallows only
// PetalBot) on 2026-10-16: the calendar from Sept. 25 to Oct. 30, 2026.
const fixture = fileURLToPath(new URL('../fixtures/escribe/gainesville.json', import.meta.url));
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const source: SourceConfig = {
  id: 'gnv',
  townId: 't',
  kind: 'agenda',
  platform: 'escribe',
  url: 'https://pub-cityofgainesville.escribemeetings.com/',
  config: { days: 21, ahead: 14 },
};
const ctx = (fetchImpl: FetchFn = replayFetch(fixture)) => ({
  fetcher: fetcherFor(fetchImpl),
  now: new Date('2026-10-16T22:00:00Z'),
});

describe('escribe adapter', () => {
  it('turns calendar meetings into meeting records with local times and documents', async () => {
    const records = await escribeAdapter.fetch(source, null, ctx());
    const meetings = records.filter((r) => r.type === 'meeting');
    expect(meetings.length).toBeGreaterThan(5);
    for (const m of meetings) {
      expect(m.externalId).toMatch(/^meeting:[0-9a-f-]{36}$/);
      expect(m.url).toMatch(
        /^https:\/\/pub-cityofgainesville\.escribemeetings\.com\/Meeting\.aspx\?Id=[0-9a-f-]{36}&Agenda=Agenda&lang=English$/,
      );
      expect(m.text).toMatch(/^When: \w+day, \w+ \d+, 2026/);
      expect(m.occurredAt).toBeInstanceOf(Date);
    }
    for (const r of records.filter((x) => x.type === 'minutes')) {
      expect(r.url).toMatch(/FileStream\.ashx\?DocumentId=\d+$/i);
    }
  });

  it('asks the calendar by POST for the window around now, and filters by name', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl: FetchFn = async (url, init) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: PetalBot\nDisallow: /\n');
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          d: [
            { ID: 'a', MeetingName: 'City Commission', StartDate: '2026/10/20 13:00:00' },
            { ID: 'b', MeetingName: 'Tree Advisory Board', StartDate: '2026/10/21 17:30:00' },
          ],
        }),
      );
    };
    const records = await escribeAdapter.fetch(
      { ...source, config: { match: 'commission', days: 7, ahead: 7 } },
      null,
      ctx(fetchImpl),
    );
    expect(calls[0]).toEqual({
      url: 'https://pub-cityofgainesville.escribemeetings.com/MeetingsCalendarView.aspx/GetCalendarMeetings',
      body: { calendarStartDate: '2026-10-09', calendarEndDate: '2026-10-23' },
    });
    expect(records.map((r) => r.title)).toEqual(['City Commission']);
    expect(records[0]!.occurredAt!.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('refuses a robots-disallowed portal and a non-portal URL', async () => {
    const blocked: FetchFn = async (url) =>
      url.endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /\n')
        : new Response('{"d":[]}');
    await expect(escribeAdapter.fetch(source, null, ctx(blocked))).rejects.toThrow(/robots/);
    await expect(
      escribeAdapter.fetch({ ...source, url: 'https://example.com/' }, null, ctx()),
    ).rejects.toThrow(/escribemeetings/);
    expect(escribeDate('2026/01/05 09:30:00', 'America/New_York')?.toISOString()).toBe(
      '2026-01-05T14:30:00.000Z',
    );
  });
});
