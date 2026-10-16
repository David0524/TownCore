import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { SourceKind } from '@towncore/config';
import { parseIcal } from '../lib/ical';
import type {
  AdapterContext,
  RawRecord,
  SourceAdapter,
  SourceConfig,
  SourceProposal,
} from '../types';

// Any standard feed (CLAUDE.md §9): RSS 2.0, RSS 1.0 (RDF), Atom and iCalendar. Most city,
// county, police, school-district and library sites publish one of these whatever software they
// run (WordPress, Drupal, Revize, Finalsite, Edlio, SchoolMessenger, govDelivery…), so this one
// adapter covers every town whose platform has no dedicated adapter. Platform adapters win
// detection; this is the fallback.
//
// Source config (all optional):
//   format: 'rss' | 'ical'          — default: sniffed from the response
//   timezone: 'America/Chicago'     — for floating iCalendar times (default America/New_York)
//   pages: true                     — fetch each new item's page for its full text when the feed
//                                     carries only a summary (same site only, robots-checked)
//   selector: '.news-body'          — where the text is on those pages (default: common article
//                                     containers, longest wins)
//   match: 'council|commission'     — keep only items whose title matches (case-insensitive)
//   type: 'release'                 — record type (default from the source kind)

type Options = {
  format: 'rss' | 'ical' | null;
  timezone: string;
  pages: boolean;
  selector: string | null;
  match: RegExp | null;
  type: string | null;
};

/** iCalendar events further back than this are dropped (past events age out). */
const PAST_EVENT_DAYS = 30;
/** A feed summary shorter than this sends us to the item's page for the full text. */
const SHORT_TEXT = 400;
/** Most item pages fetched in one run, so a first run on a long feed stays polite. */
const MAX_PAGES_PER_RUN = 25;
/** Article containers tried, in order, when the source gives no selector. */
const ARTICLE_SELECTORS = [
  'article .entry-content',
  '.entry-content',
  '.post-content',
  '.news-content',
  '.field--name-body',
  '[itemprop="articleBody"]',
  'article',
  'main',
  '#content',
  '.content',
];

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  if (!source.url) throw new Error(`Feed source ${source.id} needs url (the feed's address)`);
  const format = c.format === 'rss' || c.format === 'ical' ? c.format : null;
  return {
    format,
    timezone: typeof c.timezone === 'string' ? c.timezone : 'America/New_York',
    pages: c.pages === true || c.pages === 'true',
    selector: typeof c.selector === 'string' && c.selector ? c.selector : null,
    match: typeof c.match === 'string' && c.match ? new RegExp(c.match, 'i') : null,
    type: typeof c.type === 'string' && c.type ? c.type : null,
  };
}

const typeFor = (kind: SourceKind, opts: Options, ical: boolean) =>
  opts.type ?? (kind === 'agenda' ? 'meeting' : ical || kind === 'events' ? 'event' : 'release');

const hashId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

/** Plain text from an HTML fragment, one line per block. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $('#__root');
  root.find('script, style, noscript, iframe, form, nav, aside, footer').remove();
  root.find('br').replaceWith('\n');
  root.find('p, li, h1, h2, h3, h4, h5, h6, div, tr, blockquote').each((_, el) => {
    $(el).append('\n');
  });
  return root
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** The article text on an item's page: the selector given, else the longest common container. */
export function pageText(html: string, selector: string | null): string | null {
  const $ = cheerio.load(html);
  const candidates = selector ? [selector] : ARTICLE_SELECTORS;
  let best: string | null = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = htmlToText($.html(el) ?? '');
    if (text && (!best || text.length > best.length)) best = text;
    if (selector) break;
  }
  return best;
}

export type FeedItem = {
  id: string;
  title: string;
  link: string | null;
  published: Date | null;
  html: string | null;
};

const dateOf = (value: string) => {
  const d = new Date(value.trim());
  return value.trim() && !Number.isNaN(d.getTime()) ? d : null;
};

/** Items from an RSS 2.0, RSS 1.0 (RDF) or Atom document, in feed order. */
export function parseFeed(xml: string, feedUrl: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const abs = (href: string | undefined) => {
    if (!href?.trim()) return null;
    try {
      return new URL(href.trim(), feedUrl).toString();
    } catch {
      return null;
    }
  };
  const atom = $('feed > entry').toArray();
  if (atom.length > 0) {
    return atom.map((el) => {
      const e = $(el);
      const links = e.find('link').toArray();
      const alt = links.find((l) => ($(l).attr('rel') ?? 'alternate') === 'alternate') ?? links[0];
      const link = alt ? abs($(alt).attr('href')) : null;
      const html = e.find('content').first().text() || e.find('summary').first().text() || null;
      const title = e.find('title').first().text().trim();
      return {
        id: e.find('id').first().text().trim() || link || hashId(title),
        title,
        link,
        published:
          dateOf(e.find('published').first().text()) ?? dateOf(e.find('updated').first().text()),
        html,
      };
    });
  }
  return $('item')
    .toArray()
    .map((el) => {
      const e = $(el);
      const link = abs(e.children('link').first().text()) ?? abs(e.attr('rdf:about'));
      const title = e.children('title').first().text().trim();
      const encoded = e.children('content\\:encoded').first().text();
      const html = encoded || e.children('description').first().text() || null;
      return {
        id:
          e.children('guid').first().text().trim() || e.attr('rdf:about') || link || hashId(title),
        title,
        link,
        published:
          dateOf(e.children('pubDate').first().text()) ??
          dateOf(e.children('dc\\:date').first().text()),
        html,
      };
    });
}

const sameSite = (a: string, b: string) => {
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');
  try {
    return host(a) === host(b);
  } catch {
    return false;
  }
};

