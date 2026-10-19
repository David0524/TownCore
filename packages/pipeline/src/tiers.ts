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
// A young person accused of a crime ("teen suspect", "minor charged"): the minor rule, so Tier 4
// until a reviewer overrides it (§7). From Kyle's sensitive-topic patterns (lib/intake/sensitive.ts).
const JUVENILE_DEFENDANT =
  /\b(?:teen|minor|youth|juvenile)s? (?:suspects?|defendants?|accused|charged|arrested)\b/i;

export function mentionsMinor(text: string): string | null {
  for (const pattern of AGE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const age = Number(match[1]);
      if (age > 0 && age < 18) return `age ${age} mentioned ("${match[0]}")`;
    }
  }
  const word = text.match(JUVENILE_DEFENDANT) ?? text.match(MINOR_WORDS);
  return word ? `"${word[0]}" mentioned` : null;
}

// Sensitive topics a model can miss, caught in code (a backstop to the classifier's flags; it
// only ever raises a tier). Patterns adapted from Kyle's lib/intake/sensitive.ts, checked over
// all the story's text (records and draft), not only the lede.
const SUICIDE =
  /\b(?:suicides?|suicidal|self[- ]harm|took (?:his|her|their) own life|self[- ]inflicted)\b/i;
const SEXUAL_OFFENCE =
  /\b(?:sexual(?:ly)? (?:assault(?:ed|s)?|battery|abused?|misconduct|exploitation)|rap(?:e|es|ed|ist)|molest(?:ed|ation|ing)?|sex(?:ual)? (?:crimes?|offen[cs]es?|offenders?)|lewd (?:and|or) lascivious|child (?:pornography|sexual abuse material)|(?:sex|human) trafficking)\b/i;
// What makes a victim identifiable even without a name: their age, their relationship to the
// accused, or where they live or study.
const VICTIM = /\b(?:victims?|survivors?|complainants?)\b/i;
const IDENTIFYING =
  /\b\d{1,3}-year-old\b|\b(?:his|her|their) (?:own )?(?:step)?(?:daughter|son|child|niece|nephew|granddaughter|grandson|cousin|wife|husband|girlfriend|boyfriend|ex-wife|ex-husband|neighbou?r|roommate|student|employee|co-?worker|patient|client|tenant)s?\b|\b\d+ block of\b|\b(?:who|that) (?:lives?|lived|attends?|attended|works?|worked) (?:on|at|in)\b/i;
const MISSING_CHILD =
  /\b(?:amber alert|missing (?:child|children|teen|teenager|girl|boy|juvenile|minor|student)s?|endangered missing|child abduction|abducted (?:child|girl|boy|teen))\b/i;

/** Topic notes reviewers see with the tier, and whether a victim may be identifiable. */
export function sensitiveTopics(text: string): { min: Tier; reason: string }[] {
  const out: { min: Tier; reason: string }[] = [];
  const suicide = text.match(SUICIDE);
  if (suicide) {
    out.push({
      min: 3,
      reason: `mentions suicide ("${suicide[0]}"): follow AP style (say "died by suicide", no method or note), and end with the 988 Suicide & Crisis Lifeline (call or text 988)`,
    });
  }
  const sexual = text.match(SEXUAL_OFFENCE);
  if (sexual) {
    const identifying = VICTIM.test(text) ? text.match(IDENTIFYING) : null;
    out.push(
      identifying
        ? {
            min: 4,
            reason: `sexual-assault victim may be identifiable ("${sexual[0]}", "${identifying[0]}")`,
          }
        : {
            min: 3,
            reason: `sexual offence ("${sexual[0]}"): check that nothing identifies a victim`,
          },
    );
  }
  const missing = text.match(MISSING_CHILD);
  if (missing) {
    out.push({
      min: 3,
      reason: `missing child or Amber Alert ("${missing[0]}"): publish only what the official alert says, and check it is still active`,
    });
  }
  return out;
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
  for (const topic of sensitiveTopics(text)) atLeast(topic.min, topic.reason);
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
