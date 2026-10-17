import {
  featuredRanks,
  townContactEmail,
  townPricing,
  type DirectoryCategory,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import type { SlotName } from './registry';

// House ads (§11b fill order, step 4): the site's own promotions, labeled as the site's, never
// as editorial. Pure, so the copy can be tested: prices, open spots and reader counts come in
// from the page, and every number in an ad is a real one (owner, 2026-10-17: no invented
// urgency or counts; a reader count shows only above its minimum, else the copy stays generic).

export type SlotFill = {
  source: 'campaign' | 'house';
  /** The campaign shown, for the cookieless slot counters (M6 PR E). */
  campaignId?: string | undefined;
  /** Shown in the locked label style. Paid fills are always labeled (Rule 6). */
  label: string;
  headline: string;
  body?: string | undefined;
  href: string;
  cta?: string | undefined;
  /** House ads that sell featured spots show each open spot and its price, as tiles. */
  offers?: Array<{ rank: string; price: string }> | undefined;
};

/**
 * What a slot's house ad can say about where it sits: the directory category, and which of its
 * featured spots are open (the page knows; a house ad never offers a sold spot).
 */
export type SlotContext = {
  category?: DirectoryCategory | undefined;
  openRanks?: readonly FeaturedRank[] | undefined;
};

type HouseTown = { name: string; siteName: string; tier: string; config: unknown };

/** Featured spot prices in cents, #1 first: the category's current ones, else the list. */
export type FeaturedPrices = Record<FeaturedRank, number>;

export const listFeaturedPrices = (town: HouseTown): FeaturedPrices => {
  const usd = townPricing(town).featured_usd;
  return { 1: usd[0] * 100, 2: usd[1] * 100, 3: usd[2] * 100 };
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/** "$19", "$12 and $7": featured spot prices, with the trial wording. */
export function featuredOffer(
  town: HouseTown,
  ranks: readonly FeaturedRank[] = featuredRanks,
  prices: FeaturedPrices = listFeaturedPrices(town),
) {
  const trialDays = townPricing(town).free_trial_days;
  const list = ranks.map((r) => usd(prices[r]));
  const joined =
    list.length <= 1
      ? (list[0] ?? '')
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const from = usd(Math.min(...featuredRanks.map((r) => prices[r])));
  const trial = trialDays > 0 ? `first ${trialDays} days free` : '';
  return { list: joined, from, trial, trialDays };
}

/** The advertising page, with the category to feature when there is one. */
export const advertisePath = (category?: DirectoryCategory) =>
  category ? `/advertise?category=${category.slug}` : '/advertise';

/** House ads promote the site itself. They're labeled as the site's own, never as editorial. */
export function houseAd(
  town: HouseTown,
  slot: SlotName,
  opts: {
    newsletter?: boolean;
    adCopy?: 'control' | 'reach-readers';
    /** The category's current featured prices (list prices without one). */
    prices?: FeaturedPrices;
    /** Active newsletter subscribers, or null below the minimum. */
    readers?: number | null;
  } & SlotContext = {},
): SlotFill {
  const contact = townContactEmail(town.config as TownConfig);
  const prices = opts.prices ?? listFeaturedPrices(town);
  // Every money house ad sells the same concrete offer: featured spots at real current prices,
  // first month free (owner, 2026-10-16, after bocatownsquare.com).
  const offer = featuredOffer(town, featuredRanks, prices);
  const freeLine = offer.trial ? ` ${capitalize(offer.trial)}.` : '';
  const tiles = (ranks: readonly FeaturedRank[]) =>
    ranks.map((r) => ({ rank: `#${r}`, price: `${usd(prices[r])}/mo` }));
  const readers = opts.readers ?? null;
  const advertise: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    // The headline is an experiment per town or cohort (owner, 2026-10-17); its reader count is
    // the town's real active subscribers, shown only above the minimum.
    headline:
      opts.adCopy === 'reach-readers'
        ? readers
          ? `Reach ${readers.toLocaleString('en-US')} ${town.name} readers every morning`
          : `Reach ${town.name} readers`
        : 'Get your business featured',
    body: `Featured spots in ${town.siteName}'s directory from ${offer.from} a month.${freeLine}`,
    href: advertisePath(),
    cta: offer.trial ? `Try ${offer.trialDays} days free` : 'See the spots',
    offers: tiles(featuredRanks),
  };
  // The newsletter page shows the signup form, or "launching soon" until the town can send.
  const newsletter: SlotFill = opts.newsletter
    ? {
        source: 'house',
        label: `From ${town.siteName}`,
        headline: `Start every day knowing what ${town.name} decided.`,
        body: 'Our free morning email, written from public records.',
        href: '/newsletter',
        cta: 'Sign up',
      }
    : {
        source: 'house',
        label: `From ${town.siteName}`,
        headline: 'Our free morning email is launching soon',
        body: `${town.name} news from public records, every morning.`,
        href: '/newsletter',
        cta: 'Learn more',
      };
  const tips: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'Know something we should look into?',
    body: `Send tips and public records about ${town.name} to our newsroom.`,
    href: `mailto:${contact}?subject=${encodeURIComponent('News tip')}`,
    cta: 'Send a tip',
  };
  // Directory house ads sell the category's own open featured spots, with their prices.
  const category = opts.category;
  const open = opts.openRanks ?? featuredRanks;
  const claim: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'Is yours listed? Claim it free',
    body: 'Add your phone, hours and website.',
    href: '/directory/claim',
    cta: 'Claim your listing',
  };
  const topOffer = featuredOffer(town, [1], prices);
  const topspot: SlotFill = open.includes(1)
    ? {
        source: 'house',
        label: `From ${town.siteName}`,
        // Short enough for the reserved height on a phone, whatever the category's name.
        headline: '#1 spot open',
        body: `The first ${category?.singular ?? 'business'} readers see here. ${topOffer.list} a month${topOffer.trial ? `, ${topOffer.trial}` : ''}.`,
        href: advertisePath(category),
        cta: 'Claim the #1 spot',
      }
    : advertise;
  const rest = open.filter((r) => r !== 1);
  const restOffer = featuredOffer(town, rest, prices);
  const featured: SlotFill = rest.length
    ? {
        source: 'house',
        label: `From ${town.siteName}`,
        headline: `${rest.length === 1 ? 'Spot' : 'Spots'} ${rest.map((r) => `#${r}`).join(' and ')} ${rest.length === 1 ? 'is' : 'are'} open`,
        body: `Above every other ${category?.singular ?? 'listing'}. ${restOffer.list} a month${restOffer.trial ? `, ${restOffer.trial}` : ''}.`,
        href: advertisePath(category),
        cta: 'Get featured',
        offers: tiles(rest),
      }
    : claim;
  const leads: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: category
      ? `Are you a ${category.singular}? Get quote requests from ${town.name} readers`
      : `Get quote requests from ${town.name} readers`,
    body: `Featured businesses receive the quote requests sent from this page. From ${offer.from} a month.`,
    href: advertisePath(category),
    cta: 'Learn more',
  };
  const dining: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'Your restaurant here',
    body: `In front of ${town.name} readers from ${offer.from} a month.${freeLine}`,
    href: advertisePath(),
    cta: 'Get featured',
  };
  // Neighboring slots on one page get different messages.
  const rotation: Record<SlotName, SlotFill> = {
    'home.top': advertise,
    'home.infeed': newsletter,
    // The banner at the top already sells featured spots; the directory module invites a claim.
    'home.directory': claim,
    'home.events': advertise,
    'rail.box': tips,
    'article.inline': newsletter,
    'article.related-businesses': advertise,
    'article.realestate': advertise,
    // Unsold, the category-exclusive slot waits in the directory's rail, under the morning-email
    // signup (owner, 2026-10-17), so it invites a free claim instead of repeating the signup.
    'directory.category.exclusive': claim,
    'directory.topspot': topspot,
    'directory.category.top': featured,
    'directory.quote-request': leads,
    'dining.featured': dining,
  };
  return rotation[slot];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
