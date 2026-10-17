import type { CSSProperties } from 'react';
import {
  creativeSchema,
  townPricing,
  type DirectoryCategory,
  type FeaturedRank,
} from '@towncore/config';
import { getActiveCampaigns, type Town } from '@towncore/db';
import { db } from '@/lib/db';
import { resolveSlotFill, type SlotFill } from './fill';
import type { FeaturedPrices } from './house';
import { SlotUnit } from './Slot';
import { slots } from './registry';
import styles from './Slot.module.css';

const TOP = 'directory.topspot';
const CARDS = 'directory.category.top';

/** Reserved height of the strip (label line included), px: one line on desktop, two on phones. */
export const STRIP_HEIGHT = { mobile: 100, desktop: 76 };

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/**
 * A category's featured spots (CLAUDE.md §11b `directory.topspot` and `directory.category.top`;
 * owner, 2026-10-17: "way too many place holders before you get to real businesses"). Paid units
 * render in full, first, in rank order: the Top spot (#1), then the approved cards of #2 and #3,
 * each in the locked Sponsored style. Whatever is unsold collapses into one compact strip of
 * our own ("3 featured spots open in Plumbers · #1 $19/mo …"), with its height reserved so it
 * never shifts the page, so readers reach real businesses within the first screen. The strip
 * carries both slots' names while both are unsold, so the slot contract holds on every page.
 */
export async function FeaturedSpots({
  town,
  category,
  openRanks,
  prices,
}: {
  town: Town;
  category: DirectoryCategory;
  /** Featured spots with no live booking (inventory), #1 first. */
  openRanks: readonly FeaturedRank[];
  prices: FeaturedPrices;
}) {
  const context = { category, openRanks };
  const [top, live] = await Promise.all([
    resolveSlotFill(town, TOP, new Date(), context),
    getActiveCampaigns(db(), town.id, CARDS, category.slug, 3),
  ]);
  const cards = live.flatMap((campaign) => {
    const creative = creativeSchema.safeParse(campaign.creative);
    if (!creative.success) return [];
    const fill: SlotFill = {
      source: 'campaign',
      campaignId: campaign.id,
      label: `${slots[CARDS].paidLabel} · ${creative.data.advertiser}`,
      headline: creative.data.headline,
      body: creative.data.body,
      href: creative.data.href,
      cta: creative.data.cta,
    };
    return [{ key: campaign.id, fill }];
  });
  const topOpen = top.source === 'house';
  const cardsOpen = cards.length === 0;
  return (
    <>
      {topOpen ? null : <SlotUnit name={TOP} fill={top} />}
      {cardsOpen ? null : (
        <div data-testid="sponsored-cards">
          {cards.map(({ key, fill }) => (
            <SlotUnit key={key} name={CARDS} fill={fill} />
          ))}
        </div>
      )}
      {topOpen || cardsOpen ? (
        <FeaturedStrip
          town={town}
          category={category}
          slot={topOpen ? TOP : CARDS}
          // Only spots still for sale in each slot's own part of the line.
          topRanks={topOpen ? openRanks.filter((r) => r === 1) : []}
          cardRanks={cardsOpen ? openRanks.filter((r) => r !== 1) : []}
          cardsInStrip={topOpen && cardsOpen}
          prices={prices}
        />
      ) : null}
    </>
  );
}

/** The unsold featured spots as one line: what's open, each spot's price, and the way in. */
function FeaturedStrip({
  town,
  category,
  slot,
  topRanks,
  cardRanks,
  cardsInStrip,
  prices,
}: {
  town: Town;
  category: DirectoryCategory;
  slot: typeof TOP | typeof CARDS;
  topRanks: readonly FeaturedRank[];
  cardRanks: readonly FeaturedRank[];
  /** Both slots are unsold: the #2 and #3 part of the line is `directory.category.top`. */
  cardsInStrip: boolean;
  prices: FeaturedPrices;
}) {
  const open = topRanks.length + cardRanks.length;
  const trialDays = townPricing(town).free_trial_days;
  const style = {
    '--slot-h-mobile': `${STRIP_HEIGHT.mobile}px`,
    '--slot-h-desktop': `${STRIP_HEIGHT.desktop}px`,
  } as CSSProperties;
  const tile = (r: FeaturedRank) => (
    <span key={r} className={styles.stripOffer}>
      <strong>#{r}</strong> {usd(prices[r])}/mo
    </span>
  );
  // Every spot booked but a sponsor's card still waiting for approval: invite a free claim.
  const href = open ? `/advertise?category=${category.slug}` : '/directory/claim';
  const spots = `${open} featured ${open === 1 ? 'spot' : 'spots'} open`;
  const trial = trialDays > 0 ? `, first ${trialDays} days free` : '';
  return (
    <aside
      className={styles.strip}
      style={style}
      data-slot={slot}
      data-fill="house"
      data-format="strip"
      aria-label="Message from this site"
      data-testid="featured-strip"
    >
      <span className={styles.label} data-testid="slot-label">
        From {town.siteName}
      </span>
      <a className={styles.stripUnit} href={href}>
        <span className={styles.stripText}>
          {open ? (
            <>
              {spots}
              {/* Phones keep the short line; the tiles say the rest. */}
              <span className="not-phone">
                {' '}
                in {category.name}
                {trial}
              </span>
            </>
          ) : (
            `Is your ${category.singular} listed? Claim it free`
          )}
        </span>
        {open ? (
          <span className={styles.stripOffers}>
            {topRanks.map(tile)}
            {cardsInStrip ? (
              <span data-slot={CARDS} data-fill="house" className={styles.stripOffers}>
                {cardRanks.map(tile)}
              </span>
            ) : (
              cardRanks.map(tile)
            )}
          </span>
        ) : null}
        <span className={styles.cta}>
          {open ? 'Get featured' : 'Claim your listing'} <span aria-hidden="true">›</span>
        </span>
      </a>
    </aside>
  );
}
