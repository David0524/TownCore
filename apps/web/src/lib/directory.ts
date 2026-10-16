import { directoryCategories, type DirectoryCategory, type FoodColor } from '@towncore/config';
import type { Town } from '@towncore/db';
import { contactShown, listingPlace, type Listing } from '@towncore/directory';
import { siteUrl } from './discovery';

// Town-site helpers for the directory (M6 PR B, docs/plans/M6.md §2).

export const directoryPath = (category?: string, slug?: string) =>
  ['/directory', category, slug].filter(Boolean).join('/');

/** The directory's groups, in the order pages show them. */
export const DIRECTORY_GROUPS = [
  { key: 'food', title: 'Food and drink' },
  { key: 'shops', title: 'Shopping' },
  { key: 'home', title: 'Home services' },
  { key: 'health', title: 'Health, beauty and fitness' },
  { key: 'services', title: 'Services' },
  { key: 'fun', title: 'Hotels and things to do' },
] as const;

const FLAVORS: FoodColor[] = ['ocean', 'saffron', 'basil', 'tomato', 'berry', 'cocoa'];

/**
 * A category's color pair (the network food colors), the same wherever its icon appears: the
 * homepage grid, the directory's category bar, its page.
 */
export function categoryFlavor(slug: string): FoodColor {
  const i = directoryCategories.findIndex((c) => c.slug === slug);
  return FLAVORS[(i < 0 ? 0 : i) % FLAVORS.length]!;
}

/** The category the directory opens on: restaurants when there are any, else the biggest. */
export function defaultCategory<T extends { category: DirectoryCategory; count: number }>(
  counts: readonly T[],
): T | null {
  return (
    counts.find((c) => c.category.slug === 'restaurants') ??
    [...counts].sort((a, b) => b.count - a.count)[0] ??
    null
  );
}

export const listingPath = (listing: Pick<Listing, 'category' | 'slug'>) =>
  directoryPath(listing.category ?? 'other', listing.slug);

/** The mapped place on openstreetmap.org ("node/123"), for the ODbL credit and a check. */
export const osmPlaceUrl = (ref: string) => `https://www.openstreetmap.org/${ref}`;

/** The state's own public license lookup, so readers can check a license themselves. */
export const LICENSE_LOOKUP = 'https://www.myfloridalicense.com/portalsearches/VerifyLicensee';

/** schema.org types for our categories; anything else is a plain LocalBusiness. */
const schemaTypes: Record<string, string> = {
  'general-contractors': 'GeneralContractor',
  roofers: 'RoofingContractor',
  electricians: 'Electrician',
  plumbers: 'Plumber',
  hvac: 'HVACBusiness',
  'pool-and-spa': 'HomeAndConstructionBusiness',
  solar: 'HomeAndConstructionBusiness',
  'alarm-systems': 'HomeAndConstructionBusiness',
  restaurants: 'Restaurant',
  'takeout-and-counter': 'FastFoodRestaurant',
  caterers: 'FoodEstablishment',
  'food-trucks': 'FoodEstablishment',
};

/**
 * LocalBusiness JSON-LD (CLAUDE.md §11 "SEO"). Like the page, it carries the street address and
 * phone only once claimed or for a mapped storefront (contactShown; D-M6-2).
 */
export function localBusinessJsonLd(town: Town, listing: Listing): Record<string, unknown> {
  const claimed = contactShown(listing);
  return {
    '@context': 'https://schema.org',
    '@type': schemaTypes[listing.category ?? ''] ?? 'LocalBusiness',
    name: listing.name,
    url: siteUrl(town, listingPath(listing)),
    address: {
      '@type': 'PostalAddress',
      ...(claimed && listing.address ? { streetAddress: listing.address } : {}),
      addressLocality: town.name,
      addressRegion: town.state,
      ...(listing.zip ? { postalCode: listing.zip } : {}),
      addressCountry: 'US',
    },
    ...(claimed && listing.phone ? { telephone: listing.phone } : {}),
    ...(claimed && listing.website ? { sameAs: [listing.website] } : {}),
  };
}

/** The second line under a listing's name. */
export function listingDetail(town: Town, listing: Listing): string {
  return [listing.licenseType, listingPlace(listing, town.name)].filter(Boolean).join(' · ');
}

export function categoryTitle(town: Town, category: DirectoryCategory): string {
  return `${category.name} in ${town.name}`;
}
