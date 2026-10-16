import type { DirectoryCategory } from '@towncore/config';
import { creativeSchema } from '@towncore/config';
import { getActiveCampaigns, type Town } from '@towncore/db';
import { db } from '@/lib/db';
import { Slot, SlotUnit } from './Slot';
import { slots } from './registry';

const SLOT = 'directory.category.top';

/**
 * `directory.category.top` (CLAUDE.md §11b): up to 3 approved sponsor cards for the category,
 * each a labeled unit in the locked style, in the order they were sold. With none sold it is
 * one ordinary slot (direct-sold campaign, else house ad). Organic listings follow, unchanged.
 */
export async function SponsoredCards({
  town,
  category,
}: {
  town: Town;
  category: DirectoryCategory;
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
  if (fills.length === 0) return <Slot town={town} name={SLOT} context={{ category }} />;
  return (
    <div data-testid="sponsored-cards">
      {fills.map(({ key, fill }) => (
        <SlotUnit key={key} name={SLOT} fill={fill} />
      ))}
    </div>
  );
}
