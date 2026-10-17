import {
  engagementCap,
  engagementSmoothing,
  freshnessHalfLifeHours,
  maxSameBeatInARow,
  publicSafetyShare,
} from '@towncore/config';

// Homepage and section ranking (CLAUDE.md §6a):
//   rank = newsworthiness × freshness_decay(beat) × engagement_adjustment + pin_boost
// then diversity rules: at most 2 in a row from one beat, public safety at most 20% of slots.
// Pure functions: the web app loads the inputs and the newsletter (M5) reuses the same order.
// Sponsored content is not an input, so it can never change editorial rank.

export type Rankable = {
  id: string;
  beat: string;
  kind: string;
  tier: number;
  /** 0–100 from the story finder; null for items built in code. */
  newsworthiness: number | null;
  publishedAt: Date;
  /** A person approved it (needed for a Tier 3 lead). */
  reviewed: boolean;
};

export type Engagement = { impressions: number; clicks: number };

/** Newsworthiness for items without a story-finder score (roundups, alerts, guides). */
const DEFAULT_NEWSWORTHINESS: Record<string, number> = {
  alert: 70,
  roundup: 50,
  guide: 40,
  story: 50,
};
export const PIN_BOOST = 1000;

export function halfLifeHours(item: Pick<Rankable, 'kind' | 'beat'>): number {
  return (
    freshnessHalfLifeHours.kind[item.kind] ??
    freshnessHalfLifeHours.beat[item.beat] ??
    freshnessHalfLifeHours.default
  );
}

export function freshnessDecay(item: Pick<Rankable, 'kind' | 'beat' | 'publishedAt'>, now: Date) {
  const ageHours = Math.max(0, (now.getTime() - item.publishedAt.getTime()) / 3_600_000);
  return 0.5 ** (ageHours / halfLifeHours(item));
}

/**
 * Smoothed click-through rate relative to the town average, capped at ±30% so clicks can't
 * bury important civic news. 1.0 when the town has no click data yet.
 */
export function engagementAdjustment(item: Engagement | undefined, town: Engagement): number {
  if (!item || town.impressions === 0 || town.clicks === 0) return 1;
  const townCtr = town.clicks / town.impressions;
  const smoothed =
    (item.clicks + engagementSmoothing * townCtr) / (item.impressions + engagementSmoothing);
  const ratio = smoothed / townCtr;
  return Math.min(1 + engagementCap, Math.max(1 - engagementCap, ratio));
}

export function rankScore(
  item: Rankable,
  opts: { now: Date; engagement?: Engagement; town: Engagement; pinned: boolean },
): number {
  const nw = item.newsworthiness ?? DEFAULT_NEWSWORTHINESS[item.kind] ?? 50;
  return (
    nw * freshnessDecay(item, opts.now) * engagementAdjustment(opts.engagement, opts.town) +
    (opts.pinned ? PIN_BOOST : 0)
  );
}

/**
 * Orders items by rank, then applies the diversity rules: no more than 2 consecutive items from
 * one beat, and public safety at most 20% of the slots (rounded up for short lists, so a list
 * of 1–5 can show one). Items held back by a rule move down, never out, unless only they remain
 * past the public-safety cap.
 */
export function rankArticles<T extends Rankable>(
  items: T[],
  opts: {
    now: Date;
    engagement?: Map<string, Engagement>;
    pinned?: Set<string>;
    limit?: number;
    /** Apply the beat-run and public-safety rules (homepage); off for a single beat's page. */
    diversity?: boolean;
  },
): T[] {
  const town = [...(opts.engagement?.values() ?? [])].reduce(
    (acc, e) => ({ impressions: acc.impressions + e.impressions, clicks: acc.clicks + e.clicks }),
    { impressions: 0, clicks: 0 },
  );
  const scored = items
    .map((item) => ({
      item,
      score: rankScore(item, {
        now: opts.now,
        engagement: opts.engagement?.get(item.id),
        town,
        pinned: opts.pinned?.has(item.id) ?? false,
      }),
    }))
    .sort(
      (a, b) => b.score - a.score || b.item.publishedAt.getTime() - a.item.publishedAt.getTime(),
    );

  const limit = Math.min(opts.limit ?? scored.length, scored.length);
  if (opts.diversity === false) return scored.slice(0, limit).map((x) => x.item);
  const publicSafetyCap = Math.max(1, Math.ceil(limit * publicSafetyShare));
  const out: T[] = [];
  const remaining = [...scored];
  let publicSafety = 0;
  while (out.length < limit && remaining.length > 0) {
    const lastBeats = out.slice(-maxSameBeatInARow).map((a) => a.beat);
    const runOf = (beat: string) =>
      lastBeats.length === maxSameBeatInARow && lastBeats.every((b) => b === beat);
    const allowed = (x: (typeof remaining)[number]) =>
      !runOf(x.item.beat) && (x.item.beat !== 'public-safety' || publicSafety < publicSafetyCap);
    let index = remaining.findIndex(allowed);
    if (index === -1) {
      // Only items breaking the same-beat rule are left: take them rather than leave slots
      // empty. Public safety past its cap is never added.
      index = remaining.findIndex(
        (x) => x.item.beat !== 'public-safety' || publicSafety < publicSafetyCap,
      );
      if (index === -1) break;
    }
    const [next] = remaining.splice(index, 1);
    if (next!.item.beat === 'public-safety') publicSafety++;
    out.push(next!.item);
  }
  return out;
}

/** A story that may lead: Tier 1–2, or Tier 3 only when a person approved it. */
export const leadEligible = (a: Pick<Rankable, 'tier' | 'reviewed'>) =>
  a.tier <= 2 || (a.tier === 3 && a.reviewed);

/**
 * The lead story: the highest-ranked eligible item. With `pictured`, only one whose cover is a
 * picture (owner, 2026-10-17: a story with only the title card is never the cover story); rank
 * itself never changes, only who takes the lead slot.
 */
export function pickLead<T extends Rankable>(
  ranked: T[],
  pictured?: (item: T) => boolean,
): T | undefined {
  return ranked.find((a) => leadEligible(a) && (!pictured || pictured(a)));
}
