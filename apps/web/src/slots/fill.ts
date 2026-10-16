import {
  creativeSchema,
  townContactEmail,
  type DirectoryCategory,
  type TownConfig,
} from '@towncore/config';
import { getActiveCampaign, type Town } from '@towncore/db';
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
};

/**
 * Fill order for every slot (CLAUDE.md §11b):
 * 1. direct-sold campaign, 2. sponsored placement (M6), 3. programmatic (later, gated),
 * 4. house ad. A slot never renders empty.
 */
/** What a slot's house ad can say about where it sits (the directory category, for one). */
export type SlotContext = { category?: DirectoryCategory | undefined };

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
  return houseAd(town, slot, { newsletter: await newsletterOpen(town), ...context });
}

/** House ads promote the site itself. They're labeled as the site's own, never as editorial. */
export function houseAd(
  town: Town,
  slot: SlotName,
  opts: { newsletter?: boolean } & SlotContext = {},
): SlotFill {
  const contact = townContactEmail(town.config as TownConfig);
  const advertise: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: `Advertise in ${town.siteName}`,
    body: `Reach ${town.name} readers with a sponsorship or a featured listing.`,
    href: `mailto:${contact}?subject=${encodeURIComponent(`Advertising in ${town.siteName}`)}`,
    cta: 'Get in touch',
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
  // Directory house ads sell the directory's own inventory to businesses already listed.
  const category = opts.category;
  const ask = (subject: string) => `mailto:${contact}?subject=${encodeURIComponent(subject)}`;
  const topspot: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: category ? `Top spot open: ${category.name}. Claim it` : 'Top spots are open',
    body: `Be the first ${category?.singular ?? 'business'} ${town.name} readers see here.`,
    href: ask(`Top spot: ${category?.name ?? 'directory'}`),
    cta: 'Ask about the top spot',
  };
  const exclusive: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: category
      ? `Become ${town.name}'s featured ${category.singular}`
      : `Feature your business in ${town.siteName}`,
    body: 'One business per category, shown at the top of this page.',
    href: ask(`Featured ${category?.singular ?? 'business'}`),
    cta: 'Get in touch',
  };
  const claim: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'Is your business listed here? Claim it free',
    body: 'Add your phone, hours and website so readers can reach you.',
    href: ask('Claim my listing'),
    cta: 'Claim your listing',
  };
  const leads: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: category
      ? `Are you a ${category.singular}? Get quote requests from ${town.name} readers`
      : `Get quote requests from ${town.name} readers`,
    body: 'Sponsored listings receive the quote requests sent from this page.',
    href: ask(`Quote requests: ${category?.name ?? 'directory'}`),
    cta: 'Learn more',
  };
  const dining: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: 'This spot could be your restaurant',
    body: `Put your restaurant in front of ${town.name} readers looking for somewhere new.`,
    href: ask('Featured restaurant'),
    cta: 'Get in touch',
  };
  // Neighboring slots on one page get different messages.
  const rotation: Record<SlotName, SlotFill> = {
    'home.top': advertise,
    'home.infeed': newsletter,
    'home.directory': advertise,
    'home.events': advertise,
    'rail.box': tips,
    'article.inline': newsletter,
    'article.related-businesses': advertise,
    'article.realestate': advertise,
    'directory.category.exclusive': exclusive,
    'directory.topspot': topspot,
    'directory.category.top': claim,
    'directory.quote-request': leads,
    'dining.featured': dining,
  };
  return rotation[slot];
}
