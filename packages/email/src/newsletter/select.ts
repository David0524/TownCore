import { publicSafetyShare } from '@towncore/config';

// Which stories go in an issue (docs/plans/M5.md; CLAUDE.md §6a): the homepage rank order,
// only stories published since the last issue, 5–8 of them, at least one civic item when one
// exists, and public safety held to its 20% share. Pure, so it is tested without a database.

export const ISSUE_MAX_ITEMS = 8;
/** D-M5-1: fewer new stories than this (and no weather alert) means no issue that day. */
export const ISSUE_MIN_ITEMS = 3;
export const CIVIC_BEATS: ReadonlySet<string> = new Set(['government', 'development', 'schools']);
const PUBLIC_SAFETY = 'public-safety';

type Item = { id: string; beat: string; publishedAt: Date };

export function selectIssueItems<T extends Item>(
  ranked: readonly T[],
  since: Date,
  max = ISSUE_MAX_ITEMS,
): T[] {
  const fresh = ranked.filter((a) => a.publishedAt > since);
  const safetyCap = Math.max(1, Math.floor(publicSafetyShare * max));
  const picked: T[] = [];
  let safety = 0;
  for (const a of fresh) {
    if (picked.length >= max) break;
    if (a.beat === PUBLIC_SAFETY) {
      if (safety >= safetyCap) continue;
      safety++;
    }
    picked.push(a);
  }
  // At least one civic item when one exists: it replaces the lowest-ranked non-civic pick.
  if (!picked.some((a) => CIVIC_BEATS.has(a.beat))) {
    const civic = fresh.find((a) => CIVIC_BEATS.has(a.beat));
    if (civic) {
      if (picked.length >= max) picked.pop();
      picked.push(civic);
    }
  }
  return picked;
}

export type SendDecision = { send: true } | { send: false; reason: string };

export function shouldSend(items: number, activeAlerts: number): SendDecision {
  if (items >= ISSUE_MIN_ITEMS || activeAlerts > 0) return { send: true };
  return {
    send: false,
    reason: `${items} new ${items === 1 ? 'story' : 'stories'} and no weather alert (needs ${ISSUE_MIN_ITEMS})`,
  };
}
