import { cache } from 'react';
import { creativeSchema } from '@towncore/config';
import { getActiveCampaign, townVariant, type Town } from '@towncore/db';
import { featuredPrices, readerReach } from '@towncore/directory';
import { db } from '@/lib/db';
import { newsletterOpen } from '@/lib/newsletter';
import { houseAd, type SlotContext, type SlotFill } from './house';
import { slots, type SlotName } from './registry';

export { creativeSchema, type Creative } from '@towncore/config';
export { advertisePath, featuredOffer, houseAd, type SlotContext, type SlotFill } from './house';

// Once per request, however many slots a page has.
const pricesFor = cache((town: Town, category: string | null) =>
  featuredPrices(db(), town, category),
);
const readersOf = cache((townId: string) => readerReach(db(), townId));

/**
 * Fill order for every slot (CLAUDE.md §11b):
 * 1. direct-sold campaign, 2. sponsored placement (M6), 3. programmatic (later, gated),
 * 4. house ad. A slot never renders empty.
 */
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
    // Current prices (the category's own on directory pages) and the real reader count.
    prices: await pricesFor(town, context.category?.slug ?? null),
    readers: await readersOf(town.id),
    ...context,
  });
}
