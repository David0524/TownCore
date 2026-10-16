import type { BeatSlug } from './theme';

// Evergreen guides (CLAUDE.md §6a, §10 step 6; docs/plans/M4.md §5, D-M4-2). One reusable topic
// list for the whole network; each town maps the topics it covers to official pages in its YAML
// (`guides:`). Guides are written only from those pages, never from other outlets (Rule 3).

// Topics use civic beats only: the public-safety beat means police and fire news (§7 tiers), and
// a guide to hurricane supplies or boil-water notices is neither.
export type GuideTopic = {
  key: string;
  /** Working title, for the writer and the admin; the published headline is the writer's. */
  title: string;
  beat: BeatSlug;
  /** What a resident wants from the guide; steers the writer toward the useful facts. */
  need: string;
  /**
   * Stock photo search (Unsplash, §11c): objects only, never the town, people or an event, so a
   * generic photo can't pass for the actual scene.
   */
  photo: string;
};

export const guideTopics = [
  {
    key: 'trash-pickup',
    title: 'Trash pickup',
    beat: 'community',
    need: 'collection days, containers and where to put them, what is not accepted, missed pickups',
    photo: 'garbage bins curbside',
  },
  {
    key: 'recycling',
    title: 'Recycling',
    beat: 'community',
    need: 'what goes in the recycling bin, what does not, collection day and how to get a bin',
    photo: 'recycling bins',
  },
  {
    key: 'bulk-waste',
    title: 'Bulk trash and yard waste',
    beat: 'community',
    need: 'what counts as bulk, size limits, how to set it out, paid pickups and fees',
    photo: 'old furniture curb',
  },
  {
    key: 'holiday-sanitation',
    title: 'Holiday trash schedule',
    beat: 'community',
    need: 'which holidays change collection and how the schedule shifts',
    photo: 'garbage truck',
  },
  {
    key: 'hurricane-prep',
    title: 'Hurricane preparedness',
    beat: 'community',
    need: 'how to prepare, supplies, shutters, where official updates come from',
    photo: 'storm shutters window',
  },
  {
    key: 'evacuation',
    title: 'Evacuation zones and shelters',
    beat: 'community',
    need: 'how to find your zone, when to leave, shelters and special-needs registration',
    photo: 'hurricane evacuation route sign',
  },
  {
    key: 'storm-debris',
    title: 'Storm debris after a hurricane',
    beat: 'community',
    need: 'how storm debris is collected, how to sort and place it, what is not picked up',
    photo: 'fallen palm fronds',
  },
  {
    key: 'flood-zones',
    title: 'Flood zones and flood insurance',
    beat: 'development',
    need: 'how to look up a flood zone, what the zones mean, flood insurance and protection',
    photo: 'flooded street',
  },
  {
    key: 'emergency-alerts',
    title: 'Emergency alerts',
    beat: 'community',
    need: 'how to sign up for official alerts and what each alert service sends',
    photo: 'phone emergency alert',
  },
  {
    key: 'building-permits',
    title: 'Building permits',
    beat: 'development',
    need: 'when a permit is needed, how to apply, plan review, inspections and closeout',
    photo: 'house construction framing',
  },
  {
    key: 'hire-a-contractor',
    title: 'Hiring a licensed contractor',
    beat: 'development',
    need: 'how to check a license, what to ask, and how permits protect the owner',
    photo: 'contractor tools',
  },
  {
    key: 'permit-search',
    title: 'Looking up permits and code cases',
    beat: 'development',
    need: 'how to search permit history and code cases for an address',
    photo: 'blueprints',
  },
  {
    key: 'parking',
    title: 'Parking',
    beat: 'community',
    need: 'where and how to park, payment, rates and rules',
    photo: 'parking meter',
  },
  {
    key: 'parking-tickets',
    title: 'Paying or contesting a parking ticket',
    beat: 'community',
    need: 'how to pay a citation, deadlines, fines and how to contest one',
    photo: 'parking ticket windshield',
  },
  {
    key: 'beach-parks',
    title: 'Beach parks',
    beat: 'community',
    need: 'which beach parks there are, hours, entry fees, amenities and rules',
    photo: 'beach umbrella and towel',
  },
  {
    key: 'beach-permits',
    title: 'Beach, dog and boat permits',
    beat: 'community',
    need: 'who can get each permit, prices, how to apply or renew',
    photo: 'beach parking',
  },
  {
    key: 'pets',
    title: 'Pets and dog parks',
    beat: 'community',
    need: 'dog parks and dog beaches, rules, permits and pet licensing',
    photo: 'dog park',
  },
  {
    key: 'voting',
    title: 'Voting and elections',
    beat: 'government',
    need: 'upcoming elections, how to register, where and when to vote, what is on the ballot',
    photo: 'voting booth',
  },
  {
    key: 'council-meetings',
    title: 'City council meetings and public comment',
    beat: 'government',
    need: 'when the council meets, where to find agendas and video, how to speak',
    photo: 'gavel and microphone',
  },
  {
    key: 'public-records',
    title: 'Public records requests',
    beat: 'government',
    need: 'how to request records, what it costs and how long it takes',
    photo: 'file folders archive',
  },
  {
    key: 'report-a-concern',
    title: 'Reporting a problem to the city',
    beat: 'government',
    need: 'how to report potholes, streetlights, code problems and other issues',
    photo: 'pothole street',
  },
  {
    key: 'code-enforcement',
    title: 'Code enforcement',
    beat: 'government',
    need: 'what code enforcement handles, how complaints work and what happens next',
    photo: 'overgrown yard',
  },
  {
    key: 'water-billing',
    title: 'Water and utility bills',
    beat: 'community',
    need: 'how to start or stop service, pay a bill, payment options and help paying',
    photo: 'water meter',
  },
  {
    key: 'water-restrictions',
    title: 'Watering rules and water conservation',
    beat: 'community',
    need: 'lawn watering days and hours, conservation programs and rebates',
    photo: 'lawn sprinkler',
  },
  {
    key: 'boil-water-notices',
    title: 'Boil water notices',
    beat: 'community',
    need: 'what a notice means, what to do, how to find out if your address is affected',
    photo: 'boiling water pot',
  },
  {
    key: 'water-quality',
    title: 'Drinking water quality',
    beat: 'community',
    need: 'where the water comes from, the annual water quality report and contacts',
    photo: 'glass of tap water',
  },
  {
    key: 'library-card',
    title: 'Getting a library card',
    beat: 'community',
    need: 'who can get a card, what to bring, fees, branches and digital services',
    photo: 'library books shelves',
  },
  {
    key: 'recreation-registration',
    title: 'Signing up for recreation programs',
    beat: 'community',
    need: 'how to create an account, register for classes, fees and residency rules',
    photo: 'community center gym',
  },
  {
    key: 'camps',
    title: 'Youth camps',
    beat: 'community',
    need: 'which camps run when, ages, how and when to register',
    photo: 'summer camp arts and crafts',
  },
  {
    key: 'tennis-pickleball',
    title: 'Tennis and pickleball',
    beat: 'community',
    need: 'courts, hours, fees, passes, reservations, lessons and open play',
    photo: 'pickleball court',
  },
  {
    key: 'golf',
    title: 'Public golf',
    beat: 'community',
    need: 'public courses, rates, tee times and programs',
    photo: 'golf course green',
  },
  {
    key: 'business-tax-receipt',
    title: 'Business tax receipts',
    beat: 'business',
    need: 'who needs one, how to apply or renew, fees and deadlines',
    photo: 'small business storefront',
  },
  {
    key: 'garage-sales',
    title: 'Garage sale permits',
    beat: 'community',
    need: 'whether a permit is needed, how often sales are allowed, signs and fees',
    photo: 'garage sale',
  },
  {
    key: 'special-events',
    title: 'Special event permits',
    beat: 'community',
    need: 'which events need a permit, how far ahead to apply, fees and requirements',
    photo: 'outdoor festival tents',
  },
  {
    key: 'fertilizer-rules',
    title: 'Fertilizer rules',
    beat: 'community',
    need: 'when fertilizer is restricted, what is allowed and why',
    photo: 'fertilizer spreader lawn',
  },
  {
    key: 'alarm-permits',
    title: 'Alarm permits and false alarms',
    beat: 'community',
    need: 'whether an alarm permit is required, fees and false alarm charges',
    photo: 'home security alarm keypad',
  },
  {
    key: 'stormwater',
    title: 'Stormwater and drainage',
    beat: 'development',
    need: 'how drainage works, what residents can do, and how to report flooding or blocked drains',
    photo: 'storm drain',
  },
  {
    key: 'property-tax',
    title: 'Property taxes and homestead exemption',
    beat: 'government',
    need: 'how to apply for homestead and other exemptions, deadlines, and how to pay the tax bill',
    photo: 'house keys calculator',
  },
  {
    key: 'schools-enrollment',
    title: 'Public school enrollment',
    beat: 'schools',
    need: 'how to find the assigned school, what documents to bring and how to enroll',
    photo: 'school bus',
  },
  {
    key: 'shuttles',
    title: 'Free shuttles and getting around',
    beat: 'community',
    need: 'which shuttles run, routes, hours and how to ride',
    photo: 'shuttle bus',
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
