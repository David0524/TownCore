import type { Classification } from '@towncore/prompts';

/** A classifier answer with neutral defaults. */
export function classification(over: Partial<Classification> = {}): Classification {
  return {
    beat: 'government',
    about_this_town: true,
    town_evidence: 'City of Boca Raton',
    people: [],
    sensitive: {
      crime_or_public_safety: false,
      health: false,
      inspection_failure: false,
      accusatory: false,
      arrest_without_official_release: false,
      victim_of_sexual_assault: false,
      rumor_or_social_post: false,
    },
    impact: 0.5,
    novelty: 0.5,
    proximity: 0.5,
    proposed_tier: 2,
    reason: 'test',
    ...over,
  };
}
