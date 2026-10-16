import type { BeatSlug } from './theme';

// Evergreen guides (CLAUDE.md §6a, §10 step 6; docs/plans/M4.md §5, D-M4-2). One reusable topic
// list for the whole network; each town maps the topics it covers to official pages in its YAML
// (`guides:`). Guides are written only from those pages, never from other outlets (Rule 3).

export type GuideTopic = {
  key: string;
  /** Working title, for the writer and the admin; the published headline is the writer's. */
  title: string;
  beat: BeatSlug;
  /** What a resident wants from the guide; steers the writer toward the useful facts. */
  need: string;
};

export const guideTopics = [
  {
    key: 'trash-pickup',
    title: 'Trash pickup',
    beat: 'community',
    need: 'collection days, containers and where to put them, what is not accepted, missed pickups',
  },
  {
    key: 'recycling',
    title: 'Recycling',
    beat: 'community',
    need: 'what goes in the recycling bin, what does not, collection day and how to get a bin',
  },
  {
    key: 'bulk-waste',
    title: 'Bulk trash and yard waste',
    beat: 'community',
    need: 'what counts as bulk, size limits, how to set it out, paid pickups and fees',
  },
  {
    key: 'holiday-sanitation',
    title: 'Holiday trash schedule',
    beat: 'community',
    need: 'which holidays change collection and how the schedule shifts',
  },
  {
    key: 'hurricane-prep',
    title: 'Hurricane preparedness',
    beat: 'public-safety',
    need: 'how to prepare, supplies, shutters, where official updates come from',
  },
  {
    key: 'evacuation',
    title: 'Evacuation zones and shelters',
    beat: 'public-safety',
    need: 'how to find your zone, when to leave, shelters and special-needs registration',
  },
  {
    key: 'storm-debris',
    title: 'Storm debris after a hurricane',
    beat: 'community',
    need: 'how storm debris is collected, how to sort and place it, what is not picked up',
  },
  {
    key: 'flood-zones',
    title: 'Flood zones and flood insurance',
    beat: 'development',
    need: 'how to look up a flood zone, what the zones mean, flood insurance and protection',
  },
  {
    key: 'emergency-alerts',
    title: 'Emergency alerts',
    beat: 'public-safety',
    need: 'how to sign up for official alerts and what each alert service sends',
  },
  {
    key: 'building-permits',
    title: 'Building permits',
    beat: 'development',
    need: 'when a permit is needed, how to apply, plan review, inspections and closeout',
  },
  {
    key: 'hire-a-contractor',
    title: 'Hiring a licensed contractor',
    beat: 'development',
    need: 'how to check a license, what to ask, and how permits protect the owner',
  },
  {
    key: 'permit-search',
    title: 'Looking up permits and code cases',
    beat: 'development',
    need: 'how to search permit history and code cases for an address',
  },
  {
    key: 'parking',
    title: 'Parking',
    beat: 'community',
    need: 'where and how to park, payment, rates and rules',
  },
  {
    key: 'parking-tickets',
    title: 'Paying or contesting a parking ticket',
    beat: 'community',
    need: 'how to pay a citation, deadlines, fines and how to contest one',
  },
  {
    key: 'beach-parks',
    title: 'Beach parks',
    beat: 'community',
    need: 'which beach parks there are, hours, entry fees, amenities and rules',
  },
  {
    key: 'beach-permits',
    title: 'Beach, dog and boat permits',
    beat: 'community',
    need: 'who can get each permit, prices, how to apply or renew',
  },
  {
    key: 'pets',
    title: 'Pets and dog parks',
    beat: 'community',
    need: 'dog parks and dog beaches, rules, permits and pet licensing',
  },
  {
    key: 'voting',
    title: 'Voting and elections',
    beat: 'government',
    need: 'upcoming elections, how to register, where and when to vote, what is on the ballot',
  },
  {
    key: 'council-meetings',
    title: 'City council meetings and public comment',
    beat: 'government',
    need: 'when the council meets, where to find agendas and video, how to speak',
  },
  {
    key: 'public-records',
    title: 'Public records requests',
    beat: 'government',
    need: 'how to request records, what it costs and how long it takes',
  },
  {
    key: 'report-a-concern',
    title: 'Reporting a problem to the city',
    beat: 'government',
    need: 'how to report potholes, streetlights, code problems and other issues',
  },
  {
    key: 'code-enforcement',
    title: 'Code enforcement',
    beat: 'government',
    need: 'what code enforcement handles, how complaints work and what happens next',
  },
  {
    key: 'water-billing',
    title: 'Water and utility bills',
    beat: 'community',
    need: 'how to start or stop service, pay a bill, payment options and help paying',
  },
  {
    key: 'water-restrictions',
    title: 'Watering rules and water conservation',
    beat: 'community',
    need: 'lawn watering days and hours, conservation programs and rebates',
  },
  {
    key: 'boil-water-notices',
    title: 'Boil water notices',
    beat: 'public-safety',
    need: 'what a notice means, what to do, how to find out if your address is affected',
  },
  {
    key: 'water-quality',
    title: 'Drinking water quality',
    beat: 'community',
    need: 'where the water comes from, the annual water quality report and contacts',
  },
  {
    key: 'library-card',
    title: 'Getting a library card',
    beat: 'community',
    need: 'who can get a card, what to bring, fees, branches and digital services',
  },
  {
    key: 'recreation-registration',
    title: 'Signing up for recreation programs',
    beat: 'community',
    need: 'how to create an account, register for classes, fees and residency rules',
  },
  {
    key: 'camps',
    title: 'Youth camps',
    beat: 'community',
    need: 'which camps run when, ages, how and when to register',
  },
  {
    key: 'tennis-pickleball',
    title: 'Tennis and pickleball',
    beat: 'community',
    need: 'courts, hours, fees, passes, reservations, lessons and open play',
  },
  {
    key: 'golf',
    title: 'Public golf',
    beat: 'community',
    need: 'public courses, rates, tee times and programs',
  },
  {
    key: 'business-tax-receipt',
    title: 'Business tax receipts',
    beat: 'business',
    need: 'who needs one, how to apply or renew, fees and deadlines',
  },
  {
    key: 'garage-sales',
    title: 'Garage sale permits',
    beat: 'community',
    need: 'whether a permit is needed, how often sales are allowed, signs and fees',
  },
  {
    key: 'special-events',
    title: 'Special event permits',
    beat: 'community',
    need: 'which events need a permit, how far ahead to apply, fees and requirements',
  },
  {
    key: 'fertilizer-rules',
    title: 'Fertilizer rules',
    beat: 'community',
    need: 'when fertilizer is restricted, what is allowed and why',
  },
  {
    key: 'alarm-permits',
    title: 'Alarm permits and false alarms',
    beat: 'public-safety',
    need: 'whether an alarm permit is required, fees and false alarm charges',
  },
  {
    key: 'stormwater',
    title: 'Stormwater and drainage',
    beat: 'development',
    need: 'how drainage works, what residents can do, and how to report flooding or blocked drains',
  },
  {
    key: 'property-tax',
    title: 'Property taxes and homestead exemption',
    beat: 'government',
    need: 'how to apply for homestead and other exemptions, deadlines, and how to pay the tax bill',
  },
  {
    key: 'schools-enrollment',
    title: 'Public school enrollment',
    beat: 'schools',
    need: 'how to find the assigned school, what documents to bring and how to enroll',
  },
  {
    key: 'shuttles',
    title: 'Free shuttles and getting around',
    beat: 'community',
    need: 'which shuttles run, routes, hours and how to ride',
  },
] as const satisfies readonly GuideTopic[];

export type GuideTopicKey = (typeof guideTopics)[number]['key'];

export const guideTopicKeys = guideTopics.map((t) => t.key) as [GuideTopicKey, ...GuideTopicKey[]];

export function guideTopic(key: string): GuideTopic | undefined {
  return guideTopics.find((t) => t.key === key);
}

/**
 * Guides go to review until a town has this many published (D-M4-2: "the first batch for each
 * town goes to review"); after that, a guide that passes fact-check publishes as Tier 1.
 */
export const FIRST_GUIDE_BATCH = 30;
