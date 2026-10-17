// Site names (CLAUDE.md §10b). Three proposals per town from rotating patterns, never a pattern a
// town within 50 miles already uses, each with its .com and the conflict checks. The owner picks
// one in the launch report; nothing is bought without `--approve-spend`.

export const namePatterns = [
  { key: 'town-square', label: '{Town} Town Square' },
  { key: 'ledger', label: 'The {Town} Ledger' },
  { key: 'daily', label: '{Town} Daily' },
  { key: 'local', label: '{Town} Local' },
  { key: 'courier', label: '{Town} Courier' },
  { key: 'post', label: 'The {Nickname} Post' },
  // Added 2026-10-17 (owner), so the 50-mile neighbor rule doesn't cap dense metros.
  { key: 'dispatch', label: '{Town} Dispatch' },
  { key: 'journal', label: '{Town} Journal' },
  { key: 'chronicle', label: '{Town} Chronicle' },
  { key: 'observer', label: '{Town} Observer' },
  { key: 'sentinel', label: '{Town} Sentinel' },
  { key: 'beacon', label: '{Town} Beacon' },
  { key: 'bulletin', label: '{Town} Bulletin' },
  { key: 'record', label: '{Town} Record' },
  { key: 'report', label: '{Town} Report' },
  { key: 'current', label: '{Town} Current' },
  { key: 'today', label: '{Town} Today' },
  { key: 'signal', label: '{Town} Signal' },
  { key: 'tribune', label: '{Town} Tribune' },
  { key: 'herald', label: '{Town} Herald' },
  { key: 'gazette', label: '{Town} Gazette' },
  { key: 'standard', label: 'The {Town} Standard' },
] as const;
export type NamePattern = (typeof namePatterns)[number]['key'];

export const NEIGHBOR_MILES = 50;

export function siteNameFor(pattern: NamePattern, town: string): string {
  return namePatterns.find((p) => p.key === pattern)!.label.replace(/\{Town\}|\{Nickname\}/, town);
}

/** Which pattern an existing site name follows ("Boca Town Square" → town-square). */
export function patternOf(siteName: string): NamePattern | null {
  const s = siteName.trim();
  for (const p of namePatterns) {
    const re = new RegExp(
      `^${p.label.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(?:Town|Nickname)\}/, '.+')}$`,
      'i',
    );
    if (re.test(s)) return p.key;
  }
  return null;
}

/** "The Delray Ledger" → delrayledger.com and thedelrayledger.com (no hyphens or numbers). */
export function domainsFor(siteName: string): string[] {
  const alnum = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  const withoutThe = siteName.replace(/^the\s+/i, '');
  return [...new Set([`${alnum(withoutThe)}.com`, `${alnum(siteName)}.com`])];
}

/** Words that would make a site sound like the government (§10b "sounds official"). */
const OFFICIAL =
  /\b(city of|town of|village of|county|official|gov|government|municipal|department|dept|police|sheriff|fire rescue|chamber of commerce)\b/i;

export function officialSounding(siteName: string, domain: string): string | null {
  const hit = siteName.match(OFFICIAL)?.[0] ?? (/(gov|official)/.test(domain) ? domain : null);
  return hit ? `sounds official ("${hit}")` : null;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/**
 * A current or defunct local outlet the name matches or closely resembles (§10b): the same words
 * once "The" and punctuation are dropped, or nearly the same spelling (90% alike).
 */
export function resemblesOutlet(siteName: string, outlets: string[]): string | null {
  const name = normalize(siteName);
  for (const outlet of outlets) {
    const o = normalize(outlet);
    if (!o) continue;
    const similarity = 1 - levenshtein(name, o) / Math.max(name.length, o.length);
    if (name === o || similarity >= 0.9) return `resembles the local outlet "${outlet}"`;
  }
  return null;
}

export type NameProposalInput = {
  /** The town as readers say it: "Delray" or "Delray Beach". */
  townWord: string;
  nickname?: string;
  /** Patterns used by towns within 50 miles: never reused (neighbor rule). */
  nearbyPatterns: NamePattern[];
  /** How often each pattern is used network-wide, to rotate the least used first. */
  networkUse: Partial<Record<NamePattern, number>>;
};

/** The candidate names, best first: unused nearby, then least used network-wide. */
export function nameCandidates(
  input: NameProposalInput,
): Array<{ pattern: NamePattern; siteName: string }> {
  return namePatterns
    .map((p, order) => ({ pattern: p.key, order }))
    .filter((p) => !input.nearbyPatterns.includes(p.pattern))
    .filter((p) => p.pattern !== 'post' || !!input.nickname)
    .sort(
      (a, b) =>
        (input.networkUse[a.pattern] ?? 0) - (input.networkUse[b.pattern] ?? 0) ||
        a.order - b.order,
    )
    .map((p) => ({
      pattern: p.pattern,
      siteName: siteNameFor(p.pattern, p.pattern === 'post' ? input.nickname! : input.townWord),
    }));
}