async function fetchRss(
  source: SourceConfig,
  opts: Options,
  body: string,
  since: Date | null,
  ctx: AdapterContext,
): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  let pages = 0;
  for (const item of parseFeed(body, source.url!)) {
    if (!item.title) continue;
    if (opts.match && !opts.match.test(item.title)) continue;
    // Only new items; older ones were stored on earlier runs.
    if (since && item.published && item.published < since) continue;
    let text = item.html ? htmlToText(item.html) : null;
    if (
      opts.pages &&
      item.link &&
      (text?.length ?? 0) < SHORT_TEXT &&
      sameSite(item.link, source.url!) &&
      pages < MAX_PAGES_PER_RUN
    ) {
      pages++;
      const full = pageText(await ctx.fetcher.getText(item.link), opts.selector);
      if (full && full.length > (text?.length ?? 0)) text = full;
    }
    records.push({
      externalId: `item:${item.id.length > 200 ? hashId(item.id) : item.id}`,
      type: typeFor(source.kind, opts, false),
      title: item.title,
      text,
      url: item.link,
      occurredAt: item.published,
      raw: { id: item.id, link: item.link, published: item.published?.toISOString() ?? null },
    });
  }
  return records;
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

function fetchIcal(source: SourceConfig, opts: Options, body: string, ctx: AdapterContext) {
  const cutoff = ctx.now.getTime() - PAST_EVENT_DAYS * 86_400_000;
  const records: RawRecord[] = [];
  for (const event of parseIcal(body, opts.timezone)) {
    if (!event.start || event.start.getTime() < cutoff) continue;
    if (opts.match && !opts.match.test(event.summary)) continue;
    const when = formatWhen(event.start, event.end, event.allDay, opts.timezone);
    const description = event.description?.trim() || null;
    records.push({
      externalId: `event:${event.uid.length > 200 ? hashId(event.uid) : event.uid}`,
      type: typeFor(source.kind, opts, true),
      title: event.summary,
      text: [`When: ${when}`, event.location ? `Where: ${event.location}` : null, description]
        .filter(Boolean)
        .join('\n'),
      url: event.url ?? description?.match(/https?:\/\/\S+/)?.[0] ?? null,
      occurredAt: event.start,
      raw: event,
    });
  }
  return records;
}

const looksIcal = (body: string) => /^\s*BEGIN:VCALENDAR/i.test(body);

/** Feeds a page links to: <link rel="alternate"> RSS/Atom, and .ics or webcal: links. */
export function feedLinks(
  html: string,
  pageUrl: string,
): Array<{ url: string; format: 'rss' | 'ical'; title: string }> {
  const $ = cheerio.load(html);
  const out = new Map<string, { url: string; format: 'rss' | 'ical'; title: string }>();
  const add = (href: string | undefined, format: 'rss' | 'ical', title: string) => {
    if (!href) return;
    try {
      const url = new URL(href.replace(/^webcal:/i, 'https:'), pageUrl).toString();
      if (!out.has(url)) out.set(url, { url, format, title: title.replace(/\s+/g, ' ').trim() });
    } catch {
      // Not a URL.
    }
  };
  $('link[rel~="alternate"]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (/rss|atom/.test(type)) add($(el).attr('href'), 'rss', $(el).attr('title') ?? 'Feed');
    if (/calendar/.test(type)) add($(el).attr('href'), 'ical', $(el).attr('title') ?? 'Calendar');
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (/^webcal:|\.ics(\?|$)/i.test(href)) add(href, 'ical', $(el).text() || 'Calendar');
  });
  return [...out.values()];
}

/** Feed titles that suit each source kind, best first. */
const KIND_HINTS: Partial<Record<SourceKind, RegExp>> = {
  city_news: /news|press|release|announcement/i,
  police: /police|sheriff|public safety|crime/i,
  fire: /fire|rescue|ems/i,
  events: /event|calendar|recreation|library/i,
  agenda: /meeting|agenda|council|commission|board/i,
  schools: /school|district|board/i,
};

export const feedAdapter: SourceAdapter = {
  platform: 'feed',
  kinds: ['city_news', 'police', 'fire', 'events', 'agenda', 'schools', 'reference'],

  async detect(url, html) {
    // A low score on purpose: any platform adapter that knows the page should win.
    return feedLinks(html, url).length > 0 ? 0.3 : 0;
  },

  async fetch(source, since, ctx) {
    const opts = options(source);
    const body = await ctx.fetcher.getText(source.url!);
    const ical = opts.format ? opts.format === 'ical' : looksIcal(body);
    return ical ? fetchIcal(source, opts, body, ctx) : fetchRss(source, opts, body, since, ctx);
  },

  async propose(url, html, kind) {
    const hint = KIND_HINTS[kind];
    const links = feedLinks(html, url).filter(
      (f) =>
        // A blog's comments feed is never news.
        !/comments/i.test(f.url) &&
        (kind === 'events' || kind === 'agenda' ? true : f.format === 'rss'),
    );
    const ranked = hint
      ? [...links].sort((a, b) => Number(hint.test(b.title)) - Number(hint.test(a.title)))
      : links;
    return ranked.slice(0, 3).map((f): SourceProposal => ({
      kind,
      url: f.url,
      options: { format: f.format },
      label: `${f.format === 'ical' ? 'Calendar feed' : 'News feed'}: ${f.title}`,
    }));
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      const body = await ctx.fetcher.getText(source.url!);
      const ical = opts.format ? opts.format === 'ical' : looksIcal(body);
      const count = ical
        ? parseIcal(body, opts.timezone).length
        : parseFeed(body, source.url!).length;
      return count > 0 ? { ok: true } : { ok: false, detail: 'The feed has no items' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
