import type { BeatSlug } from './theme';

// Directory categories (M6, docs/plans/M6.md §1): one list for every town. Each category says
// which state licenses put a business in it, and which OpenStreetMap tags (owner, 2026-10-16:
// storefronts mapped in OpenStreetMap are listed with their public address, phone and website).
// Order here is the order readers see.
//
// DBPR professional licenses are matched as "<board>:<occupation code>" (codes in
// packages/adapters/src/fl-dbpr/codes.ts); food service licenses as "food:<type>:<rank>"
// (packages/adapters/src/fl-dbpr/food.ts). A license matching no category isn't listed.

export type DirectoryCategory = {
  slug: string;
  name: string;
  /** Singular, for "Boca's featured plumber" and "Top spot open: …". */
  singular: string;
  group: 'home' | 'food' | 'shops' | 'health' | 'services' | 'fun';
  licenses: readonly string[];
  /** OpenStreetMap tags ("amenity=restaurant") that put a mapped place in this category. */
  osm?: readonly string[];
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
    osm: ['amenity=restaurant'],
    beats: ['business'],
  },
  {
    slug: 'takeout-and-counter',
    name: 'Takeout and counter service',
    singular: 'takeout spot',
    group: 'food',
    licenses: ['food:2010:NOST'],
    osm: ['amenity=fast_food', 'amenity=food_court'],
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
  // Everyday categories from OpenStreetMap (no state license behind them).
  {
    slug: 'coffee-and-bakeries',
    name: 'Coffee, bakeries and sweets',
    singular: 'coffee shop',
    group: 'food',
    licenses: [],
    osm: [
      'amenity=cafe',
      'amenity=ice_cream',
      'shop=bakery',
      'shop=coffee',
      'shop=pastry',
      'shop=confectionery',
      'shop=chocolate',
    ],
    beats: ['business'],
  },
  {
    slug: 'bars-and-nightlife',
    name: 'Bars and nightlife',
    singular: 'bar',
    group: 'food',
    licenses: [],
    osm: ['amenity=bar', 'amenity=pub', 'amenity=nightclub', 'amenity=biergarten'],
    beats: ['business'],
  },
  {
    slug: 'grocery-and-markets',
    name: 'Grocery and markets',
    singular: 'grocery store',
    group: 'food',
    licenses: [],
    osm: [
      'shop=supermarket',
      'shop=greengrocer',
      'shop=butcher',
      'shop=seafood',
      'shop=deli',
      'shop=wine',
      'shop=alcohol',
      'shop=health_food',
      'amenity=marketplace',
    ],
    beats: ['business'],
  },
  {
    slug: 'shopping',
    name: 'Shopping',
    singular: 'shop',
    group: 'shops',
    licenses: [],
    osm: [
      'shop=clothes',
      'shop=shoes',
      'shop=boutique',
      'shop=gift',
      'shop=jewelry',
      'shop=books',
      'shop=department_store',
      'shop=mall',
      'shop=furniture',
      'shop=electronics',
      'shop=sports',
      'shop=toys',
      'shop=variety_store',
      'shop=florist',
      'shop=hardware',
      'shop=doityourself',
      'shop=garden_centre',
      'shop=mobile_phone',
      'shop=bicycle',
      'shop=art',
      'shop=interior_decoration',
      'shop=bag',
      'shop=watches',
      'shop=music',
    ],
    beats: ['business'],
  },
  {
    slug: 'health-and-medical',
    name: 'Health and medical',
    singular: 'medical office',
    group: 'health',
    licenses: [],
    osm: [
      'amenity=doctors',
      'amenity=dentist',
      'amenity=clinic',
      'amenity=pharmacy',
      'shop=optician',
      'shop=medical_supply',
      'healthcare=physiotherapist',
      'healthcare=optometrist',
    ],
    beats: ['community'],
  },
  {
    slug: 'beauty-and-wellness',
    name: 'Beauty and wellness',
    singular: 'salon',
    group: 'health',
    licenses: [],
    osm: [
      'shop=hairdresser',
      'shop=beauty',
      'shop=cosmetics',
      'shop=massage',
      'shop=tattoo',
      'leisure=spa',
      'amenity=spa',
    ],
    beats: ['business'],
  },
  {
    slug: 'fitness',
    name: 'Fitness and sports',
    singular: 'gym',
    group: 'health',
    licenses: [],
    osm: ['leisure=fitness_centre', 'leisure=dance', 'sport=yoga'],
    beats: ['community'],
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    singular: 'auto shop',
    group: 'services',
    licenses: [],
    osm: [
      'shop=car',
      'shop=car_repair',
      'shop=tyres',
      'shop=car_parts',
      'amenity=car_wash',
      'shop=motorcycle',
    ],
    beats: ['business'],
  },
  {
    slug: 'banks-and-finance',
    name: 'Banks and finance',
    singular: 'bank',
    group: 'services',
    licenses: [],
    osm: ['amenity=bank', 'office=accountant', 'office=financial', 'office=insurance'],
    beats: ['business'],
  },
  {
    slug: 'real-estate',
    name: 'Real estate',
    singular: 'real estate office',
    group: 'services',
    licenses: [],
    osm: ['office=estate_agent'],
    beats: ['development'],
  },
  {
    slug: 'professional-services',
    name: 'Professional services',
    singular: 'professional office',
    group: 'services',
    licenses: [],
    osm: [
      'office=lawyer',
      'office=architect',
      'office=it',
      'office=travel_agent',
      'shop=travel_agency',
    ],
    beats: ['business'],
  },
  {
    slug: 'personal-services',
    name: 'Personal services',
    singular: 'service',
    group: 'services',
    licenses: [],
    osm: [
      'shop=laundry',
      'shop=dry_cleaning',
      'shop=tailor',
      'shop=copyshop',
      'shop=storage_rental',
    ],
    beats: ['business'],
  },
  {
    slug: 'pets',
    name: 'Pets',
    singular: 'pet business',
    group: 'services',
    licenses: [],
    osm: ['shop=pet', 'shop=pet_grooming', 'amenity=veterinary'],
    beats: ['community'],
  },
  {
    slug: 'childcare-and-education',
    name: 'Childcare and education',
    singular: 'school',
    group: 'services',
    licenses: [],
    osm: [
      'amenity=kindergarten',
      'amenity=childcare',
      'amenity=language_school',
      'amenity=music_school',
      'amenity=driving_school',
      'amenity=prep_school',
    ],
    beats: ['schools'],
  },
  {
    slug: 'hotels',
    name: 'Hotels and lodging',
    singular: 'hotel',
    group: 'fun',
    licenses: [],
    osm: ['tourism=hotel', 'tourism=motel', 'tourism=guest_house'],
    beats: ['business'],
  },
  {
    slug: 'entertainment',
    name: 'Entertainment and attractions',
    singular: 'attraction',
    group: 'fun',
    licenses: [],
    osm: [
      'amenity=cinema',
      'amenity=theatre',
      'amenity=arts_centre',
      'tourism=museum',
      'tourism=gallery',
      'leisure=bowling_alley',
      'leisure=amusement_arcade',
      'leisure=escape_game',
      'leisure=miniature_golf',
    ],
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

const byOsmTag = new Map(
  directoryCategories.flatMap((c) => (c.osm ?? []).map((tag) => [tag, c] as const)),
);

/**
 * The category for a mapped place's tags, or null. Only named places count; amenity and shop
 * are checked before the rest, so a café inside a hotel is filed as a café.
 */
export function categoryForOsmTags(
  tags: Readonly<Record<string, string>>,
): DirectoryCategory | null {
  if (!tags.name) return null;
  for (const key of ['amenity', 'shop', 'healthcare', 'leisure', 'office', 'tourism', 'sport']) {
    const value = tags[key];
    if (!value) continue;
    for (const v of value.split(';')) {
      const hit = byOsmTag.get(`${key}=${v.trim()}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function directoryCategory(slug: string): DirectoryCategory | null {
  return directoryCategories.find((c) => c.slug === slug) ?? null;
}

/** Sponsored listings per category per town (§11: max 3). */
export const maxSponsoredPerCategory = 3;

/**
 * Featured spots (owner, 2026-10-16, after bocatownsquare.com): the sponsored listings of a
 * category are sold as ranked spots, #1 (the Top spot), #2 and #3, each to one business at a
 * time, at the town's `pricing.featured_usd` (Boca $19, $12, $7 a month), with the first
 * `pricing.free_trial_days` free for a business's first spot. Payment never changes organic order.
 */
export const featuredRanks = [1, 2, 3] as const;
export type FeaturedRank = (typeof featuredRanks)[number];

/**
 * What businesses can buy (D-M6-6). Prices come from each town's `pricing`; a product without
 * a price there stays off. Category exclusive and newsletter sponsorship are built but off
 * until the owner prices them. Paid placements are always labeled (Rule 6) and never change
 * organic order. A ranked product sells one place per rank and category.
 */
export const directoryProducts = {
  enhanced: {
    name: 'Enhanced listing',
    priceKey: 'enhanced_usd',
    enabled: true,
    perCategory: null,
    ranked: false,
  },
  sponsored_slot: {
    name: 'Featured spot',
    priceKey: 'featured_usd',
    enabled: true,
    perCategory: maxSponsoredPerCategory,
    ranked: true,
  },
  exclusive: {
    name: 'Category exclusive',
    priceKey: null,
    enabled: false,
    perCategory: 1,
    ranked: false,
  },
  newsletter: {
    name: 'Newsletter sponsorship',
    priceKey: null,
    enabled: false,
    perCategory: null,
    ranked: false,
  },
  spotlight: {
    name: 'Business spotlight',
    priceKey: null,
    enabled: false,
    perCategory: null,
    ranked: false,
  },
} as const;
export type DirectoryProduct = keyof typeof directoryProducts;

/**
 * Monthly price in whole dollars for a town, or null when the product is off there. A ranked
 * product has one price per rank (#1 first).
 */
export function productPrice(
  pricing: Record<string, unknown> | undefined,
  product: DirectoryProduct,
  rank?: FeaturedRank,
): number | null {
  const def = directoryProducts[product];
  if (!def.enabled || !def.priceKey) return null;
  const value = pricing?.[def.priceKey];
  if (def.ranked) {
    if (!Array.isArray(value) || !rank) return null;
    return typeof value[rank - 1] === 'number' ? (value[rank - 1] as number) : null;
  }
  return typeof value === 'number' ? value : null;
}

/** "#1 spot", for owners and house ads. */
export const featuredName = (rank: FeaturedRank) => `Featured spot #${rank}`;
