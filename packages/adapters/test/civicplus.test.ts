import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { civicplusAdapter, newsBodyText, newsItemId, newsListItems } from '../src/civicplus';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { parseIcal, zonedTimeToUtc } from '../src/lib/ical';
import type { SourceConfig } from '../src/types';

// Recorded live from www.myboca.us (CivicPlus CivicEngage) on 2026-10-15.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/civicplus/${name}.json`, import.meta.url));
const ctx = (name: string, now = new Date('2026-10-15T16:00:00Z')) => ({
  fetcher: new Fetcher({
    fetchImpl: replayFetch(fixture(name)),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  }),
  now,
});
const calendar: SourceConfig = {
  id: 'cal',
  townId: 't',
  kind: 'agenda',
  platform: 'civicplus',
  url: 'https://www.myboca.us/',
  config: { module: 'calendar', catId: '29', timezone: 'America/New_York' },
};
const news: SourceConfig = {
  ...calendar,
  id: 'news',
  kind: 'city_news',
  config: { module: 'newsflash', catId: 'All-newsflash.xml' },
};

describe('civicplus calendar (iCalendar export)', () => {
  it('turns council and public meetings into meeting records with local times', async () => {
    const records = await civicplusAdapter.fetch(calendar, null, ctx('boca-council-calendar'));
    expect(records.length).toBeGreaterThan(10);
    const meeting = records.find((r) => /City Council/i.test(r.title ?? ''))!;
    expect(meeting).toBeDefined();
    expect(meeting.type).toBe('meeting');
    expect(meeting.externalId).toMatch(/^event:\d+$/);
    expect(meeting.url).toMatch(/^https:\/\/www\.myboca\.us\/calendar\.aspx\?EID=\d+$/i);
    expect(meeting.text).toMatch(/^When: \w+day, \w+ \d+, \d{4}/);
  });

  it('drops events more than 30 days in the past', async () => {
    const records = await civicplusAdapter.fetch(
      calendar,
      null,
      ctx('boca-council-calendar', new Date('2027-12-31T00:00:00Z')),
    );
    for (const record of records) {
      expect(record.occurredAt!.getTime()).toBeGreaterThanOrEqual(
        new Date('2027-12-01T00:00:00Z').getTime(),
      );
    }
  });
});

describe('civicplus News Flash (RSS + release pages)', () => {
  it('stores city releases with their full text from the release page', async () => {
    const records = await civicplusAdapter.fetch(news, null, ctx('boca-newsflash'));
    const releases = records.filter((r) => r.type === 'release');
    expect(releases.length).toBeGreaterThan(3);
    const mobility = releases.find((r) => /Mobility Workshop/.test(r.title ?? ''))!;
    expect(mobility.externalId).toBe('news:2049');
    expect(mobility.url).toBe('https://www.myboca.us/m/newsflash/home/detail/2049');
    expect(mobility.text).toMatch(/Mobility Workshop/);
    expect(mobility.text!.length).toBeGreaterThan(200);
  });

  it('keeps items that link off News Flash as headline + link, without fetching them', async () => {
    const records = await civicplusAdapter.fetch(news, null, ctx('boca-newsflash'));
    const links = records.filter((r) => r.type === 'release-link');
    expect(links.map((r) => r.title)).toContain(
      'Boca Brief: City Council Meeting Recap for September 22, 2026',
    );
    expect(links.every((r) => r.text === null && r.externalId.startsWith('link:'))).toBe(true);
  });

  it('only fetches release pages for items newer than the last run', async () => {
    const records = await civicplusAdapter.fetch(
      news,
      new Date('2026-10-14T00:00:00Z'),
      ctx('boca-newsflash'),
    );
    expect(records.map((r) => r.externalId)).toEqual(['news:2049']);
  });
});

describe('civicplus News Flash list page (one category)', () => {
  // Recorded live on 2026-10-17: Boca Raton's Police News Releases (category 17), whose releases
  // never reach the RSS feeds; each release page links the release as a PDF.
  const police: SourceConfig = {
    ...calendar,
    id: 'police',
    kind: 'police',
    config: { module: 'newsflash-list', catId: '17' },
  };

  it('reads new releases from the list page, with each release PDF’s text', async () => {
    const records = await civicplusAdapter.fetch(
      police,
      new Date('2026-09-01T00:00:00Z'),
      ctx('boca-police-list', new Date('2026-10-17T12:00:00Z')),
    );
    expect(records.map((r) => r.externalId)).toEqual(['news:2030', 'news:2021']);
    const [first] = records;
    expect(first).toMatchObject({
      type: 'release',
      title: 'Boca Raton Police seek additional victims following human trafficking arrest',
      url: 'https://www.myboca.us/m/newsflash/home/detail/2030',
    });
    expect(first!.occurredAt!.toISOString()).toBe('2026-09-22T12:00:00.000Z');
    expect(first!.text).toContain('Boca Raton Police Services Department');
    expect(first!.text).not.toMatch(/^Read release$/m);
  });

  it('lists every release on the page with its date and documents', async () => {
    const { readFileSync } = await import('node:fs');
    const file = JSON.parse(readFileSync(fixture('boca-police-list'), 'utf8')) as {
      exchanges: { url: string; body?: string }[];
    };
    const html = file.exchanges.find((e) => e.url.endsWith('/m/newsflash?cat=17'))!.body!;
    const items = newsListItems(html, '17');
    expect(items).toHaveLength(55);
    expect(items[0]).toMatchObject({ id: '2030', documents: ['/DocumentCenter/View/44921'] });
    expect(items.every((i) => i.posted instanceof Date)).toBe(true);
  });
});

