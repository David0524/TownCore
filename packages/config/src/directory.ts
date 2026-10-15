import type { BeatSlug } from './theme';

// Directory categories (M6, docs/plans/M6.md §1): one list for every town. Each category says
// which state licenses put a business in it. Order here is the order readers see.
//
// DBPR professional licenses are matched as "<board>:<occupation code>" (codes in
// packages/adapters/src/fl-dbpr/codes.ts); food service licenses as "food:<type>:<rank>"
// (packages/adapters/src/fl-dbpr/food.ts). A license matching no category isn't listed.

export type DirectoryCategory = {
  slug: string;
  name: string;
  /** Singular, for "Boca's featured plumber" and "Top spot open: …". */
  singular: string;
  group: 'home' | 'food';
  licenses: readonly string[];
  /** Story beats whose articles show this category under related businesses (§11b). */
  beats: readonly BeatSlug[];
};

export const directoryCategories: readonly DirectoryCategory[] = [
  {
    slug: 'general-contractors',
    name: 'General contractors',
    singular: 'general contractor',
    group: 'home',
    licenses: ['06:CGC', '06:RG', '06:CBC', '06:RB', '06:CRC', '06:RR'],
    beats: ['development'],
  },
  {
    slug: 'roofers',
    name: 'Roofers',
    singular: 'roofer',
    group: 'home',
    licenses: ['06:CCC', '06:RC'],
    beats: ['development'],
  },
  {
    slug: 'electricians',
    name: 'Electricians',
    singular: 'electrician',
    group: 'home',
    licenses: ['08:EC', '08:ER'],
    beats: ['development'],
  },
  {
    slug: 'plumbers',
    name: 'Plumbers',
    singular: 'plumber',
    group: 'home',
    licenses: ['06:CFC', '06:RF'],
    beats: ['development'],
  },
  {
    slug: 'hvac',
    name: 'Air conditioning and heating',
    singular: 'air conditioning contractor',
    group: 'home',
    licenses: ['06:CAC', '06:RA', '06:CMC', '06:RM'],
    beats: ['development'],
  },
  {
    slug: 'pool-and-spa',
    name: 'Pool and spa',
    singular: 'pool contractor',
    group: 'home',
    licenses: ['06:CPC', '06:RP', '06:RPS'],
    beats: ['development'],
  },
  {
    slug: 'solar',
    name: 'Solar',
    singular: 'solar contractor',
    group: 'home',
    licenses: ['06:CVC', '06:SOLR'],
    beats: ['development'],
  },
  {
    slug: 'alarm-systems',
    name: 'Alarm systems',
    singular: 'alarm contractor',
    group: 'home',
    licenses: ['08:EF', '08:EG', '08:EH', '08:EI', '08:EJ', '08:EY', '08:EZ'],
    beats: [],
  },
  {
    slug: 'restaurants',
    name: 'Restaurants',
    singular: 'restaurant',
    group: 'food',
    licenses: ['food:2010:SEAT'],
    beats: ['business'],
  },
  {
    slug: 'takeout-and-counter',
    name: 'Takeout and counter service',
    singular: 'takeout spot',
    group: 'food',
    licenses: ['food:2010:NOST'],
    beats: ['business'],
  },
  {
    slug: 'caterers',
    name: 'Caterers',
    singular: 'caterer',
    group: 'food',
    licenses: ['food:2013:CATR'],
    beats: ['business', 'community'],
  },
  {
    slug: 'food-trucks',
    name: 'Food trucks',
    singular: 'food truck',
    group: 'food',
    licenses: ['food:2014:MFDV'],
    beats: ['community'],
  },
];

const byLicense = new Map(
  directoryCategories.flatMap((c) => c.licenses.map((license) => [license, c] as const)),
);

/** The category for a license key ("06:CGC", "food:2010:SEAT"), or null if it isn't listed. */
export function categoryForLicense(key: string): DirectoryCategory | null {
  return byLicense.get(key) ?? null;
}

export function directoryCategory(slug: string): DirectoryCategory | null {
  return directoryCategories.find((c) => c.slug === slug) ?? null;
}

/** Sponsored listings per category per town (§11: max 3). */
export const maxSponsoredPerCategory = 3;
