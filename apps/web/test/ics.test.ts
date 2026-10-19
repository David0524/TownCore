import { describe, expect, it } from 'vitest';
import {
  escapeText,
  eventIcs,
  foldLine,
  googleCalendarUrl,
  icsFilename,
  type CalendarEvent,
} from '../src/lib/ics';

// "Add to calendar" files (RFC 5545) for event pages.

const NY = 'America/New_York';
const opts = {
  domain: 'bocatownsquare.com',
  siteName: 'Boca Town Square',
  timeZone: NY,
  now: new Date('2026-10-19T12:00:00Z'),
};
const walk: CalendarEvent = {
  id: '1a2b3c4d-0000-4000-8000-000000000001',
  title: 'Nature walk; bring water, hat',
  // 6 to 7:30 p.m. in Boca (EDT, UTC−4).
  start: new Date('2026-10-20T22:00:00Z'),
  end: new Date('2026-10-20T23:30:00Z'),
  allDay: false,
  location: 'Gumbo Limbo Nature Center, 1801 North Ocean Blvd',
  description: 'Line one.\n\nC:\\path',
  pageUrl: 'https://bocatownsquare.com/events/nature-walk-2026-10-20-1a2b3c4d',
};

const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const lines = (ics: string) => unfold(ics).split('\r\n');

describe('eventIcs', () => {
  it('writes one VEVENT with UTC times, a stable UID and CRLF line ends', () => {
    const ics = eventIcs(walk, opts);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    const l = lines(ics);
    expect(l[0]).toBe('BEGIN:VCALENDAR');
    expect(l).toContain('VERSION:2.0');
    expect(l).toContain('PRODID:-//Boca Town Square//Events//EN');
    expect(l).toContain('UID:event-1a2b3c4d-0000-4000-8000-000000000001@bocatownsquare.com');
    expect(l).toContain('DTSTAMP:20261019T120000Z');
    expect(l).toContain('DTSTART:20261020T220000Z');
    expect(l).toContain('DTEND:20261020T233000Z');
    expect(l).toContain('SUMMARY:Nature walk\\; bring water\\, hat');
    expect(l).toContain('LOCATION:Gumbo Limbo Nature Center\\, 1801 North Ocean Blvd');
    expect(l).toContain(
      `DESCRIPTION:Line one.\\n\\nC:\\\\path\\n\\nDetails: ${walk.pageUrl.replace(/,/g, '\\,')}`,
    );
    expect(l).toContain(`URL:${walk.pageUrl}`);
    expect(l.filter((x) => x === 'BEGIN:VEVENT')).toHaveLength(1);
    // The same event downloaded twice has the same UID, so calendars update it.
    expect(eventIcs(walk, { ...opts, now: new Date() })).toContain(
      'UID:event-1a2b3c4d-0000-4000-8000-000000000001@bocatownsquare.com',
    );
  });

  it('converts across daylight saving time correctly', () => {
    // 6 p.m. on Nov. 3 in Boca is EST (UTC−5): 23:00Z.
    const l = lines(
      eventIcs({ ...walk, start: new Date('2026-11-03T23:00:00Z'), end: null }, opts),
    );
    expect(l).toContain('DTSTART:20261103T230000Z');
    // No end on the calendar: none invented.
    expect(l.some((x) => x.startsWith('DTEND'))).toBe(false);
  });

  it('writes all-day events as local dates with an exclusive end', () => {
    const fair = {
      ...walk,
      allDay: true,
      // Midnight Oct. 24 in Boca, to the next midnight.
      start: new Date('2026-10-24T04:00:00Z'),
      end: new Date('2026-10-25T04:00:00Z'),
    };
    const l = lines(eventIcs(fair, opts));
    expect(l).toContain('DTSTART;VALUE=DATE:20261024');
    expect(l).toContain('DTEND;VALUE=DATE:20261025');
    // A two-day fair, end given as the last day's midnight start.
    const two = lines(eventIcs({ ...fair, end: new Date('2026-10-26T04:00:00Z') }, opts));
    expect(two).toContain('DTEND;VALUE=DATE:20261026');
    // No end: one day.
    expect(lines(eventIcs({ ...fair, end: null }, opts))).toContain('DTEND;VALUE=DATE:20261025');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const long = eventIcs({ ...walk, description: 'é'.repeat(200) }, opts);
    for (const line of long.split('\r\n'))
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(long).not.toContain('�');
    expect(unfold(long)).toContain(`DESCRIPTION:${'é'.repeat(200)}`);
    expect(foldLine('short')).toBe('short');
  });

  it('escapes text per RFC 5545', () => {
    expect(escapeText('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf');
  });
});

describe('googleCalendarUrl', () => {
  it('links a timed event in UTC and an all-day event by dates', () => {
    const url = new URL(googleCalendarUrl(walk, NY));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(walk.title);
    expect(url.searchParams.get('dates')).toBe('20261020T220000Z/20261020T233000Z');
    expect(url.searchParams.get('location')).toBe(walk.location);
    expect(url.searchParams.get('details')).toContain(walk.pageUrl);
    const allDay = new URL(
      googleCalendarUrl(
        { ...walk, allDay: true, start: new Date('2026-10-24T04:00:00Z'), end: null },
        NY,
      ),
    );
    expect(allDay.searchParams.get('dates')).toBe('20261024/20261025');
  });
});

describe('icsFilename', () => {
  it('uses the title words', () => {
    expect(icsFilename('nature-walk-2026-10-20-1a2b3c4d')).toBe('nature-walk.ics');
  });
});
