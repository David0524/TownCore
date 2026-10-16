import { describe, expect, it } from 'vitest';
import { dedupeEvents, splitLocation } from '../src/lib/events';

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
