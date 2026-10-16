import type { DirectoryCategory } from '@towncore/config';
import type { Town } from '@towncore/db';
import { listingPlace, type Listing } from '@towncore/directory';
import { siteUrl } from './discovery';

// Town-site helpers for the directory (M6 PR B, docs/plans/M6.md §2).

export const directoryPath = (category?: string, slug?: string) =>
  ['/directory', category, slug].filter(Boolean).join('/');

export const listingPath = (listing: Pick<Listing, 'category' | 'slug'>) =>
  directoryPath(listing.category ?? 'other', listing.slug);

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
 * phone only once the owner has claimed the listing (D-M6-2).
 */
export function localBusinessJsonLd(town: Town, listing: Listing): Record<string, unknown> {
  const claimed = Boolean(listing.claimedAt);
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