describe('helpers', () => {
  it('reads release IDs from both link styles', () => {
    expect(newsItemId('https://www.myboca.us/CivicAlerts.aspx?aid=2049')).toBe('2049');
    expect(newsItemId('https://www.myboca.us/m/newsflash/home/detail/2049')).toBe('2049');
    expect(newsItemId('https://myemail.constantcontact.com/x.html?soid=1&aid=NtfU5W')).toBeNull();
  });

  it('extracts release body text', () => {
    const html =
      '<div class="fr-view"><p>First   line.</p><p>Second<br>line</p><script>x()</script></div>';
    expect(newsBodyText(html)).toBe('First line.\nSecond\nline');
    expect(newsBodyText('<div>nothing</div>')).toBeNull();
  });

  it('parses iCalendar with folded lines, escapes and TZID times', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:42',
      'SUMMARY:City Council\\, Regular Meeting',
      'DTSTART;TZID=America/New_York:20261027T180000',
      'LOCATION:City Hall - 201 W Palmetto Park Roa',
      ' d',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [event] = parseIcal(ics, 'America/New_York');
    expect(event).toMatchObject({
      uid: '42',
      summary: 'City Council, Regular Meeting',
      location: 'City Hall - 201 W Palmetto Park Road',
    });
    expect(event!.start!.toISOString()).toBe('2026-10-27T22:00:00.000Z'); // 6pm EDT
  });

  it('converts wall-clock times across DST', () => {
    expect(zonedTimeToUtc(2026, 1, 13, 18, 0, 0, 'America/New_York').toISOString()).toBe(
      '2026-01-13T23:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 7, 14, 18, 0, 0, 'America/New_York').toISOString()).toBe(
      '2026-07-14T22:00:00.000Z',
    );
  });

  it('detects CivicPlus sites', async () => {
    expect(await civicplusAdapter.detect('https://fl-bocaraton.civicplus.com/', '')).toBe(1);
    expect(
      await civicplusAdapter.detect(
        'https://www.myboca.us/',
        '<title>Site Map • Boca Raton, FL • CivicEngage</title>',
      ),
    ).toBe(0.9);
    expect(await civicplusAdapter.detect('https://example.com/', '<html></html>')).toBe(0);
  });
});

describe('civicplus discovery (launcher, M7)', () => {
  // An excerpt of www.myboca.us/Calendar.aspx as served on 2026-10-16: one label per calendar.
  const label = (id: string, name: string) => `<li>
  <label for="chkCalendarID_${id}">
		<input type="checkbox" id="chkCalendarID_${id}" name="chkCalendarID" title="CalendarID" value="${id}" checked="checked">
${name}
	  </label>
	</li>`;
  const page = [
    label('48', "Children's Science Explorium"),
    label('29', 'City Council &amp; Public Meetings'),
    label('61', 'Community Events'),
  ].join('\n');
  const discover = () => {
    const urls: string[] = [];
    const fetcher = new Fetcher({
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
        return new Response(page);
      },
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    return { urls, ctx: { fetcher, now: new Date('2026-10-16T12:00:00Z') } };
  };

  it('reads the calendar list and proposes meetings, events and News Flash', async () => {
    const { calendarCategories } = await import('../src/civicplus');
    expect(calendarCategories(page)).toEqual([
      { id: '48', name: "Children's Science Explorium" },
      { id: '29', name: 'City Council & Public Meetings' },
      { id: '61', name: 'Community Events' },
    ]);
    const { urls, ctx: c } = discover();
    const home = 'https://www.example-city.gov/Home';
    expect(await civicplusAdapter.propose!(home, '', 'agenda', c)).toEqual([
      {
        kind: 'agenda',
        url: 'https://www.example-city.gov/',
        options: { module: 'calendar', catId: '29' },
        label: 'CivicPlus calendar: City Council & Public Meetings',
      },
    ]);
    expect(urls).toContain('https://www.example-city.gov/Calendar.aspx');
    expect((await civicplusAdapter.propose!(home, '', 'events', c))[0]!.options).toEqual({
      module: 'calendar',
      catId: '61',
    });
    expect(await civicplusAdapter.propose!(home, '', 'city_news', c)).toEqual([
      {
        kind: 'city_news',
        url: 'https://www.example-city.gov/',
        options: { module: 'newsflash', catId: 'All-newsflash.xml' },
        label: 'CivicPlus News Flash (all categories)',
      },
    ]);
    expect((await civicplusAdapter.propose!(home, '', 'police', c))[0]!.options).toEqual({
      module: 'newsflash',
      catId: 'All-newsflash.xml',
    });
    expect(await civicplusAdapter.propose!(home, '', 'permits', c)).toEqual([]);
  });
});
