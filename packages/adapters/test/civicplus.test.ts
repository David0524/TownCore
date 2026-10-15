import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { civicplusAdapter, newsBodyText, newsItemId } from '../src/civicplus';
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
