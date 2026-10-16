import { zonedTimeToUtc } from '../lib/ical';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// eSCRIBE meeting portals, pub-{tenant}.escribemeetings.com (CLAUDE.md §9: one adapter for every
// town on the platform). robots.txt on these hosts disallows only PetalBot (checked 2026-10-16
// for Gainesville and Haines City). The portal's calendar answers a read-only JSON POST,
//   POST /MeetingsCalendarView.aspx/GetCalendarMeetings {calendarStartDate, calendarEndDate}
// which the owner approved on 2026-10-16 (decision (a): a platform's own read endpoint where
// robots.txt allows it). Each meeting becomes a `meeting` record linking to its agenda page, and
// a past meeting with posted minutes also becomes a `minutes` record pointing at that document.
//
// Source: url = the portal (https://pub-cityofgainesville.escribemeetings.com/).
// Config: { timezone?: 'America/New_York', match?: 'Commission|Council', days?: 30, ahead?: 30 }

type Meeting = {
  ID: string;
  MeetingName: string;
  StartDate: string; // "2026/10/28 16:15:00", portal local time
  EndDate?: string;
  Location?: string;
  MeetingType?: string;
  HasAgenda?: boolean;
  HasVideo?: boolean;
  MeetingPassed?: boolean;
  MeetingDocumentLink?: { Title?: string; Type?: string; Format?: string; Url?: string }[];
};

type Options = {
  origin: string;
  timezone: string;
  match: RegExp | null;
  days: number;
  ahead: number;
};

const PORTAL = /^https:\/\/pub-[a-z0-9-]+\.escribemeetings\.com\/?/i;

function options(source: SourceConfig): Options {
  if (!source.url || !PORTAL.test(source.url)) {
    throw new Error(
      `escribe source ${source.id} needs url https://pub-{tenant}.escribemeetings.com/`,
    );
  }
  const c = source.config as Record<string, unknown>;
  return {
    origin: new URL(source.url).origin,
    timezone: typeof c.timezone === 'string' ? c.timezone : 'America/New_York',
    match: typeof c.match === 'string' && c.match ? new RegExp(c.match, 'i') : null,
    days: Number(c.days) > 0 ? Number(c.days) : 30,
    ahead: Number(c.ahead) > 0 ? Number(c.ahead) : 30,
  };
}

/** "2026/10/28 16:15:00" in the portal's time zone → Date. */
export function escribeDate(value: string | undefined, timeZone: string): Date | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
  if (!m) return null;
  return zonedTimeToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0), timeZone);
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function calendar(opts: Options, from: Date, to: Date, ctx: AdapterContext) {
  const body = await ctx.fetcher.queryJson<{ d?: Meeting[] }>(
    `${opts.origin}/MeetingsCalendarView.aspx/GetCalendarMeetings`,
    { calendarStartDate: day(from), calendarEndDate: day(to) },
  );
  return body.d ?? [];
}

const formatWhen = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

export function escribeRecords(meetings: Meeting[], opts: Options): RawRecord[] {
  const records: RawRecord[] = [];
  for (const m of meetings) {
    if (opts.match && !opts.match.test(`${m.MeetingName} ${m.MeetingType ?? ''}`)) continue;
    const start = escribeDate(m.StartDate, opts.timezone);
    const page = `${opts.origin}/Meeting.aspx?Id=${encodeURIComponent(m.ID)}&Agenda=Agenda&lang=English`;
    const docs = (m.MeetingDocumentLink ?? []).filter((d) => d.Url);
    const docLines = docs.map(
      (d) => `${d.Title ?? d.Type ?? 'Document'}: ${new URL(d.Url!, opts.origin).toString()}`,
    );
    records.push({
      externalId: `meeting:${m.ID}`,
      type: 'meeting',
      title: m.MeetingName,
      text: [
        start ? `When: ${formatWhen(start, opts.timezone)}` : null,
        m.Location ? `Where: ${m.Location.replace(/<[^>]+>/g, ' ').trim()}` : null,
        ...docLines,
      ]
        .filter(Boolean)
        .join('\n'),
      url: page,
      occurredAt: start,
      raw: m,
    });
    // Posted minutes of a past meeting: written up as a recap by the story finder.
    const minutes = docs.find((d) => /minutes/i.test(`${d.Type} ${d.Title}`));
    if (m.MeetingPassed && minutes) {
      records.push({
        externalId: `minutes:${m.ID}`,
        type: 'minutes',
        title: `${m.MeetingName}: minutes`,
        text: `Minutes posted for ${m.MeetingName}${start ? `, ${formatWhen(start, opts.timezone)}` : ''}.`,
        url: new URL(minutes.Url!, opts.origin).toString(),
        occurredAt: start,
        raw: { meeting: m.ID, document: minutes },
      });
    }
  }
  return records;
}

export const escribeAdapter: SourceAdapter = {
  platform: 'escribe',
  kinds: ['agenda'],

  async detect(url, html) {
    if (PORTAL.test(url)) return 1;
    return /escribemeetings\.com/i.test(html) ? 0.8 : 0;
  },

  async fetch(source, _since, ctx) {
    const opts = options(source);
    const from = new Date(ctx.now.getTime() - opts.days * 86_400_000);
    const to = new Date(ctx.now.getTime() + opts.ahead * 86_400_000);
    return escribeRecords(await calendar(opts, from, to, ctx), opts);
  },

  async propose(url, html, kind) {
    if (kind !== 'agenda') return [];
    const portal =
      PORTAL.exec(url)?.[0] ?? html.match(/https:\/\/pub-[a-z0-9-]+\.escribemeetings\.com/i)?.[0];
    return portal
      ? [{ kind, url: `${new URL(portal).origin}/`, label: 'eSCRIBE meeting calendar' }]
      : [];
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      await calendar(opts, ctx.now, new Date(ctx.now.getTime() + 7 * 86_400_000), ctx);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
