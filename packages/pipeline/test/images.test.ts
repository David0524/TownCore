import { describe, expect, it } from 'vitest';
import { cardAlt, dailyCounts, dailyCountsAlt, imageOptions } from '../src/images';

// The image router's pure parts (CLAUDE.md §11c).
const TZ = 'America/New_York';
const at = (iso: string) => new Date(iso);

describe('image options by beat', () => {
  it('follows the §11c defaults and always ends at the card', () => {
    expect(imageOptions({ beat: 'development', kind: 'story' })).toEqual([
      'map',
      'data-graphic',
      'typographic-card',
    ]);
    expect(imageOptions({ beat: 'public-safety', kind: 'story' })).toEqual([
      'map',
      'typographic-card',
    ]);
    expect(imageOptions({ beat: 'business', kind: 'roundup' })[0]).toBe('data-graphic');
    expect(imageOptions({ beat: 'unknown-beat', kind: 'story' })).toEqual(['typographic-card']);
  });
});

describe('daily counts from the story’s own records', () => {
  it('counts the main record type per local day, filling empty days', () => {
    const spec = dailyCounts(
      [
        // 11 p.m. Oct. 5 in New York is Oct. 6 in UTC: counted on the 5th.
        { type: 'new-filing', occurredAt: at('2026-10-06T03:00:00Z') },
        { type: 'new-filing', occurredAt: at('2026-10-06T15:00:00Z') },
        { type: 'new-filing', occurredAt: at('2026-10-08T15:00:00Z') },
        { type: 'new-filing', occurredAt: at('2026-10-08T16:00:00Z') },
        { type: 'new-filing', occurredAt: at('2026-10-08T17:00:00Z') },
        { type: 'license', occurredAt: at('2026-10-07T15:00:00Z') },
        { type: 'new-filing', occurredAt: null },
      ],
      TZ,
    );
    expect(spec).toEqual({
      type: 'daily-counts',
      label: 'new business filings',
      bars: [
        { date: '2026-10-05', count: 1 },
        { date: '2026-10-06', count: 1 },
        { date: '2026-10-07', count: 0 },
        { date: '2026-10-08', count: 3 },
      ],
      total: 5,
    });
    expect(dailyCountsAlt(spec!, TZ)).toBe(
      'Bar chart of new business filings by day, Oct. 5 to Oct. 8: Oct. 5, 1; Oct. 6, 1; Oct. 7, 0; Oct. 8, 3. Total 5.',
    );
  });

  it('counts date-only values (midnight UTC, as state filings store them) on their own date', () => {
    const spec = dailyCounts(
      ['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-06', '2026-10-06'].map((d) => ({
        type: 'new-filing',
        occurredAt: at(`${d}T00:00:00Z`),
      })),
      TZ,
    );
    expect(spec?.bars).toEqual([
      { date: '2026-10-05', count: 3 },
      { date: '2026-10-06', count: 2 },
    ]);
  });

  it('gives no chart for too little data, one day, unknown types or a long span', () => {
    const filing = (iso: string) => ({ type: 'new-filing', occurredAt: at(iso) });
    expect(
      dailyCounts([filing('2026-10-06T15:00:00Z'), filing('2026-10-07T15:00:00Z')], TZ),
    ).toBeNull();
    expect(
      dailyCounts(
        [1, 2, 3, 4, 5].map(() => filing('2026-10-06T15:00:00Z')),
        TZ,
      ),
    ).toBeNull();
    expect(
      dailyCounts(
        [1, 2, 3, 4, 5].map((d) => ({
          type: 'release',
          occurredAt: at(`2026-10-0${d}T15:00:00Z`),
        })),
        TZ,
      ),
    ).toBeNull();
    expect(
      dailyCounts(
        [
          filing('2026-10-01T15:00:00Z'),
          filing('2026-10-02T15:00:00Z'),
          filing('2026-10-20T15:00:00Z'),
        ],
        TZ,
      ),
    ).toBeNull();
  });
});

describe('card alt text', () => {
  it('says what the card shows', () => {
    expect(cardAlt({ headline: 'Council sets budget', beat: 'government' })).toBe(
      'Title card with the headline “Council sets budget” and the Government section mark.',
    );
  });
});
