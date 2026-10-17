import {
  creativeSchema,
  townContactEmail,
  type DirectoryCategory,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import { getActiveCampaign, townVariant, type Town } from '@towncore/db';
import { db } from '@/lib/db';
import { newsletterOpen } from '@/lib/newsletter';
import { slots, type SlotName } from './registry';

export { creativeSchema, type Creative } from '@towncore/config';

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
 * Fill order for every slot (CLAUDE.md §11b):
 * 1. direct-sold campaign, 2. sponsored placement (M6), 3. programmatic (later, gated),
 * 4. house ad. A slot never renders empty.
 */
/**
 * What a slot's house ad can say about where it sits: the directory category, and which of its
 * featured spots are open (the page knows; a house ad never offers a sold spot).
 */
export type SlotContext = {
  category?: DirectoryCategory | undefined;
  openRanks?: readonly FeaturedRank[] | undefined;
};

/** "$19", "$12 and $7": a town's featured spot prices, from its config. */
export function featuredOffer(town: Town, ranks: readonly FeaturedRank[] = [1, 2, 3]) {
  const pricing = (town.config as TownConfig).pricing;
  const prices = ranks.map((r) => `$${pricing.featured_usd[r - 1]}`);
  const list =
    prices.length <= 1
      ? (prices[0] ?? '')
      : `${prices.slice(0, -1).join(', ')} and ${prices[prices.length - 1]}`;
  const from = `$${Math.min(...pricing.featured_usd)}`;
  const trial = pricing.free_trial_days > 0 ? `first ${pricing.free_trial_days} days free` : '';
  return { list, from, trial, trialDays: pricing.free_trial_days };
}

/** The advertising page, with the category to feature when there is one. */
export const advertisePath = (category?: DirectoryCategory) =>
  category ? `/advertise?category=${category.slug}` : '/advertise';

export async function resolveSlotFill(
  town: Town,
  slot: SlotName,
  now = new Date(),
  context: SlotContext = {},
): Promise<SlotFill> {
  const campaign = await getActiveCampaign(db(), town.id, slot, now, context.category?.slug);
  if (campaign) {
    const creative = creativeSchema.safeParse(campaign.creative);
    if (creative.success) {
      return {
        source: 'campaign',
        campaignId: campaign.id,
        label: `${slots[slot].paidLabel} · ${creative.data.advertiser}`,
        headline: creative.data.headline,
        body: creative.data.body,
        href: creative.data.href,
        cta: creative.data.cta,
      };
    }
    console.error(
      `Campaign ${campaign.id} has an invalid creative; using a house ad.`,
      creative.error.issues,
    );
  }
  // 2. Sponsored directory placements: M6. 3. Programmatic: gated, later.
  return houseAd(town, slot, {
    newsletter: await newsletterOpen(town),
    adCopy: await townVariant(db(), 'house-ad-copy', town),
    ...context,
  });
}

/** House ads promote the site itself. They're labeled as the site's own, never as editorial. */
export function houseAd(
  town: Town,
  slot: SlotName,
  opts: { newsletter?: boolean; adCopy?: 'control' | 'reach-readers' } & SlotContext = {},
): SlotFill {
  const contact = townContactEmail(town.config as TownConfig);
  // Every money house ad sells the same concrete offer: featured spots at the town's prices,
  // first month free (owner, 2026-10-16, after bocatownsquare.com).
  const offer = featuredOffer(town);
  const freeLine = offer.trial ? ` ${capitalize(offer.trial)}.` : '';
  const pricing = (town.config as TownConfig).pricing;
  const tiles = (ranks: readonly FeaturedRank[]) =>
    ranks.map((r) => ({ rank: `#${r}`, price: `$${pricing.featured_usd[r - 1]}/mo` }));
  const advertise: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    // The headline is an experiment per town or cohort (owner, 2026-10-17).
    headline:
      opts.adCopy === 'reach-readers' ? `Reach ${town.name} readers` : 'Get your business featured',
    body: `Featured spots in ${town.siteName}'s directory from ${offer.from} a month.${freeLine}`,
    href: advertisePath(),
    cta: offer.trial ? `Try ${offer.trialDays} days free` : 'See the spots',
    offers: tiles([1, 2, 3]),
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
  const open = opts.openRanks ?? [1, 2, 3];
  const claim: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'Is yours listed? Claim it free',
    body: 'Add your phone, hours and website.',
    href: '/directory/claim',
    cta: 'Claim your listing',
  };
  const topOffer = featuredOffer(town, [1]);
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
  const restOffer = featuredOffer(town, rest);
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
    // The category-exclusive product is off (D-M6-6), and the owner panel just below invites
    // claims, so its header slot offers the morning email.
    'directory.category.exclusive': newsletter,
    'directory.topspot': topspot,
    'directory.category.top': featured,
    'directory.quote-request': leads,
    'dining.featured': dining,
  };
  return rotation[slot];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
