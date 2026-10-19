import { localIsoDate } from './events';

// "Add to calendar" for an event page (RFC 5545): one VEVENT per file. Timed events are written
// in UTC (a "Z" time), so every calendar app shows the right local time without a VTIMEZONE;
// all-day events are local dates. The UID is built from the record's id, so adding the same event
// twice updates it instead of making a copy.

export type CalendarEvent = {
  /** The record's id. */
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  /** Our event page. */
  pageUrl: string;
};

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 folding: lines longer than 75 octets continue on the next line after a space.
 * Counts UTF-8 bytes and never splits a character.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    // The first line holds 75 octets; continuation lines start with a space, so 74 more.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** "20261020T220000Z". */
export const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** "20261020" for the local date in the town. */
const localDateValue = (d: Date, timeZone: string) => localIsoDate(d, timeZone).replace(/-/g, '');

/** The day after a YYYYMMDD date (an all-day event's DTEND is exclusive). */
const nextDay = (value: string) => {
  const d = new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))),
  );
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

/** An all-day event's first and (exclusive) last date, in the town's calendar. */
function allDayRange(e: Pick<CalendarEvent, 'start' | 'end'>, timeZone: string) {
  const start = localDateValue(e.start, timeZone);
  // Calendars mark an all-day end as the next midnight (exclusive) or the last day itself.
  const last = e.end ? localDateValue(new Date(e.end.getTime() - 1), timeZone) : start;
  return { start, end: nextDay(last > start ? last : start) };
}

export function eventIcs(
  e: CalendarEvent,
  opts: { domain: string; siteName: string; timeZone: string; now?: Date },
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escapeText(opts.siteName)}//Events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${e.id}@${opts.domain}`,
    `DTSTAMP:${utcStamp(opts.now ?? new Date())}`,
  ];
  if (e.allDay) {
    const range = allDayRange(e, opts.timeZone);
    lines.push(`DTSTART;VALUE=DATE:${range.start}`, `DTEND;VALUE=DATE:${range.end}`);
  } else {
    lines.push(`DTSTART:${utcStamp(e.start)}`);
    // No end on the calendar: none in the file either (RFC 5545 reads it as the start time),
    // rather than inventing one.
    if (e.end && e.end.getTime() > e.start.getTime()) lines.push(`DTEND:${utcStamp(e.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  const description = [e.description, `Details: ${e.pageUrl}`].filter(Boolean).join('\n\n');
  lines.push(`DESCRIPTION:${escapeText(description)}`, `URL:${e.pageUrl}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** A Google Calendar "add event" link with the same details. */
export function googleCalendarUrl(e: CalendarEvent, timeZone: string): string {
  let dates: string;
  if (e.allDay) {
    const range = allDayRange(e, timeZone);
    dates = `${range.start}/${range.end}`;
  } else {
    const end = e.end && e.end.getTime() > e.start.getTime() ? e.end : e.start;
    dates = `${utcStamp(e.start)}/${utcStamp(end)}`;
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    details: [e.description, e.pageUrl].filter(Boolean).join('\n\n'),
    ctz: timeZone,
  });
  if (e.location) params.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** A safe download name: "sample-nature-walk.ics". */
export const icsFilename = (slug: string) =>
  `${slug.replace(/-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/, '').slice(0, 60) || 'event'}.ics`;
