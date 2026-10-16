import { zonedTimeToUtc } from '../lib/ical';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// Legistar (Granicus) through its public Web API (CLAUDE.md §9: one adapter for every city on the
// platform). https://webapi.legistar.com/Home/Examples documents it: JSON over HTTPS, public
// items only. webapi.legistar.com and {client}.legistar.com have no robots.txt rules (404), so
// the normal Fetcher checks apply and no documented-API exception is needed.
//
// Never fetched: the document hosts the API links to (*.legistar1.com, legistar.granicus.com,
// legistar2.granicus.com), whose robots.txt disallows all bots, and Granicus video (also
// disallowed). Records link readers to the meeting's own page on {client}.legistar.com.
//
// Each meeting gives up to three records, so a change to one doesn't churn the others (a
// published story citing a record gets an update note when that record changes):
// - event:<id>    type 'meeting': when, where, which body. Changes only if it's rescheduled.
// - agenda:<id>   type 'agenda': the agenda items, once the agenda is published.
// - actions:<id>  type 'meeting-actions': what was decided on each item, once the clerk records it.
//
// Source config: { client?: string (default: from url), timezone?: string,
//                  bodies?: string[] (only these body names), pastDays?: number, aheadDays?: number }

type Options = {
  client: string;
  timezone: string;
  bodies: string[] | null;
  pastDays: number;
  aheadDays: number;
};

export type LegistarEvent = {
  EventId: number;
  EventGuid: string;
  EventLastModifiedUtc: string;
  EventBodyId: number;
  EventBodyName: string;
  EventDate: string;
  EventTime: string | null;
  EventAgendaStatusName: string | null;
  EventMinutesStatusName: string | null;
  EventLocation: string | null;
  EventAgendaFile: string | null;
  EventMinutesFile: string | null;
  EventComment: string | null;
  EventInSiteURL: string | null;
};

export type LegistarEventItem = {
  EventItemId: number;
  EventItemAgendaSequence: number | null;
  EventItemAgendaNumber: string | null;
  EventItemTitle: string | null;
  EventItemActionName: string | null;
  EventItemActionText: string | null;
  EventItemPassedFlagName: string | null;
  EventItemTally: string | null;
  EventItemMover: string | null;
  EventItemSeconder: string | null;
  EventItemConsent: number | null;
  EventItemMatterId: number | null;
  EventItemMatterFile: string | null;
  EventItemMatterType: string | null;
  EventItemMatterStatus: string | null;
};

const API = 'https://webapi.legistar.com/v1';
/** The API returns at most 1,000 rows a reply; a town's window stays far below that. */
const MAX_EVENTS = 200;
/** Agenda titles in Legistar can run to a page; records keep the first part. */
const MAX_TITLE = 700;

/** The Legistar client name from a {client}.legistar.com or webapi.legistar.com/v1/{client} URL. */
export function legistarClient(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.toLowerCase() === 'webapi.legistar.com') {
    return u.pathname.match(/^\/v1\/([^/]+)/i)?.[1]?.toLowerCase() ?? null;
  }
  return u.hostname.match(/^([a-z0-9-]+)\.legistar\.com$/i)?.[1]?.toLowerCase() ?? null;
}

