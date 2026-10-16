import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { SourceKind } from '@towncore/config';
import type { RawRecord, SourceAdapter, SourceConfig, SourceProposal } from '../types';
import { parseIcal } from '../lib/ical';

// CivicPlus CivicEngage (CLAUDE.md §9: one adapter for every city on the platform).
// Uses only paths robots.txt allows on CivicPlus sites:
// - calendar: the iCalendar export (/common/modules/iCalendar/iCalendar.aspx?catID=…)
// - newsflash: the News Flash RSS feed (/RSSFeed.aspx?ModID=1&CID=…), plus each new release's
//   page (/m/newsflash/home/detail/<id>) for its full text. /RSS.aspx (the feed index) is
//   disallowed on some sites and is never requested.
// Source config: { module: 'calendar' | 'newsflash', catId: string, timezone?: string }.

type Options = { module: 'calendar' | 'newsflash'; catId: string; timezone: string };

/** Calendar events within this window around now are kept (past events age out). */
const PAST_EVENT_DAYS = 30;

function options(source: SourceConfig): Options {
  const { module, catId, timezone } = source.config as Partial<Options>;
  if (module !== 'calendar' && module !== 'newsflash') {
    throw new Error(`CivicPlus source ${source.id} needs config.module "calendar" or "newsflash"`);
  }
  if (!catId) throw new Error(`CivicPlus source ${source.id} needs config.catId`);
  if (!source.url) throw new Error(`CivicPlus source ${source.id} needs url (the site's base URL)`);
  return { module, catId: String(catId), timezone: timezone ?? 'America/New_York' };
}

const base = (source: SourceConfig) => new URL(source.url!).origin;

export function calendarUrl(source: SourceConfig, catId: string) {
  return `${base(source)}/common/modules/iCalendar/iCalendar.aspx?catID=${encodeURIComponent(catId)}&feed=calendar`;
}
export function newsFeedUrl(source: SourceConfig, catId: string) {
  return `${base(source)}/RSSFeed.aspx?ModID=1&CID=${encodeURIComponent(catId)}`;
}

function eventDetailUrl(source: SourceConfig, uid: string, description: string | null): string {
  const fromDescription = description?.match(/https?:\/\/\S+/)?.[0];
  return fromDescription ?? `${base(source)}/Calendar.aspx?EID=${encodeURIComponent(uid)}`;
}

function formatWhen(start: Date, end: Date | null, allDay: boolean, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  if (allDay) return day.format(start);
  return `${day.format(start)}, ${time.format(start)}${end ? `–${time.format(end)}` : ''}`;
}

async function fetchCalendar(
  source: SourceConfig,
  opts: Options,
  ctx: Parameters<SourceAdapter['fetch']>[2],
) {
  const ics = await ctx.fetcher.getText(calendarUrl(source, opts.catId));
  const cutoff = ctx.now.getTime() - PAST_EVENT_DAYS * 86_400_000;
  const records: RawRecord[] = [];
  for (const event of parseIcal(ics, opts.timezone)) {
    if (!event.start || event.start.getTime() < cutoff) continue;
    const when = formatWhen(event.start, event.end, event.allDay, opts.timezone);
    records.push({
      externalId: `event:${event.uid}`,
      type: source.kind === 'agenda' ? 'meeting' : 'event',
      title: event.summary,
      text: [`When: ${when}`, event.location ? `Where: ${event.location}` : null]
        .filter(Boolean)
        .join('\n'),
      url: eventDetailUrl(source, event.uid, event.description),
      occurredAt: event.start,
      raw: event,
    });
  }
  return records;
}

/** The release ID from a News Flash link (…CivicAlerts.aspx?aid=2049 or …/detail/2049). */
export function newsItemId(link: string): string | null {
  return link.match(/[?&]aid=(\d+)/i)?.[1] ?? link.match(/\/detail\/(\d+)/i)?.[1] ?? null;
}

