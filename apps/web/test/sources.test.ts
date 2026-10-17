import type { SourceRecord } from '@towncore/db';
import { describe, expect, it } from 'vitest';
import { formatDay, formatRange, groupSources } from '../src/lib/sources';

// The Sources box (Rule 4; owner, 2026-10-17): records grouped by source and kind, one line each.

const rec = (over: Partial<SourceRecord> & { id: string; sourceId: string }): SourceRecord =>
  ({
    townId: 't',
    externalId: over.id,
    type: 'new-filing',
    title: over.id,
    text: null,
    url: null,
    occurredAt: null,
    raw: {},
    contentHash: 'h',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as SourceRecord;

describe('groupSources', () => {
  it('turns 101 state filings into one line with its dates, count and note', () => {
    const filings = Array.from({ length: 101 }, (_, i) =>
      rec({
        id: `f${i}`,
        sourceId: 'sunbiz',
        url: `https://sftp.floridados.gov/doc/cor/2026100${5 + (i % 5)}c.txt`,
        occurredAt: new Date(Date.UTC(2026, 9, 5 + (i % 7))),
      }),
    );
    const groups = groupSources(filings, [{ id: 'sunbiz', platform: 'fl-sunbiz', url: null }]);
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g!.name).toBe('Florida Division of Corporations, daily filings');
    expect(g!.records).toHaveLength(101);
    expect(g!.href).toMatch(/^https:\/\/sftp\.floridados\.gov\//);
    expect(formatRange(g!.from, g!.to, 'America/New_York')).toBe('Oct. 5–11');
    expect(g!.about).toContain('can be outside city limits');
  });

  it('keeps sources apart and names a local dataset by its host', () => {
    const groups = groupSources(
      [
        rec({ id: 's1', sourceId: 'pao', type: 'sale', url: 'https://maps.example.gov/1' }),
        rec({ id: 'r1', sourceId: 'city', type: 'release', url: 'https://www.city.gov/news/1' }),
        rec({ id: 's2', sourceId: 'pao', type: 'sale', url: 'https://maps.example.gov/1' }),
      ],
      [
        { id: 'pao', platform: 'arcgis', url: 'https://maps.example.gov/arcgis/rest/1' },
        { id: 'city', platform: 'civicplus', url: 'https://www.city.gov/RSSFeed.aspx' },
      ],
    );
    expect(groups.map((g) => [g.name, g.records.length, g.href])).toEqual([
      ['maps.example.gov, property sales', 2, 'https://maps.example.gov/1'],
      ['city.gov, news releases', 1, 'https://www.city.gov/news/1'],
    ]);
  });
});

describe('formatRange', () => {
  it('reads date-only records in UTC and others in the town’s time zone', () => {
    const tz = 'America/New_York';
    expect(
      formatRange(new Date('2026-10-05T00:00:00Z'), new Date('2026-10-05T00:00:00Z'), tz),
    ).toBe('Oct. 5');
    expect(
      formatRange(new Date('2026-09-28T00:00:00Z'), new Date('2026-10-04T00:00:00Z'), tz),
    ).toBe('Sept. 28–Oct. 4');
    expect(
      formatRange(new Date('2026-10-13T22:00:00Z'), new Date('2026-10-16T02:00:00Z'), tz),
    ).toBe('Oct. 13–15');
    expect(formatRange(null, null, tz)).toBeNull();
    // A filing dated Oct. 5 (stored at UTC midnight) never reads as Oct. 4 in Florida.
    expect(formatDay(new Date('2026-10-05T00:00:00Z'), tz)).toBe('Oct. 5, 2026');
    expect(formatDay(new Date('2026-10-06T02:00:00Z'), tz)).toBe('Oct. 5, 2026');
  });
});
