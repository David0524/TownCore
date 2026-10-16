import type { DirectoryCategory, FeaturedRank } from '@towncore/config';
import { creativeSchema } from '@towncore/config';
import { getActiveCampaigns, type Town } from '@towncore/db';
import { db } from '@/lib/db';
import { Slot, SlotUnit } from './Slot';
import { slots } from './registry';

const SLOT = 'directory.category.top';

/**
 * `directory.category.top` (CLAUDE.md §11b): the approved cards of featured spots #2 and #3 (#1
 * is the Top spot above), each a labeled unit in the locked style, in rank order. With none live
 * it is one ordinary slot (direct-sold campaign, else a house ad offering the open spots).
 * Organic listings follow, unchanged.
 */
export async function SponsoredCards({
  town,
  category,
  openRanks,
  houseOffOnPhones,
}: {
  town: Town;
  category: DirectoryCategory;
  openRanks?: readonly FeaturedRank[];
  /** With no cards sold, its house ad repeats the Top spot's offer; a short list drops it. */
  houseOffOnPhones?: boolean;
}) {
  const live = await getActiveCampaigns(db(), town.id, SLOT, category.slug, 3);
  const fills = live.flatMap((campaign) => {
    const creative = creativeSchema.safeParse(campaign.creative);
    if (!creative.success) return [];
    return [
      {
        key: campaign.id,
        fill: {
          source: 'campaign' as const,
          campaignId: campaign.id,
          label: `${slots[SLOT].paidLabel} · ${creative.data.advertiser}`,
          headline: creative.data.headline,
          body: creative.data.body,
          href: creative.data.href,
          cta: creative.data.cta,
        },
      },
    ];
  });
  if (fills.length === 0)
    return (
      <Slot
        town={town}
        name={SLOT}
        context={{ category, openRanks }}
        houseOffOnPhones={houseOffOnPhones}
      />
    );
  return (
    <div data-testid="sponsored-cards">
      {fills.map(({ key, fill }) => (
        <SlotUnit key={key} name={SLOT} fill={fill} />
      ))}
    </div>
  );
}
