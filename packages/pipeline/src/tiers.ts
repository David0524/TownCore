import type { SourceKind } from '@towncore/config';
import type { Classification } from '@towncore/prompts';

// Deterministic tier rules (CLAUDE.md §7: "code, not prompts"). The model's proposed tier is
// only ever raised by these rules, never lowered: the stricter tier wins.

export type Tier = 1 | 2 | 3 | 4;

export type TierDecision = {
  tier: Tier;
  /** Why the tier is what it is; shown to reviewers. */
  reasons: string[];
  /** Tier 4 because a minor may be named: a reviewer may override (§7). */
  minorOverridable: boolean;
};

// Ages under 18 written out ("15-year-old", "age 16", "16 years old").
const AGE_PATTERNS = [
  /\b(\d{1,2})[-\s]years?[-\s]old\b/gi,
  /\bage(?:d)?\s+(\d{1,2})\b/gi,
  // A name followed by an age, as police releases write it: "John Smith (16)", "John Smith, 16,".
  /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+,? \((\d{1,2})\)/g,
  /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+, (\d{1,2}),/g,
];
const MINOR_WORDS =
  /\b(juvenile|juveniles|minor child|teenagers?|teens|teen-?aged?|student-athlete|high school student|middle school student)\b/i;

export function mentionsMinor(text: string): string | null {
  for (const pattern of AGE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const age = Number(match[1]);
      if (age > 0 && age < 18) return `age ${age} mentioned ("${match[0]}")`;
    }
  }
  const word = text.match(MINOR_WORDS);
  return word ? `"${word[0]}" mentioned` : null;
}

export function decideTier(input: {
  sourceKinds: SourceKind[];
  beat: string;
  classification: Classification | null;
  /** All text the story is based on (records, and the draft once there is one). */
  text: string;
  /** Starting tier when there is no classification (templated items). Default 2. */
  baseTier?: Tier;
}): TierDecision {
  const { sourceKinds, beat, classification: c, text } = input;
  const reasons: string[] = [];
  let tier: Tier = (c?.proposed_tier as Tier | undefined) ?? input.baseTier ?? 2;
  let minorOverridable = false;
  if (c) reasons.push(`model proposed Tier ${c.proposed_tier}`);
  const atLeast = (min: Tier, reason: string) => {
    reasons.push(reason);
    if (tier < min) tier = min;
  };

  if (sourceKinds.some((k) => k === 'police' || k === 'fire') || beat === 'public-safety') {
    atLeast(3, 'police, fire or public-safety story');
  }
  // Nursing-home inspections and penalties name a facility with health findings, whatever they
  // found (§7: health, inspection failures).
  if (sourceKinds.includes('health_facilities')) {
    atLeast(3, 'health inspection findings at a named facility');
  }
  if (c) {
    for (const person of c.people) {
      if (person.role === 'private_person') atLeast(3, `names a private person (${person.name})`);
      if (person.role === 'minor') {
        atLeast(4, `names a minor (${person.name})`);
        minorOverridable = true;
      }
    }
    const s = c.sensitive;
    if (s.crime_or_public_safety) atLeast(3, 'crime or public safety');
    if (s.health) atLeast(3, 'health');
    if (s.inspection_failure) atLeast(3, 'inspection failure');
    if (s.accusatory) atLeast(3, 'accusatory');
    if (s.arrest_without_official_release) atLeast(4, 'arrest without an official release');
    if (s.victim_of_sexual_assault) atLeast(4, 'sexual-assault victim');
    if (s.rumor_or_social_post) atLeast(4, "rumor or a private person's social post");
  }
  const minor = mentionsMinor(text);
  if (minor) {
    atLeast(4, `possible minor: ${minor}`);
    minorOverridable = true;
  }
  // Only the minor rule may be overridden; any other Tier 4 reason keeps it blocked.
  const otherTier4 = reasons.some(
    (r) =>
      r.startsWith('arrest without') || r.startsWith('sexual-assault') || r.startsWith('rumor'),
  );
  return { tier, reasons, minorOverridable: tier === 4 && minorOverridable && !otherTier4 };
}

/** Source kinds that may never be the basis of a full article (Rule 3). */
export function cannotBeArticle(sourceKinds: SourceKind[]): boolean {
  return sourceKinds.length > 0 && sourceKinds.every((kind) => kind === 'other_outlet');
}
