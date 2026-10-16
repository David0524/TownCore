import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feedAdapter, feedLinks, htmlToText, pageText, parseFeed } from '../src/feed';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import type { SourceConfig } from '../src/types';

// Recorded live from www.pbso.org (WordPress; robots.txt allows /feed and posts) on 2026-10-16.
const fixture = fileURLToPath(new URL('../fixtures/feed/pbso-news.json', import.meta.url));
const now = new Date('2026-10-16T21:40:00Z');
const fetcherFor = (fetchImpl: FetchFn) =>
  new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 });
const source = (over: Partial<SourceConfig> = {}): SourceConfig => ({
  id: 'feed',
  townId: 't',
  kind: 'police',
  platform: 'feed',
  url: 'https://www.pbso.org/feed',
  config: { pages: true },
  ...over,
});
/** Serves robots.txt (allow all) and the given bodies by URL. */
const serve =
  (bodies: Record<string, string>): FetchFn =>
  async (url) =>
    url.endsWith('/robots.txt')
      ? new Response('User-agent: *\nAllow: /\n')
      : bodies[url] !== undefined
        ? new Response(bodies[url])
        : new Response('missing', { status: 404 });

describe('feed adapter: RSS from a WordPress site', () => {
  it('keeps new items, with full text from each short item’s page', async () => {
    const records = await feedAdapter.fetch(source(), new Date('2026-10-01T00:00:00Z'), {
      fetcher: fetcherFor(replayFetch(fixture)),
      now,
    });
    expect(records.length).toBe(3);
    for (const r of records) {
      expect(r.type).toBe('release');
      expect(r.externalId).toMatch(/^item:/);
      expect(r.url).toMatch(/^https:\/\/www\.pbso\.org\//);
      expect(r.occurredAt!.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-10-01'));
      expect(r.text!.length).toBeGreaterThan(100);
    }
    const hitAndRun = records.find((r) => /hit and run/i.test(r.title ?? ''))!;
    expect(hitAndRun.text).not.toMatch(/<\/?\w+/);
  });

  it('is healthy, and proposes the posts feed but never the comments feed', async () => {
    expect(
      await feedAdapter.healthCheck(source(), { fetcher: fetcherFor(replayFetch(fixture)), now }),
    ).toEqual({ ok: true });
    const html =
      '<link rel="alternate" type="application/rss+xml" title="PBSO » Feed" href="/feed" />' +
      '<link rel="alternate" type="application/rss+xml" title="PBSO » Comments Feed" href="/comments/feed" />';
    const proposals = await feedAdapter.propose!('https://www.pbso.org/', html, 'police', {
      fetcher: fetcherFor(serve({})),
      now,
    });
    expect(proposals.map((p) => p.url)).toEqual(['https://www.pbso.org/feed']);
    expect(await feedAdapter.detect('https://www.pbso.org/', html)).toBe(0.3);
    expect(await feedAdapter.detect('https://x.test/', '<p>no feeds</p>')).toBe(0);
  });
});

describe('feed adapter: other formats', () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>tag:x,1</id><title>Road closure on Main St</title>
      <link rel="alternate" href="/news/1"/><published>2026-10-15T14:00:00Z</published>
      <content type="html">&lt;p&gt;Main St closes &lt;b&gt;Oct. 20&lt;/b&gt;.&lt;/p&gt;</content></entry>
    <entry><id>tag:x,0</id><title>Old item</title><link href="/news/0"/>
      <updated>2026-09-01T00:00:00Z</updated><summary>Old</summary></entry>
  </feed>`;
  const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <item rdf:about="https://town.test/a"><title>Board agenda posted</title>
      <link>https://town.test/a</link><dc:date>2026-10-14T10:00:00Z</dc:date>
      <description>Agenda for the Oct. 21 board meeting.</description></item>
  </rdf:RDF>`;
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:e1@town.test',
    'SUMMARY:Farmers market',
    'DTSTART;TZID=America/Chicago:20261018T080000',
    'DTEND;TZID=America/Chicago:20261018T120000',
    'LOCATION:Town Green',
    'DESCRIPTION:Local produce. https://town.test/events/market',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:e0@town.test',
    'SUMMARY:Long past',
    'DTSTART:20260101T120000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('reads Atom with relative links and keeps only new entries', async () => {
    const records = await feedAdapter.fetch(
      source({ kind: 'city_news', url: 'https://town.test/news.atom', config: {} }),
      new Date('2026-10-01T00:00:00Z'),
      { fetcher: fetcherFor(serve({ 'https://town.test/news.atom': atom })), now },
    );
    expect(records).toEqual([
      expect.objectContaining({
        externalId: 'item:tag:x,1',
        type: 'release',
        title: 'Road closure on Main St',
        text: 'Main St closes Oct. 20.',
        url: 'https://town.test/news/1',
      }),
    ]);
  });

  it('reads RSS 1.0 (RDF) and filters by title', () => {
    const items = parseFeed(rdf, 'https://town.test/rss');
    expect(items).toEqual([
      expect.objectContaining({ id: 'https://town.test/a', title: 'Board agenda posted' }),
    ]);
    expect(items[0]!.published?.toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });

  it('reads iCalendar into events with local times, dropping old ones', async () => {
    const records = await feedAdapter.fetch(
      source({
        kind: 'events',
        url: 'https://town.test/cal.ics',
        config: { timezone: 'America/Chicago' },
      }),
      null,
      { fetcher: fetcherFor(serve({ 'https://town.test/cal.ics': ics })), now },
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      externalId: 'event:e1@town.test',
      type: 'event',
      title: 'Farmers market',
      url: 'https://town.test/events/market',
    });
    expect(records[0]!.text).toMatch(
      /^When: Sunday, October 18, 2026, 8:00\s?AM–12:00\s?PM\nWhere: Town Green/,
    );
    expect(records[0]!.occurredAt!.toISOString()).toBe('2026-10-18T13:00:00.000Z');
  });

  it('agenda sources become meetings, and match filters titles', async () => {
    const records = await feedAdapter.fetch(
      source({ kind: 'agenda', url: 'https://town.test/rss', config: { match: 'board' } }),
      null,
      { fetcher: fetcherFor(serve({ 'https://town.test/rss': rdf })), now },
    );
    expect(records.map((r) => [r.type, r.title])).toEqual([['meeting', 'Board agenda posted']]);
  });

  it('finds feed and calendar links on a page', () => {
    const html =
      '<head><link rel="alternate" type="application/atom+xml" title="News" href="/news.atom"></head>' +
      '<a href="webcal://town.test/cal.ics">Subscribe to events</a>';
    expect(feedLinks(html, 'https://town.test/')).toEqual([
      { url: 'https://town.test/news.atom', format: 'rss', title: 'News' },
      { url: 'https://town.test/cal.ics', format: 'ical', title: 'Subscribe to events' },
    ]);
  });

  it('turns HTML into lines of text and finds article text on a page', () => {
    expect(htmlToText('<p>One <b>two</b></p><ul><li>Three</li></ul><script>x()</script>')).toBe(
      'One two\nThree',
    );
    const page =
      '<nav>Menu</nav><main><h1>Title</h1><div class="entry-content"><p>Body text.</p></div></main>';
    expect(pageText(page, null)).toBe('Title\nBody text.');
    expect(pageText(page, '.entry-content')).toBe('Body text.');
  });
});