function options(source: SourceConfig): Options {
  const c = source.config as {
    client?: string;
    timezone?: string;
    bodies?: string[];
    pastDays?: number;
    aheadDays?: number;
  };
  const client = c.client ?? (source.url ? legistarClient(source.url) : null);
  if (!client || client === 'webapi') {
    throw new Error(
      `Legistar source ${source.id} needs config.client or a {client}.legistar.com url`,
    );
  }
  return {
    client,
    timezone: c.timezone ?? 'America/New_York',
    bodies: c.bodies?.length ? c.bodies.map((b) => b.toLowerCase()) : null,
    pastDays: c.pastDays ?? 30,
    aheadDays: c.aheadDays ?? 60,
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function eventsUrl(client: string, from: Date, to: Date): string {
  const filter = `EventDate ge datetime'${isoDay(from)}' and EventDate lt datetime'${isoDay(to)}'`;
  const params = new URLSearchParams({ $filter: filter, $orderby: 'EventDate', $top: '1000' });
  return `${API}/${encodeURIComponent(client)}/events?${params.toString()}`;
}

export function eventItemsUrl(client: string, eventId: number): string {
  return `${API}/${encodeURIComponent(client)}/events/${eventId}/eventitems?AgendaNote=1&MinutesNote=1`;
}

/** The meeting's start in UTC: EventDate is the local date, EventTime like "5:01 PM". */
export function eventStart(
  event: Pick<LegistarEvent, 'EventDate' | 'EventTime'>,
  timeZone: string,
) {
  const [y, mo, d] = event.EventDate.slice(0, 10).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const t = event.EventTime?.match(/(\d{1,2}):(\d{2})\s*([AP])\.?M/i);
  if (!t) return { start: zonedTimeToUtc(y, mo, d, 0, 0, 0, timeZone), hasTime: false };
  const hour = (Number(t[1]) % 12) + (t[3]!.toUpperCase() === 'P' ? 12 : 0);
  return { start: zonedTimeToUtc(y, mo, d, hour, Number(t[2]), 0, timeZone), hasTime: true };
}

function formatWhen(start: Date, hasTime: boolean, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  if (!hasTime) return day;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(start);
  return `${day}, ${time}`;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s: string) => (s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE - 1).trimEnd()}…` : s);

/** The page readers can open: the meeting's detail page, or the client's calendar. */
function meetingUrl(client: string, event: LegistarEvent): string {
  const url = event.EventInSiteURL;
  if (url && /^https:\/\/[a-z0-9-]+\.legistar\.com\//i.test(url)) return url;
  return `https://${client}.legistar.com/Calendar.aspx`;
}

function meetingTitle(event: LegistarEvent): string {
  const body = clean(event.EventBodyName);
  // "Regular Meeting at 5:00 PM": the time is already in the record's When line.
  const comment = clean(event.EventComment).replace(/\s+at\s+\d{1,2}:\d{2}\s*[AP]\.?M\.?$/i, '');
  // The comment often repeats the body name; use it only when it adds something short.
  if (comment && comment.toLowerCase() !== body.toLowerCase() && comment.length <= 80) {
    return `${body}: ${comment}`;
  }
  return `${body} meeting`;
}

/** Items worth listing: titled, and not the boilerplate accessibility notice. */
function listedItems(items: LegistarEventItem[]): LegistarEventItem[] {
  return items
    .filter(
      (i) => clean(i.EventItemTitle) && !/^the city shall furnish/i.test(clean(i.EventItemTitle)),
    )
    .sort((a, b) => (a.EventItemAgendaSequence ?? 0) - (b.EventItemAgendaSequence ?? 0));
}

