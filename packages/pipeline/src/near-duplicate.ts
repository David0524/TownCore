import { NEAR_DUP_SHINGLE_WORDS } from '@towncore/config';

// The near-duplicate measure (owner, 2026-10-17): how much of one town's text another town's
// version of the same template repeats. Each text is normalized so swapping the town's name or
// figures doesn't hide a shared template: the given names (towns, sites, agencies) become one
// token, every number becomes "#", markdown and punctuation go. Then it's cut into overlapping
// runs of NEAR_DUP_SHINGLE_WORDS words ("shingles"), and the score is the shared shingles over
// the smaller text's shingles (0 = nothing in common, 1 = one text is contained in the other).

/** Lowercased words with names masked as "town" and numbers as "#". */
export function normalizeWords(text: string, names: string[]): string[] {
  let t = text.toLowerCase();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name.trim()) t = t.split(name.toLowerCase()).join(' town ');
  }
  return t
    .replace(/\]\([^)]*\)/g, ' ') // markdown link targets
    .replace(/[0-9][0-9,.:]*/g, ' # ')
    .replace(/[^a-z#'’ ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function shingles(words: string[], size = NEAR_DUP_SHINGLE_WORDS): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

/** Share of the smaller text's shingles the other text also has (0–1). */
export function nearDuplicateShare(
  a: { text: string; names: string[] },
  b: { text: string; names: string[] },
  size = NEAR_DUP_SHINGLE_WORDS,
): number {
  const sa = shingles(normalizeWords(a.text, a.names), size);
  const sb = shingles(normalizeWords(b.text, b.names), size);
  const smaller = sa.size <= sb.size ? sa : sb;
  const larger = smaller === sa ? sb : sa;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const s of smaller) if (larger.has(s)) shared++;
  return shared / smaller.size;
}
