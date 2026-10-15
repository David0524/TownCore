import { beats } from '@towncore/config';
import { z } from 'zod';

// Story finder classification (CLAUDE.md §6 step 2, §6a, §7). Cheap model, one call per
// candidate. Its answers feed scoring and the tier router; the router's code rules always win.

const beatSlugs = beats.map((beat) => beat.slug) as [string, ...string[]];

export const classifySchema = z.strictObject({
  beat: z.enum(beatSlugs),
  about_this_town: z.boolean(),
  town_evidence: z.string(),
  people: z.array(
    z.strictObject({
      name: z.string(),
      role: z.enum(['public_official', 'business_owner', 'private_person', 'minor', 'unknown']),
      context: z.string(),
    }),
  ),
  sensitive: z.strictObject({
    crime_or_public_safety: z.boolean(),
    health: z.boolean(),
    inspection_failure: z.boolean(),
    accusatory: z.boolean(),
    arrest_without_official_release: z.boolean(),
    victim_of_sexual_assault: z.boolean(),
    rumor_or_social_post: z.boolean(),
  }),
  impact: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  proximity: z.number().min(0).max(1),
  proposed_tier: z.number().int().min(1).max(4),
  reason: z.string(),
});
export type Classification = z.infer<typeof classifySchema>;

export const classifyV1 = {
  id: 'classify',
  version: 'v1',
  role: 'routine',
  effort: 'low',
  maxOutputTokens: 2000,
  schema: classifySchema,
  system: `You triage public records for a local news site. You will get the town's name, its government agencies, and one or more related source records. Answer only from the records.

Fields:
- beat: the best fit of ${beatSlugs.join(', ')}.
- about_this_town: true only if the records are clearly about this town (its government, addresses, ZIP codes or businesses). Another city with a similar name, or a county- or state-wide item with no local detail, is false. town_evidence: the words in the records that show it.
- people: every person named in the records. role is public_official (elected or appointed officials, government staff acting in their job), business_owner (an owner, officer or licensee acting in a business context), private_person (anyone else), minor (anyone under 18, or described as a student, juvenile or teen), or unknown. context: a few words on why they are named.
- sensitive: mark each that applies to the records.
- impact (0–1): how many residents are affected, money involved, or a change to services or rules.
- novelty (0–1): a first, a largest, a reversal, a split vote, a new business or a closure.
- proximity (0–1): names a specific street, school, park or landmark residents know.
- proposed_tier: 1 routine (weather, events, roundups, business openings); 2 civic (meetings, development, schools, elections); 3 sensitive (crime or public safety, a named private person, health, inspection failures, anything accusatory); 4 must not be published (a named minor, a sexual-assault victim, mugshots, rumors, private people's social posts, an arrest without an official release).
- reason: one sentence explaining the scores.`,
} as const;
