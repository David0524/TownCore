import * as cheerio from 'cheerio';
import { titleCase } from '@towncore/config';
import { FetchPolicyError } from '../http/fetcher';
import { zonedTimeToUtc } from '../lib/ical';
import { pdfText } from '../lib/pdf';
import type { AdapterContext, RawRecord, SourceConfig } from '../types';

// CivicPlus Agenda Center (docs/plans/meeting-platforms.md §3.6, build order item 5): the
// agendas and minutes module of CivicEngage sites, at /AgendaCenter. robots.txt on the standard
// CivicEngage template allows /AgendaCenter (its `Disallow: /Search` covers only the site search
// at the root, not /AgendaCenter/Search). One run reads:
// - the Agenda Center search for a date window (/AgendaCenter/Search/?CIDs=…&startDate=…), a
//   server-rendered list of every agenda in it, grouped by board, with its posted or amended
//   time and its minutes link when minutes are up;
// - the agenda PDF (/AgendaCenter/ViewFile/Agenda/_MMDDYYYY-ID) of agendas posted or amended
//   since the last run, and the minutes PDF (/ViewFile/Minutes/_MMDDYYYY-ID) of recent meetings,
//   as text through unpdf. The "HTML version" (?html=true) is only a link to the PDF.
// The Agenda Center RSS (/RSSFeed.aspx?ModID=65&CID=All-0) is not used: it names agendas
// without their meeting date and links only to "previous versions", and was empty on Jupiter.
// Records: `meeting:<id>` (a public meeting, for the weekly meetings roundup), `agenda:<id>` and
// `minutes:<id>` (written up as a recap by the story finder, like Legistar's and CivicClerk's).
// Source config: { module: 'agenda-center', catId?: 'all' | '<id>[,<id>…]', timezone?,
//   meetings?: 'true' | 'false' } (meetings 'false' when the city calendar already lists them).

/** Meetings this far back are listed; minutes usually follow a meeting by two to six weeks. */
export const AGENDA_PAST_DAYS = 45;
/** Meetings this far ahead are listed. */
export const AGENDA_AHEAD_DAYS = 60;
/** Most agenda PDFs and most minutes PDFs read in one run (each is one request). */
const MAX_AGENDAS = 8;
const MAX_MINUTES = 8;
/** Agendas of meetings older than this aren't read on a first run: their minutes matter. */
const AGENDA_RECENT_DAYS = 7;
/** Text kept from one PDF (a full packet can run to hundreds of pages). */
const MAX_TEXT = 60_000;

export type AgendaCenterOptions = {
  catId: string;
  timezone: string;
  meetings: boolean;
};

export type AgendaRow = {
  /** The Agenda Center's own ID (the number after the hyphen in `_10142026-867`). */
  id: string;
  /** `10142026-867`: the meeting date (MMDDYYYY) and ID, as the file URLs use it. */
  key: string;
  category: string;
  /** The title as the city wrote it. */
  title: string;
  year: number;
  month: number;
  day: number;
  /** When the agenda was posted or last amended (absolute time), if shown. */
  posted: Date | null;
  agendaUrl: string | null;
  minutesUrl: string | null;
};

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function hour24(hour: number, meridiem: string): number {
  const pm = /^p/i.test(meridiem);
  return (hour % 12) + (pm ? 12 : 0);
}

/** "Posted Oct 1, 2026 7:41 AM" or "Amended Nov 2, 2016 7:28 AM" → that instant. */
function postedTime(text: string, timeZone: string): Date | null {
  const m =
    /(?:Posted|Amended)\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(
      text,
    );
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase() as (typeof MONTHS)[number]) + 1;
  if (month === 0) return null;
  return zonedTimeToUtc(
    Number(m[3]),
    month,
    Number(m[2]),
    hour24(Number(m[4]), m[6]!),
    Number(m[5]),
    0,
    timeZone,
  );
}

