import { zonedTimeToUtc } from '../lib/ical';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// CivicClerk (CivicPlus) through the public API behind each town's portal (CLAUDE.md §9: one
// adapter for every town on the platform). {tenant}.api.civicclerk.com has no robots.txt rules
// (404) and the portal's robots.txt has no Disallow, so the normal Fetcher checks apply.
// - GET /v1/Events (OData): meetings with their published files and a video link.
// - GET /v1/Meetings/GetMeetingFileStream(fileId=N,plainText=true): a published agenda or
//   minutes file as plain text, so no PDF parsing is needed.
// Agenda packets (hundreds of pages of backup) are never downloaded.
//
// Each meeting gives up to three records, so a change to one doesn't churn the others (a
// published story citing a record gets an update note when that record changes):
// - event:<id>    type 'meeting': when, where, which body, video link.
// - agenda:<id>   type 'agenda': the agenda's text.
// - minutes:<id>  type 'minutes': the minutes (or the synopsis some towns post first).
//
// Times: the API writes local wall-clock times with a "Z" (Jupiter's 7:00 PM council meeting is
// "19:00:00Z"), so they are read in the town's time zone.
//
// Source config: { tenant?: string (default: from url), timezone?: string,
//                  categories?: string[] (only these), pastDays?: number, aheadDays?: number }

type Options = {
  tenant: string;
  timezone: string;
  categories: string[] | null;
  pastDays: number;
  aheadDays: number;
};

export type CivicClerkFile = {
  fileId: number;
  type: string;
  name: string;
  publishOn: string | null;
};

export type CivicClerkEvent = {
  id: number;
  eventName: string;
  eventDescription: string | null;
  startDateTime: string;
  categoryName: string | null;
  isPublished: string | null;
  agendaId: number | null;
  externalMediaUrl: string | null;
  youtubeVideoId: string | null;
  eventLocation: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null;
  publishedFiles: CivicClerkFile[] | null;
};

type EventsPage = { value: CivicClerkEvent[]; '@odata.nextLink'?: string };

/** Pages of events followed per run; a town's window fits in one or two. */
const MAX_PAGES = 8;
/** Plain-text agendas and minutes are a few KB; anything far larger is cut. */
const MAX_TEXT = 60_000;

/** The tenant from a {tenant}.portal.civicclerk.com or {tenant}.api.civicclerk.com URL. */
export function civicclerkTenant(url: string): string | null {
  return (
    new URL(url).hostname
      .match(/^([a-z0-9-]+)\.(?:portal|api)\.civicclerk\.com$/i)?.[1]
      ?.toLowerCase() ?? null
  );
}

function options(source: SourceConfig): Options {
  const c = source.config as {
    tenant?: string;
    timezone?: string;
    categories?: string[];
    pastDays?: number;
    aheadDays?: number;
  };
  const tenant = c.tenant ?? (source.url ? civicclerkTenant(source.url) : null);
  if (!tenant) {
    throw new Error(
      `CivicClerk source ${source.id} needs config.tenant or a {tenant}.portal.civicclerk.com url`,
    );
  }
  return {
    tenant,
    timezone: c.timezone ?? 'America/New_York',
    categories: c.categories?.length ? c.categories.map((x) => x.toLowerCase()) : null,
    pastDays: c.pastDays ?? 30,
    aheadDays: c.aheadDays ?? 60,
  };
}

const api = (tenant: string) => `https://${tenant}.api.civicclerk.com/v1`;
export const portalEventUrl = (tenant: string, id: number) =>
  `https://${tenant}.portal.civicclerk.com/event/${id}/overview`;

/** OData timestamps in the API's own form (local wall time written with a Z). */
const wall = (d: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
};

export function eventsUrl(tenant: string, from: Date, to: Date, timeZone: string): string {
  const params = new URLSearchParams({
    $filter: `startDateTime gt ${wall(from, timeZone)} and startDateTime lt ${wall(to, timeZone)}`,
    $orderby: 'startDateTime',
  });
  return `${api(tenant)}/Events?${params.toString()}`;
}

export function fileTextUrl(tenant: string, fileId: number): string {
  return `${api(tenant)}/Meetings/GetMeetingFileStream(fileId=${fileId},plainText=true)`;
}

/** The meeting's start in UTC, from the API's local wall time. */
export function eventStart(startDateTime: string, timeZone: string): Date {
  const m = startDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Unreadable CivicClerk time ${startDateTime}`);
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return zonedTimeToUtc(y!, mo!, d!, h!, mi!, s ?? 0, timeZone);
}

function formatWhen(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(start)
    .replace(' at ', ', ');
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function where(event: CivicClerkEvent): string {
  const l = event.eventLocation;
  if (!l) return '';
  const cityLine = [
    clean(l.city),
    [clean(l.state).toUpperCase(), clean(l.zipCode)].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [clean(l.address1), clean(l.address2), cityLine].filter(Boolean).join(', ');
}

/** A link readers can follow to the meeting's video, when the town gives one. */
function videoUrl(event: CivicClerkEvent): string | null {
  if (event.youtubeVideoId) return `https://www.youtube.com/watch?v=${event.youtubeVideoId}`;
  const url = clean(event.externalMediaUrl);
  return /^https:\/\//i.test(url) ? url : null;
}