/** Extracts a release's body text from its detail page. */
export function newsBodyText(html: string): string | null {
  const $ = cheerio.load(html);
  const body = $('.fr-view').first();
  if (body.length === 0) return null;
  body.find('script, style').remove();
  body.find('br').replaceWith('\n');
  body.find('p, li, h1, h2, h3, h4, div').each((_, el) => {
    $(el).append('\n');
  });
  return body
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchNewsFlash(
  source: SourceConfig,
  opts: Options,
  since: Date | null,
  ctx: Parameters<SourceAdapter['fetch']>[2],
) {
  const xml = await ctx.fetcher.getText(newsFeedUrl(source, opts.catId));
  const $ = cheerio.load(xml, { xml: true });
  const records: RawRecord[] = [];
  for (const item of $('item').toArray()) {
    const link = $(item).find('link').first().text().trim();
    const title = $(item).find('title').first().text().trim();
    const published = new Date($(item).find('pubDate').first().text().trim());
    const occurredAt = Number.isNaN(published.getTime()) ? null : published;
    // Only new items are processed; older ones were stored on earlier runs.
    if (since && occurredAt && occurredAt < since) continue;
    const id = newsItemId(link);
    if (!id) {
      // Items that point elsewhere (an email newsletter, an event page): keep the city's own
      // headline and link, but don't fetch pages outside the News Flash module.
      records.push({
        externalId: `link:${createHash('sha256').update(link).digest('hex').slice(0, 24)}`,
        type: 'release-link',
        title,
        text: null,
        url: link,
        occurredAt,
        raw: { link, pubDate: $(item).find('pubDate').first().text().trim() },
      });
      continue;
    }
    const detailUrl = `${base(source)}/m/newsflash/home/detail/${id}`;
    const html = await ctx.fetcher.getText(detailUrl);
    records.push({
      externalId: `news:${id}`,
      type: 'release',
      title,
      text: newsBodyText(html),
      url: detailUrl,
      occurredAt,
      raw: { link, pubDate: $(item).find('pubDate').first().text().trim() },
    });
  }
  return records;
}

/** The site's calendars, from the category checkboxes on /Calendar.aspx. */
export function calendarCategories(html: string): Array<{ id: string; name: string }> {
  const $ = cheerio.load(html);
  return $('label[for^="chkCalendarID_"]')
    .toArray()
    .map((el) => ({
      id: ($(el).attr('for') ?? '').replace('chkCalendarID_', ''),
      name: $(el).text().replace(/\s+/g, ' ').trim(),
    }))
    .filter((c) => /^\d+$/.test(c.id) && c.name);
}

/** Calendar names that hold public meetings, best first. */
const MEETING_CALENDARS = [
  /city council|city commission|town council|town commission/i,
  /council|commission/i,
  /public meeting|board/i,
];
const EVENT_CALENDARS = [/community event|special event|^events$/i, /event|recreation|parks/i];

async function proposeSources(
  url: string,
  kind: SourceKind,
  ctx: Parameters<SourceAdapter['fetch']>[2],
): Promise<SourceProposal[]> {
  const origin = new URL(url).origin;
  // Police and fire departments on CivicPlus publish through News Flash too.
  if (kind === 'city_news' || kind === 'police' || kind === 'fire') {
    return [
      {
        kind,
        url: `${origin}/`,
        options: { module: 'newsflash', catId: 'All-newsflash.xml' },
        label: 'CivicPlus News Flash (all categories)',
      },
    ];
  }
  if (kind !== 'agenda' && kind !== 'events') return [];
  const categories = calendarCategories(await ctx.fetcher.getText(`${origin}/Calendar.aspx`));
  for (const pattern of kind === 'agenda' ? MEETING_CALENDARS : EVENT_CALENDARS) {
    const hit = categories.find((c) => pattern.test(c.name));
    if (hit)
      return [
        {
          kind,
          url: `${origin}/`,
          options: { module: 'calendar', catId: hit.id },
          label: `CivicPlus calendar: ${hit.name}`,
        },
      ];
  }
  return [];
}

export const civicplusAdapter: SourceAdapter = {
  platform: 'civicplus',
  kinds: ['agenda', 'events', 'police', 'fire', 'city_news'],

  async detect(url, html) {
    if (/\.civicplus\.com$/i.test(new URL(url).hostname)) return 1;
    if (/CivicEngage|CivicPlus/i.test(html)) return 0.9;
    if (/CivicAlerts\.aspx|\/m\/newsflash\//i.test(html)) return 0.6;
    return 0;
  },

  async fetch(source, since, ctx) {
    const opts = options(source);
    return opts.module === 'calendar'
      ? fetchCalendar(source, opts, ctx)
      : fetchNewsFlash(source, opts, since, ctx);
  },

  async propose(url, _html, kind, ctx) {
    return proposeSources(url, kind, ctx);
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      const url =
        opts.module === 'calendar'
          ? calendarUrl(source, opts.catId)
          : newsFeedUrl(source, opts.catId);
      await ctx.fetcher.getText(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