/** Rows of an Agenda Center list or search page, grouped by board on the page. */
export function agendaCenterRows(html: string, origin: string, timeZone: string): AgendaRow[] {
  const $ = cheerio.load(html);
  const rows: AgendaRow[] = [];
  const seen = new Set<string>();
  $('div.listing[id^="cat"]').each((_, section) => {
    const category = clean($(section).find('h2').first().text());
    $(section)
      .find('tr.catAgendaRow')
      .each((_, tr) => {
        const anchor = $(tr).find('h3 a[name^="_"]').first().attr('name') ?? '';
        const m = /^_(\d{2})(\d{2})(\d{4})-(\d+)$/.exec(anchor);
        if (!m || seen.has(m[4]!)) return;
        seen.add(m[4]!);
        const key = anchor.slice(1);
        const file = (pattern: RegExp) => {
          const href = $(tr)
            .find('a[href]')
            .map((_, a) => $(a).attr('href') ?? '')
            .get()
            .find((h) => pattern.test(h));
          return href ? new URL(href, origin).href : null;
        };
        rows.push({
          id: m[4]!,
          key,
          category,
          title: clean($(tr).find('td').first().find('p a').first().text()) || category,
          month: Number(m[1]),
          day: Number(m[2]),
          year: Number(m[3]),
          posted: postedTime(clean($(tr).find('h3').first().text()), timeZone),
          // The agenda itself, not its packet or "HTML version" (a link to the same PDF).
          agendaUrl: file(new RegExp(`/AgendaCenter/ViewFile/Agenda/_${key}$`, 'i')),
          minutesUrl: file(/\/AgendaCenter\/ViewFile\/Minutes\/_[\d-]+$/i),
        });
      });
  });
  return rows;
}

/** The Agenda Center's boards, from its category checkboxes. */
export function agendaCenterCategories(html: string): Array<{ id: string; name: string }> {
  const $ = cheerio.load(html);
  return $('input[name="chkCategoryID"]')
    .toArray()
    .map((el) => ({
      id: $(el).attr('value') ?? '',
      name: clean($(el).parent('label').text()),
    }))
    .filter((c) => /^\d+$/.test(c.id) && c.name);
}

/**
 * The meeting's name without the words around it: "SCHOOL ZONE SAFETY CAMERA PROGRAM SPECIAL
 * MAGISTRATE AGENDA OCTOBER 27, 2026 AT 1 PM" → "School Zone Safety Camera Program Special
 * Magistrate". Falls back to the board's name.
 */
export function meetingTitle(title: string, category: string): string {
  const name = clean(
    title
      .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\.?(?![a-z])/gi, ' ')
      .replace(
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}\b/gi,
        ' ',
      )
      .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
      .replace(/\b(?:meeting\s+)?agenda\b/gi, ' ')
      .replace(/\((?:pdf|html|revised|amended)\)/gi, ' ')
      .replace(/[\s,:–—-]+$/g, '')
      .replace(/^[\s,:–—-]+/g, ''),
  );
  const chosen = name.length >= 4 ? name : category;
  return chosen === chosen.toUpperCase() ? titleCase(chosen.toLowerCase()) : chosen;
}

/** A meeting time the city wrote in the title ("… AT 1 PM", "6:30 p.m."), as 24-hour parts. */
export function titleTime(title: string): { hour: number; minute: number } | null {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i.exec(title);
  if (!m || Number(m[1]) > 12) return null;
  return { hour: hour24(Number(m[1]), m[3]!), minute: Number(m[2] ?? 0) };
}

function mdy(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.month}/${parts.day}/${parts.year}`;
}

export function agendaSearchUrl(origin: string, opts: AgendaCenterOptions, now: Date): string {
  const from = new Date(now.getTime() - AGENDA_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + AGENDA_AHEAD_DAYS * 86_400_000);
  const cids = opts.catId === 'all' ? 'all' : encodeURIComponent(opts.catId);
  return `${origin}/AgendaCenter/Search/?term=&CIDs=${cids}&startDate=${mdy(from, opts.timezone)}&endDate=${mdy(to, opts.timezone)}&dateRange=&dateSelector=`;
}

function tidy(text: string): string {
  const t = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT).trimEnd()}\n…` : t;
}

/** A PDF's text, or null when it can't be read (a scan, a missing file): never fails the run. */
async function fileText(url: string, ctx: AdapterContext): Promise<string | null> {
  try {
    const text = await pdfText(url, ctx);
    return text ? tidy(text) : null;
  } catch (error) {
    // A robots.txt refusal is a policy matter for the whole source, never swallowed.
    if (error instanceof FetchPolicyError) throw error;
    return null;
  }
}