/** Plain text as the API gives it: layout spaces trimmed, blank runs collapsed. */
export function tidyText(text: string): string {
  const tidy = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy.length > MAX_TEXT ? `${tidy.slice(0, MAX_TEXT).trimEnd()}\n…` : tidy;
}

/** The newest published file of a type (towns sometimes post a revised agenda alongside). */
function latestFile(event: CivicClerkEvent, type: RegExp): CivicClerkFile | null {
  const files = (event.publishedFiles ?? []).filter((f) => type.test(f.type));
  return (
    files.sort(
      (a, b) => (b.publishOn ?? '').localeCompare(a.publishOn ?? '') || b.fileId - a.fileId,
    )[0] ?? null
  );
}

async function fetchEvents(
  source: SourceConfig,
  since: Date | null,
  ctx: AdapterContext,
): Promise<RawRecord[]> {
  const opts = options(source);
  const from = new Date(ctx.now.getTime() - opts.pastDays * 86_400_000);
  const to = new Date(ctx.now.getTime() + opts.aheadDays * 86_400_000);
  const host = new URL(api(opts.tenant)).host;

  let events: CivicClerkEvent[] = [];
  let next: string | undefined = eventsUrl(opts.tenant, from, to, opts.timezone);
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body: EventsPage = await ctx.fetcher.getJson<EventsPage>(next);
    events.push(...body.value);
    const link = body['@odata.nextLink'];
    // Only follow paging links on the same API host.
    next = link && new URL(link).host === host ? link : undefined;
  }
  if (opts.categories) {
    events = events.filter((e) => opts.categories!.includes(clean(e.categoryName).toLowerCase()));
  }

  const records: RawRecord[] = [];
  for (const event of events) {
    if (event.isPublished && event.isPublished !== 'Published') continue;
    const start = eventStart(event.startDateTime, opts.timezone);
    const url = portalEventUrl(opts.tenant, event.id);
    const title = clean(event.eventName) || `${clean(event.categoryName)} meeting`;
    const place = where(event);
    const video = videoUrl(event);
    const header = [
      `When: ${formatWhen(start, opts.timezone)}`,
      place ? `Where: ${place}` : null,
      event.categoryName ? `Body: ${clean(event.categoryName)}` : null,
    ].filter(Boolean) as string[];
    const meta = { eventId: event.id, category: event.categoryName, agendaId: event.agendaId };
    records.push({
      externalId: `event:${event.id}`,
      type: 'meeting',
      title,
      text: [...header, video ? `Video: ${video}` : null].filter(Boolean).join('\n'),
      url,
      occurredAt: start,
      raw: { ...meta, video },
    });

    for (const [kind, type, pattern] of [
      ['agenda', 'agenda', /^agenda$/i],
      ['minutes', 'minutes', /^minutes$/i],
    ] as const) {
      const file = latestFile(event, pattern);
      if (!file) continue;
      // Files are fetched when first published or republished; the stored record stays as is.
      if (since && file.publishOn && new Date(file.publishOn) < since) continue;
      const text = tidyText(await ctx.fetcher.getText(fileTextUrl(opts.tenant, file.fileId)));
      if (!text) continue;
      records.push({
        externalId: `${kind}:${event.id}`,
        type,
        title: `${kind === 'agenda' ? 'Agenda' : 'Minutes'}: ${title}`,
        text: [...header, '', text].join('\n'),
        url,
        occurredAt: start,
        raw: {
          ...meta,
          fileId: file.fileId,
          fileName: clean(file.name),
          publishOn: file.publishOn,
        },
      });
    }
  }
  return records;
}

export const civicclerkAdapter: SourceAdapter = {
  platform: 'civicclerk',
  kinds: ['agenda'],

  async detect(url, html) {
    if (civicclerkTenant(url)) return 1;
    // A town page linking to its CivicClerk portal.
    if (/https?:\/\/[a-z0-9-]+\.portal\.civicclerk\.com/i.test(html)) return 0.8;
    return 0;
  },

  fetch: (source, since, ctx) => fetchEvents(source, since, ctx),

  async healthCheck(source, ctx) {
    try {
      const { tenant } = options(source);
      await ctx.fetcher.getJson(`${api(tenant)}/Events?$top=1`);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
