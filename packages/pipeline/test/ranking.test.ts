import { describe, expect, it } from 'vitest';
import {
  engagementAdjustment,
  freshnessDecay,
  pickLead,
  rankArticles,
  type Rankable,
} from '../src/ranking';
import { roadClosurePin, severeWeatherPin } from '../src/write';

const now = new Date('2026-10-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const item = (id: string, over: Partial<Rankable> = {}): Rankable => ({
  id,
  beat: 'government',
  kind: 'story',
  tier: 2,
  newsworthiness: 50,
  publishedAt: hoursAgo(1),
  reviewed: false,
  ...over,
});

describe('freshness', () => {
  it('halves at the beat or kind half-life', () => {
    expect(freshnessDecay(item('a', { publishedAt: hoursAgo(48) }), now)).toBeCloseTo(0.5, 5);
    expect(
      freshnessDecay(item('a', { beat: 'public-safety', publishedAt: hoursAgo(12) }), now),
    ).toBeCloseTo(0.5, 5);
    expect(freshnessDecay(item('a', { kind: 'alert', publishedAt: hoursAgo(6) }), now)).toBeCloseTo(
      0.5,
      5,
    );
    expect(
      freshnessDecay(item('a', { beat: 'business', publishedAt: hoursAgo(72) }), now),
    ).toBeCloseTo(0.5, 5);
  });
});

describe('engagement', () => {
  const town = { impressions: 10_000, clicks: 500 }; // 5% average
  it('is neutral without data and capped at ±30%', () => {
    expect(engagementAdjustment(undefined, town)).toBe(1);
    expect(
      engagementAdjustment({ impressions: 10, clicks: 1 }, { impressions: 0, clicks: 0 }),
    ).toBe(1);
    expect(engagementAdjustment({ impressions: 10_000, clicks: 5_000 }, town)).toBe(1.3);
    expect(engagementAdjustment({ impressions: 10_000, clicks: 0 }, town)).toBe(0.7);
  });
  it('smooths small samples toward the average', () => {
    // 2 clicks from 20 impressions is a 10% CTR (2× average); smoothing pulls it to about 1.29×.
    const adj = engagementAdjustment({ impressions: 20, clicks: 2 }, town);
    expect(adj).toBeGreaterThan(1);
    expect(adj).toBeLessThan(1.3);
    // The same 10% over 2,000 impressions is trusted fully, so it hits the cap.
    expect(engagementAdjustment({ impressions: 2_000, clicks: 200 }, town)).toBe(1.3);
  });
});

describe('rankArticles', () => {
  it('orders by newsworthiness × freshness', () => {
    const ranked = rankArticles(
      [
        item('old-big', { newsworthiness: 90, publishedAt: hoursAgo(96) }), // 90 × 0.25
        item('new-small', { newsworthiness: 40, publishedAt: hoursAgo(1) }),
        item('new-big', { newsworthiness: 80, publishedAt: hoursAgo(1) }),
      ],
      { now },
    );
    expect(ranked.map((a) => a.id)).toEqual(['new-big', 'new-small', 'old-big']);
  });

  it('pins go first until they expire (the caller passes only unexpired pins)', () => {
    const ranked = rankArticles(
      [item('a', { newsworthiness: 90 }), item('pinned', { newsworthiness: 10 })],
      {
        now,
        pinned: new Set(['pinned']),
      },
    );
    expect(ranked[0]!.id).toBe('pinned');
  });

  it('never puts more than 2 from one beat in a row', () => {
    const ranked = rankArticles(
      [
        item('g1', { newsworthiness: 90 }),
        item('g2', { newsworthiness: 89 }),
        item('g3', { newsworthiness: 88 }),
        item('b1', { beat: 'business', newsworthiness: 10 }),
      ],
      { now },
    );
    expect(ranked.map((a) => a.id)).toEqual(['g1', 'g2', 'b1', 'g3']);
  });

  it('caps public safety at 20% of slots', () => {
    const items = [
      ...[1, 2, 3, 4].map((n) => item(`ps${n}`, { beat: 'public-safety', newsworthiness: 95 - n })),
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        item(`x${n}`, { beat: n % 2 ? 'government' : 'business', newsworthiness: 50 - n }),
      ),
    ];
    const ranked = rankArticles(items, { now, limit: 10 });
    expect(ranked.filter((a) => a.beat === 'public-safety')).toHaveLength(2);
    expect(ranked).toHaveLength(8);
  });

  it('the lead is Tier 1–2, or Tier 3 only when a person approved it', () => {
    const ranked = rankArticles(
      [
        item('t3', { tier: 3, newsworthiness: 99, beat: 'business' }),
        item('t2', { tier: 2, newsworthiness: 50 }),
      ],
      { now },
    );
    expect(pickLead(ranked)?.id).toBe('t2');
    expect(pickLead([{ ...ranked[0]!, reviewed: true }, ranked[1]!])?.id).toBe('t3');
  });
});

describe('auto-pins', () => {
  it('pins Severe and Extreme warnings until they end', () => {
    expect(severeWeatherPin({ severity: 'Moderate' }, now)).toBeNull();
    expect(severeWeatherPin({ severity: 'Severe', ends: '2026-10-15T20:00:00Z' }, now)).toEqual({
      reason: 'severe weather warning',
      expiresAt: new Date('2026-10-15T20:00:00Z'),
    });
    expect(severeWeatherPin({ severity: 'Extreme', ends: '2026-10-15T10:00:00Z' }, now)).toBeNull();
  });

  it('pins road-closure stories for 48 hours', () => {
    expect(
      roadClosurePin('Glades Road lane closures for utility work begin Oct. 26', now)?.reason,
    ).toBe('road closure');
    expect(roadClosurePin('City closes Palmetto Park Road bridge for repairs', now)).not.toBeNull();
    expect(roadClosurePin('Council approves paving contract', now)).toBeNull();
  });
});