export async function fetchAgendaCenter(
  source: SourceConfig,
  opts: AgendaCenterOptions,
  since: Date | null,
  ctx: AdapterContext,
): Promise<RawRecord[]> {
  const origin = new URL(source.url!).origin;
  const html = await ctx.fetcher.getText(agendaSearchUrl(origin, opts, ctx.now));
  const rows = agendaCenterRows(html, origin, opts.timezone);
  const tz = opts.timezone;
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  });

  const meetings = rows.map((row) => {
    const time = titleTime(row.title);
    // A date without a time is kept at local noon, so it falls on the right day everywhere.
    const start = zonedTimeToUtc(
      row.year,
      row.month,
      row.day,
      time?.hour ?? 12,
      time?.minute ?? 0,
      0,
      tz,
    );
    const name = meetingTitle(row.title, row.category);
    const header = [
      `When: ${day.format(start)}${time ? `, ${clock.format(start)}` : ''}`,
      row.category ? `Body: ${row.category}` : null,
    ].filter(Boolean) as string[];
    return { row, start, name, header };
  });

  const records: RawRecord[] = [];
  const raw = (row: AgendaRow) => ({
    agendaId: row.id,
    key: row.key,
    category: row.category,
    title: row.title,
    posted: row.posted?.toISOString() ?? null,
    agendaUrl: row.agendaUrl,
    minutesUrl: row.minutesUrl,
  });
  if (opts.meetings) {
    for (const m of meetings) {
      records.push({
        externalId: `meeting:${m.row.id}`,
        type: 'meeting',
        title: m.name,
        text: m.header.join('\n'),
        url: m.row.agendaUrl ?? `${origin}/AgendaCenter`,
        occurredAt: m.start,
        raw: raw(m.row),
      });
    }
  }

  // Agendas posted or amended since the last run (a day's slack: posted times are minutes), for
  // meetings still ahead or just past; soonest first.
  const agendaFrom = ctx.now.getTime() - AGENDA_RECENT_DAYS * 86_400_000;
  const agendas = meetings
    .filter(
      (m) =>
        m.row.agendaUrl?.startsWith(`${origin}/`) &&
        m.start.getTime() >= agendaFrom &&
        (!since || !m.row.posted || m.row.posted.getTime() >= since.getTime() - 86_400_000),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, MAX_AGENDAS);
  for (const m of agendas) {
    const text = await fileText(m.row.agendaUrl!, ctx);
    if (!text) continue;
    records.push({
      externalId: `agenda:${m.row.id}`,
      type: 'agenda',
      title: `Agenda: ${m.name}`,
      text: [...m.header, '', text].join('\n'),
      url: m.row.agendaUrl!,
      occurredAt: m.start,
      raw: raw(m.row),
    });
  }

  // Minutes of past meetings in the window, newest first. They carry no posted time, so they're
  // read on every run while in the window; an unchanged file stores nothing new (ingest dedupes).
  const minutes = meetings
    .filter(
      (m) => m.row.minutesUrl?.startsWith(`${origin}/`) && m.start.getTime() <= ctx.now.getTime(),
    )
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, MAX_MINUTES);
  for (const m of minutes) {
    const text = await fileText(m.row.minutesUrl!, ctx);
    if (!text) continue;
    records.push({
      externalId: `minutes:${m.row.id}`,
      type: 'minutes',
      title: `Minutes: ${m.name}`,
      text: [...m.header, '', text].join('\n'),
      url: m.row.minutesUrl!,
      occurredAt: m.start,
      raw: raw(m.row),
    });
  }
  return records;
}

/** An Agenda Center that lists at least one meeting in the search window (not an empty module). */
export async function activeAgendaCenter(
  origin: string,
  timezone: string,
  ctx: AdapterContext,
): Promise<{ rows: number; categories: Array<{ id: string; name: string }> } | null> {
  const html = await ctx.fetcher.getText(
    agendaSearchUrl(origin, { catId: 'all', timezone, meetings: true }, ctx.now),
  );
  const rows = agendaCenterRows(html, origin, timezone);
  if (rows.length === 0) return null;
  return { rows: rows.length, categories: agendaCenterCategories(html) };
}
