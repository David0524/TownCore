import type { FeaturedRank } from '@towncore/config';
import type { SelfServeProduct } from '@towncore/directory';

// Shared words and links for the advertise storefront (/advertise) and its start page
// (/advertise/start), so both describe each offer the same way.

export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export const SPOTS: Record<FeaturedRank, { title: string; where: string }> = {
  1: {
    title: 'Top spot',
    where: 'The first business on its category page, above everything else.',
  },
  2: { title: 'Second spot', where: 'Right below the Top spot, above every other listing.' },
  3: { title: 'Third spot', where: 'Below #2, still above every other listing.' },
};

/** What each offer is called and where it shows, for a category name (lower case) or none. */
export const OFFERS: Record<
  Exclude<SelfServeProduct, 'sponsored_slot'>,
  { title: string; per: string; where: (category: string | null) => string }
> = {
  enhanced: {
    title: 'Enhanced listing',
    per: 'a month',
    where: () =>
      'Your hours, website and description on your card in the category list, marked Enhanced.',
  },
  newsletter: {
    title: 'Morning email sponsor',
    per: 'a week',
    where: () =>
      'Your card at the top of every morning email for one week, Monday to Sunday, labeled Sponsored.',
  },
  exclusive: {
    title: 'Category sponsor',
    per: 'a month',
    where: (category) =>
      `Your card in the header of ${category ?? 'a category'} for one calendar month, one business at a time, labeled Sponsored.`,
  },
};

/** The start page for an offer. */
export function startPath(
  product: SelfServeProduct,
  options: { category?: string | null; rank?: FeaturedRank | null; period?: string | null } = {},
): string {
  const query = new URLSearchParams({ product });
  if (options.category) query.set('category', options.category);
  if (options.rank) query.set('rank', String(options.rank));
  if (options.period) query.set('period', options.period);
  return `/advertise/start?${query.toString()}`;
}
