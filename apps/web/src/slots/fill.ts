import { townContactEmail, type TownConfig } from '@towncore/config';
import { getActiveCampaign, type Town } from '@towncore/db';
import { z } from 'zod';
import { db } from '@/lib/db';
import { newsletterOpen } from '@/lib/newsletter';
import { slots, type SlotName } from './registry';

// What a campaign may put in a slot. Text-only in M1; images arrive with the image rules (M4/M9).
export const creativeSchema = z.strictObject({
  headline: z.string().min(1).max(90),
  body: z.string().max(200).optional(),
  href: z.url(),
  cta: z.string().max(30).optional(),
  advertiser: z.string().min(1).max(80),
});
export type Creative = z.infer<typeof creativeSchema>;

export type SlotFill = {
  source: 'campaign' | 'house';
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
export async function resolveSlotFill(
  town: Town,
  slot: SlotName,
  now = new Date(),
): Promise<SlotFill> {
  const campaign = await getActiveCampaign(db(), town.id, slot, now);
  if (campaign) {
    const creative = creativeSchema.safeParse(campaign.creative);
    if (creative.success) {
      return {
        source: 'campaign',
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
  return houseAd(town, slot, { newsletter: await newsletterOpen(town) });
}

/** House ads promote the site itself. They're labeled as the site's own, never as editorial. */
export function houseAd(town: Town, slot: SlotName, opts: { newsletter?: boolean } = {}): SlotFill {
  const contact = townContactEmail(town.config as TownConfig);
  const advertise: SlotFill = {
    source: 'house',
    label: `From ${town.siteName}`,
    headline: `Advertise in ${town.siteName}`,
    body: `Reach ${town.name} readers with a sponsorship or a featured listing.`,
    href: `mailto:${contact}?subject=${encodeURIComponent(`Advertising in ${town.siteName}`)}`,
    cta: 'Get in touch',
  };
  // Until the town's newsletter can send (Mail-5), the ad says it's coming (D-M1-1).
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
        href: '/about',
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
  };
  return rotation[slot];
}
