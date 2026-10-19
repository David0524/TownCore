import type { Classification } from '@towncore/prompts';
import { describe, expect, it } from 'vitest';
import { scoreCandidate, timeliness, titleSimilarity } from '../src/scoring';
import { decideTier, mentionsMinor } from '../src/tiers';
import { apDate, isoLocalDate, localWeekStart, startOfLocalDay } from '../src/time';
import { classification } from './helpers';

const base = { sourceKinds: ['city_news' as const], beat: 'government', text: 'The council met.' };

describe('decideTier (deterministic overrides, §7)', () => {
  it('keeps the model tier when no rule applies', () => {
    expect(decideTier({ ...base, classification: classification() }).tier).toBe(2);
  });

  it('never lowers the model tier', () => {
    expect(decideTier({ ...base, classification: classification({ proposed_tier: 3 }) }).tier).toBe(
      3,
    );
  });

  it('police, fire and public-safety stories are at least Tier 3', () => {
    const c = classification({ proposed_tier: 1 });
    expect(decideTier({ ...base, sourceKinds: ['police'], classification: c }).tier).toBe(3);
    expect(decideTier({ ...base, sourceKinds: ['fire'], classification: c }).tier).toBe(3);
    expect(decideTier({ ...base, beat: 'public-safety', classification: c }).tier).toBe(3);
  });

  it('a named private person is at least Tier 3; officials and owners are not', () => {
    const person = (role: Classification['people'][number]['role']) =>
      classification({ proposed_tier: 1, people: [{ name: 'Pat Doe', role, context: '' }] });
    expect(decideTier({ ...base, classification: person('private_person') }).tier).toBe(3);
    expect(decideTier({ ...base, classification: person('public_official') }).tier).toBe(1);
    expect(decideTier({ ...base, classification: person('business_owner') }).tier).toBe(1);
  });

  it('a named minor is Tier 4, overridable by a reviewer', () => {
    const d = decideTier({
      ...base,
      classification: classification({ people: [{ name: 'A B', role: 'minor', context: '' }] }),
    });
    expect(d).toMatchObject({ tier: 4, minorOverridable: true });
  });

  it('an age under 18 in the text is Tier 4 even if the model missed it', () => {
    const d = decideTier({
      ...base,
      classification: classification({ proposed_tier: 1 }),
      text: 'Police said Jordan Smith, 16, was taken to the hospital.',
    });
    expect(d).toMatchObject({ tier: 4, minorOverridable: true });
  });

  it('arrests without a release, assault victims and rumors are Tier 4 and not overridable', () => {
    for (const key of [
      'arrest_without_official_release',
      'victim_of_sexual_assault',
      'rumor_or_social_post',
    ] as const) {
      const c = classification();
      c.sensitive[key] = true;
      expect(
        decideTier({ ...base, classification: c, text: 'A juvenile was named.' }),
      ).toMatchObject({ tier: 4, minorOverridable: false });
    }
  });

  it('health, inspection failures and accusations are at least Tier 3', () => {
    for (const key of [
      'health',
      'inspection_failure',
      'accusatory',
      'crime_or_public_safety',
    ] as const) {
      const c = classification({ proposed_tier: 1 });
      c.sensitive[key] = true;
      expect(decideTier({ ...base, classification: c }).tier).toBe(3);
    }
  });

  describe('sensitive topics the model missed (code backstop, only raises)', () => {
    const tierFor = (text: string, proposed: 1 | 2 | 3 = 1) =>
      decideTier({ ...base, classification: classification({ proposed_tier: proposed }), text });

    it('suicide is at least Tier 3, with an AP style and 988 note for the reviewer', () => {
      const d = tierFor('The medical examiner ruled the death a suicide.');
      expect(d.tier).toBe(3);
      expect(d.reasons.at(-1)).toMatch(/^mentions suicide \("suicide"\).*988 Suicide & Crisis/);
      expect(tierFor('He took his own life in 2019, the family said.').tier).toBe(3);
    });

    it('a sexual offence is at least Tier 3; Tier 4, not overridable, when a victim may be identifiable', () => {
      const charged = tierFor('Police charged a Boca Raton man with sexual battery on Friday.');
      expect(charged).toMatchObject({ tier: 3, minorOverridable: false });
      expect(charged.reasons.at(-1)).toMatch(/^sexual offence \("sexual battery"\)/);
      for (const text of [
        'The victim, a 24-year-old woman, reported the assault. He faces a rape charge.',
        'He is charged with lewd and lascivious molestation of a victim, his stepdaughter.',
        'Police said the victim, who lives in the 400 block of NE 5th Street, was sexually assaulted.',
      ]) {
        const d = tierFor(text);
        expect(d, text).toMatchObject({ tier: 4, minorOverridable: false });
        expect(
          d.reasons.some((r) => r.startsWith('sexual-assault victim may be identifiable')),
        ).toBe(true);
      }
      // Without an offence, a "victim" with an age is ordinary crime news (Tier 3 by other rules).
      expect(tierFor('The victim, a 30-year-old man, was robbed.').tier).toBe(1);
      // "Human trafficking" is a sexual-offence topic; drug trafficking is not.
      expect(tierFor('Deputies arrested two men on human trafficking charges.').tier).toBe(3);
      expect(tierFor('Deputies arrested two men on drug trafficking charges.').tier).toBe(1);
    });

    it('a missing child or Amber Alert goes to review, at least Tier 3', () => {
      const d = tierFor('Police issued an Amber Alert on Tuesday night.', 2);
      expect(d.tier).toBe(3);
      expect(d.reasons.at(-1)).toMatch(/^missing child or Amber Alert/);
      expect(tierFor('Officers are searching for a missing child near Mizner Park.').tier).toBe(3);
      // A missing child's age is a minor named: Tier 4 until a reviewer overrides it (§7).
      expect(
        tierFor('Police said the missing girl is 14 years old and was last seen Monday.'),
      ).toMatchObject({ tier: 4, minorOverridable: true });
    });

    it('never lowers a tier and leaves ordinary civic text alone', () => {
      expect(tierFor('The suicide prevention walk raised $4,000.', 3).tier).toBe(3);
      expect(tierFor('The council approved a grape festival and a rapid transit study.').tier).toBe(
        1,
      );
    });
  });
});