function itemLabel(item: LegistarEventItem): string {
  const number = clean(item.EventItemAgendaNumber);
  const meta = [
    clean(item.EventItemMatterType),
    item.EventItemMatterFile ? `file ${item.EventItemMatterFile}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return [number, clip(clean(item.EventItemTitle)), meta ? `(${meta})` : '']
    .filter(Boolean)
    .join(' ');
}

export function agendaText(items: LegistarEventItem[]): string {
  return listedItems(items)
    .map((i) => `- ${itemLabel(i)}`)
    .join('\n');
}

/** One line per item with a recorded action, in the clerk's own words. */
export function actionsText(items: LegistarEventItem[]): string {
  return listedItems(items)
    .filter((i) => clean(i.EventItemActionName) || clean(i.EventItemPassedFlagName))
    .map((i) => {
      const result = [
        clean(i.EventItemActionText) || clean(i.EventItemActionName),
        clean(i.EventItemPassedFlagName) ? `Result: ${clean(i.EventItemPassedFlagName)}` : '',
        clean(i.EventItemTally) ? `Vote: ${clean(i.EventItemTally)}` : '',
        [
          clean(i.EventItemMover) ? `Moved by ${clean(i.EventItemMover)}` : '',
          clean(i.EventItemSeconder) ? `seconded by ${clean(i.EventItemSeconder)}` : '',
        ]
          .filter(Boolean)
          .join(', '),
      ].filter(Boolean);
      return `- ${itemLabel(i)}: ${result.join('. ')}`;
    })
    .join('\n');
}

async function fetchEvents(source: SourceConfig, ctx: AdapterContext): Promise<RawRecord[]> {
  const opts = options(source);
  const from = new Date(ctx.now.getTime() - opts.pastDays * 86_400_000);
  const to = new Date(ctx.now.getTime() + opts.aheadDays * 86_400_000);
  let events = await ctx.fetcher.getJson<LegistarEvent[]>(eventsUrl(opts.client, from, to));
  if (opts.bodies) {
    events = events.filter((e) => opts.bodies!.includes(clean(e.EventBodyName).toLowerCase()));
  }
  const records: RawRecord[] = [];
  for (const event of events.slice(0, MAX_EVENTS)) {
    const { start, hasTime } = eventStart(event, opts.timezone);
    const url = meetingUrl(opts.client, event);
    const title = meetingTitle(event);
    const where = clean(event.EventLocation);
    const header = [
      `When: ${formatWhen(start, hasTime, opts.timezone)}`,
      where ? `Where: ${where}` : null,
      `Body: ${clean(event.EventBodyName)}`,
    ].filter(Boolean) as string[];
    const meta = {
      eventId: event.EventId,
      guid: event.EventGuid,
      body: event.EventBodyName,
      bodyId: event.EventBodyId,
      agendaStatus: event.EventAgendaStatusName,
      minutesStatus: event.EventMinutesStatusName,
      lastModified: event.EventLastModifiedUtc,
    };
    records.push({
      externalId: `event:${event.EventId}`,
      type: 'meeting',
      title,
      text: header.join('\n'),
      url,
      occurredAt: start,
      raw: meta,
    });

    // Agenda items are published with the agenda; nothing to ask for before that.
    if (!event.EventAgendaFile && !event.EventMinutesFile) continue;
    const items = await ctx.fetcher.getJson<LegistarEventItem[]>(
      eventItemsUrl(opts.client, event.EventId),
    );
    const agenda = agendaText(items);
    if (agenda) {
      records.push({
        externalId: `agenda:${event.EventId}`,
        type: 'agenda',
        title: `Agenda: ${title}`,
        text: [
          ...header,
          `Agenda status: ${clean(event.EventAgendaStatusName) || 'unknown'}`,
          '',
          'Agenda items:',
          agenda,
        ].join('\n'),
        url,
        occurredAt: start,
        raw: { ...meta, items: items.map(itemRaw) },
      });
    }
    const actions = actionsText(items);
    if (actions) {
      records.push({
        externalId: `actions:${event.EventId}`,
        type: 'meeting-actions',
        title: `Actions: ${title}`,
        text: [
          ...header,
          `Minutes status: ${clean(event.EventMinutesStatusName) || 'not posted'}`,
          '',
          'Actions taken, as recorded by the clerk:',
          actions,
        ].join('\n'),
        url,
        occurredAt: start,
        raw: { ...meta, items: items.map(itemRaw) },
      });
    }
  }
  return records;
}

function itemRaw(i: LegistarEventItem) {
  return {
    id: i.EventItemId,
    number: i.EventItemAgendaNumber,
    title: i.EventItemTitle,
    matterId: i.EventItemMatterId,
    matterFile: i.EventItemMatterFile,
    matterType: i.EventItemMatterType,
    matterStatus: i.EventItemMatterStatus,
    action: i.EventItemActionName,
    actionText: i.EventItemActionText,
    passed: i.EventItemPassedFlagName,
    tally: i.EventItemTally,
    mover: i.EventItemMover,
    seconder: i.EventItemSeconder,
    consent: i.EventItemConsent === 1,
  };
}

export const legistarAdapter: SourceAdapter = {
  platform: 'legistar',
  kinds: ['agenda'],

  async detect(url, html) {
    if (legistarClient(url) && legistarClient(url) !== 'webapi') return 1;
    // A city page linking to its Legistar calendar or meeting pages.
    if (
      /https?:\/\/[a-z0-9-]+\.legistar\.com\/(Calendar|MeetingDetail|Legislation)\.aspx/i.test(html)
    ) {
      return 0.8;
    }
    return 0;
  },

  fetch: (source, _since, ctx) => fetchEvents(source, ctx),

  // Launcher discovery (M7): a {client}.legistar.com page, or a city page linking to one, gives
  // that client's meetings; the API is health-checked before it's used.
  async propose(url, html, kind) {
    if (kind !== 'agenda') return [];
    const client =
      legistarClient(url) ??
      html.match(/https?:\/\/([a-z0-9-]+)\.legistar\.com\//i)?.[1]?.toLowerCase();
    if (!client || client === 'webapi') return [];
    return [
      {
        kind,
        url: `https://${client}.legistar.com/`,
        label: `Legistar meetings (${client}.legistar.com, public Web API)`,
      },
    ];
  },

  async healthCheck(source, ctx) {
    try {
      const { client } = options(source);
      await ctx.fetcher.getJson(`${API}/${encodeURIComponent(client)}/bodies?$top=1`);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
