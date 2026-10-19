import { describe, expect, it } from 'vitest';
import {
  apTimeRange,
  calendarPublisher,
  dedupeEvents,
  eventDescription,
  eventIdPrefix,
  eventSlug,
  splitLocation,
} from '../src/lib/events';

describe('city calendar events', () => {
  it('splits venue and street, dropping the town, state and ZIP', () => {
    expect(
      splitLocation(
        "Children's Science Explorium - 300 South Military Trail BOCA RATON FL 33486",
        'Boca Raton',
      ),
    ).toEqual({ venue: "Children's Science Explorium", street: '300 South Military Trail' });
    // Some calendars send HTML in the location.
    expect(
      splitLocation(
        '<p>Gumbo Limbo Nature Center</p> - 1801 North Ocean Blvd BOCA RATON FL 33432',
        'Boca Raton',
      ),
    ).toEqual({ venue: 'Gumbo Limbo Nature Center', street: '1801 North Ocean Blvd' });
    // An all-caps street keeps everything but the town.
    expect(
      splitLocation('Willow Theatre - 300 S MILITARY TRAIL BOCA RATON FL 33486', 'Boca Raton'),
    ).toEqual({ venue: 'Willow Theatre', street: '300 S MILITARY TRAIL' });
    expect(
      splitLocation(
        'Gumbo Limbo Nature Center - 1801 North Ocean Blvd 1801 N Ocean Blvd BOCA RATON FL 33432',
        'Boca Raton',
      ),
    ).toEqual({ venue: 'Gumbo Limbo Nature Center', street: '1801 North Ocean Blvd' });
    expect(splitLocation('Sanborn Square', 'Boca Raton')).toEqual({
      venue: 'Sanborn Square',
      street: null,
    });
    expect(splitLocation(null, 'Boca Raton')).toEqual({ venue: null, street: null });
  });

  it('keeps one of an event listed on several calendars, or one per program', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h));
    const events = [
      { title: 'Soccer Shots', when: at(13) },
      { title: 'Soccer Shots ', when: at(13) },
      { title: 'Nature Connections', when: at(15) },
      { title: 'Soccer Shots', when: at(14) },
    ];
    expect(dedupeEvents(events).map((e) => e.title.trim())).toEqual([
      'Soccer Shots',
      'Nature Connections',
      'Soccer Shots',
    ]);
    expect(dedupeEvents(events, { oncePerTitle: true }).map((e) => e.title.trim())).toEqual([
      'Soccer Shots',
      'Nature Connections',
    ]);
  });
});

describe('event pages', () => {
  const NY = 'America/New_York';
  const id = '1A2B3C4D-0000-4000-8000-000000000001';

  it('builds a stable slug from the title, the local date and the record id', () => {
    // 11:30 p.m. Oct. 20 in Boca is Oct. 21 in UTC: the slug uses the town's day.
    const when = new Date('2026-10-21T03:30:00Z');
    const slug = eventSlug({ id, title: 'Café & Jazz: Night at the Museum!', when }, NY);
    expect(slug).toBe('cafe-and-jazz-night-at-the-museum-2026-10-20-1a2b3c4d');
    expect(eventIdPrefix(slug)).toBe('1a2b3c4d');
    // The same record keeps the same id part even when the calendar edits its title.
    expect(eventIdPrefix(eventSlug({ id, title: 'Renamed', when }, NY))).toBe('1a2b3c4d');
    expect(eventSlug({ id, title: '!!!', when }, NY)).toBe('event-2026-10-20-1a2b3c4d');
    expect(eventSlug({ id, title: 'x'.repeat(200), when }, NY).length).toBeLessThan(90);
    expect(eventIdPrefix('some-story')).toBeNull();
    expect(eventIdPrefix('walk-2026-10-20-xyz12345')).toBeNull();
  });

  it('writes hours in AP style in the town’s timezone', () => {
    const at = (iso: string) => new Date(iso);
    const range = (start: string, end: string | null, allDay = false) =>
      apTimeRange({ when: at(start), end: end ? at(end) : null, allDay }, NY);
    expect(range('2026-10-20T22:00:00Z', '2026-10-20T23:30:00Z')).toBe('6 to 7:30 p.m.');
    expect(range('2026-10-20T14:00:00Z', '2026-10-20T18:00:00Z')).toBe('10 a.m. to 2 p.m.');
    expect(range('2026-10-20T16:00:00Z', '2026-10-20T17:00:00Z')).toBe('noon to 1 p.m.');
    expect(range('2026-10-20T22:30:00Z', null)).toBe('6:30 p.m.');
    // An end on another day shows the start alone.
    expect(range('2026-10-20T22:00:00Z', '2026-10-22T22:00:00Z')).toBe('6 p.m.');
    expect(range('2026-10-20T04:00:00Z', null, true)).toBe('All day');
    // Chicago reads the same instant an hour earlier.
    expect(
      apTimeRange(
        { when: at('2026-10-20T22:00:00Z'), end: null, allDay: false },
        'America/Chicago',
      ),
    ).toBe('5 p.m.');
  });

  it('turns the calendar description into plain paragraphs', () => {
    expect(
      eventDescription(
        '<p>Join a naturalist for a <b>guided</b> walk &amp; talk.</p><p>Bring water.<br>Free.</p>\nMore info: https://www.myboca.us/Calendar.aspx?EID=1',
      ),
    ).toEqual(['Join a naturalist for a guided walk & talk.', 'Bring water. Free.']);
    expect(eventDescription('https://example.com/only-a-link')).toEqual([]);
    expect(eventDescription(null)).toEqual([]);
  });

  it('names the government for its own calendar, else the calendar’s host', () => {
    const agencies = ['Boca Raton Police Services', 'City of Boca Raton'];
    expect(
      calendarPublisher(agencies, { platform: 'civicplus', url: 'https://www.myboca.us/' }),
    ).toBe('City of Boca Raton');
    expect(
      calendarPublisher(agencies, { platform: 'feed', url: 'https://www.bocalibrary.org/cal.ics' }),
    ).toBe('bocalibrary.org');
    expect(calendarPublisher(agencies, null)).toBe('City of Boca Raton');
  });
});