describe('mentionsMinor', () => {
  it.each([
    ['a 15-year-old boy', true],
    ['the girl, age 12, was', true],
    ['Jordan Smith (16) of Boca Raton', true],
    ['Pat Lee, 17, was cited', true],
    ['two juveniles were detained', true],
    ['two teens were cited', true],
    ['a teen suspect was detained', true],
    ['police said the minor charged in the case', true],
    ['a youth arrested Friday', true],
    ['two minor charges were dropped', false],
    ['a 45-year-old man', false],
    ['Agenda item (2) and Route 16', false],
    ['the teen center on Main Street reopened', false],
    ['Resolution 16, 2026', false],
  ])('%s → %s', (text, expected) => {
    expect(Boolean(mentionsMinor(text))).toBe(expected);
  });
});

describe('scoring', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('timeliness decays over three days and favors the next two days', () => {
    expect(timeliness(now, now)).toBe(1);
    expect(timeliness(new Date('2026-10-14T00:00:00Z'), now)).toBeCloseTo(0.5, 2);
    expect(timeliness(new Date('2026-10-01T00:00:00Z'), now)).toBe(0.1);
    expect(timeliness(new Date('2026-10-16T12:00:00Z'), now)).toBe(1);
    expect(timeliness(new Date('2026-10-20T12:00:00Z'), now)).toBe(0.7);
    expect(timeliness(null, now)).toBe(0.5);
  });

  it('weights components and applies penalties', () => {
    const input = {
      classification: classification({ impact: 1, novelty: 1, proximity: 1 }),
      occurredAt: now,
      sourceChars: 2000,
      duplicate: false,
      degradedSource: false,
      now,
    };
    // 30 + 20 + 15 + 10 + 25 × 0.6 (government prior) = 90
    expect(scoreCandidate(input).score).toBe(90);
    expect(scoreCandidate({ ...input, duplicate: true }).score).toBe(60);
    expect(scoreCandidate({ ...input, sourceChars: 500 }).score).toBe(80);
    expect(scoreCandidate({ ...input, degradedSource: true }).score).toBe(80);
  });

  it('titleSimilarity spots the same story', () => {
    expect(
      titleSimilarity('City Council approves 2027 budget', 'Council approves the 2027 city budget'),
    ).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity('Beach parking rates rise', 'Library hours change')).toBe(0);
  });
});

describe('town-local time', () => {
  const tz = 'America/New_York';
  it('finds the local day and Monday week start', () => {
    // Thu Oct 15 2026, 9 pm in Boca = 01:00 UTC Fri.
    const now = new Date('2026-10-16T01:00:00Z');
    expect(isoLocalDate(now, tz)).toBe('2026-10-15');
    expect(startOfLocalDay(now, tz).toISOString()).toBe('2026-10-15T04:00:00.000Z');
    expect(localWeekStart(now, tz).toISOString()).toBe('2026-10-12T04:00:00.000Z');
    expect(localWeekStart(now, tz, 1).toISOString()).toBe('2026-10-19T04:00:00.000Z');
    expect(localWeekStart(now, tz, -1).toISOString()).toBe('2026-10-05T04:00:00.000Z');
  });

  it('handles the end of daylight saving time', () => {
    // DST ends Sun Nov 1 2026; the next Monday starts at 05:00 UTC.
    const now = new Date('2026-10-31T16:00:00Z');
    expect(localWeekStart(now, tz, 1).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(apDate(new Date('2026-09-03T16:00:00Z'), tz)).toBe('Sept. 3');
    expect(apDate(new Date('2026-05-03T16:00:00Z'), tz)).toBe('May 3');
  });
});
