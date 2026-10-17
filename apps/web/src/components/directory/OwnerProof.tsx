import { directoryCategory, PROOF_MINIMUMS } from '@towncore/config';
import { townVariant, type Town } from '@towncore/db';
import {
  categoryQuoteRequests,
  featuredUplift,
  listingProof,
  localMonth,
  missedLine,
  peerLine,
  previousMonth,
  proofLine,
  proofReport,
  type Listing,
  type ProductOffer,
} from '@towncore/directory';
import { db } from '@/lib/db';
import styles from '@/app/sites/[host]/directory/directory.module.css';

const DAY = 86_400_000;
/** The welcome prompt shows this long after a claim is approved. */
const JUST_CLAIMED_DAYS = 14;

/**
 * Proof beats pitch (owner, 2026-10-17), on the owner page: the listing's own numbers, what
 * owners without a featured spot missed this month, and what featured listings got across our
 * towns, each from real counts with the basis stated, or "not enough data yet". Then, at the right
 * moment only (just after the claim was approved, or after a good month), one in-page prompt with
 * a one-click upgrade to Stripe Checkout. Never a pop-up, a countdown or invented urgency.
 */
export async function OwnerProof({
  town,
  listing,
  offers,
  now = new Date(),
}: {
  town: Town;
  listing: Listing;
  offers: ProductOffer[];
  now?: Date;
}) {
  const proof = await listingProof(db(), listing.id, now);
  const line = proofLine(proof);
  const spots = offers.filter((o) => o.product === 'sponsored_slot');
  const featured = spots.some((o) => o.placement);
  const category = directoryCategory(listing.category ?? '');
  const missed =
    !featured && category
      ? missedLine({
          count: await categoryQuoteRequests(db(), {
            townId: town.id,
            category: category.slug,
            timezone: town.timezone,
            month: localMonth(now, town.timezone),
          }),
          category: category.slug,
          townName: town.name,
          period: 'this month',
        })
      : null;
  const peer =
    !featured && spots.length
      ? peerLine(
          await featuredUplift(db(), { category: category?.slug ?? null }, now),
          category?.name ?? null,
        )
      : null;

  // The right moment: just after the claim was approved, or after a good month.
  const best = spots.find((o) => !o.placement && o.left !== 0) ?? null;
  let prompt: { title: string; text: string } | null = null;
  if (best && !featured) {
    const month = previousMonth(now, town.timezone);
    const last = await proofReport(db(), {
      businessId: listing.id,
      timezone: town.timezone,
      month,
    });
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(`${month}-15T12:00:00Z`),
    );
    const timing = await townVariant(db(), 'upgrade-prompt-timing', town);
    const justClaimed =
      listing.claimedAt && now.getTime() - listing.claimedAt.getTime() < JUST_CLAIMED_DAYS * DAY;
    if (last.listingViews >= PROOF_MINIMUMS.goodMonthViews)
      prompt = {
        title: `Readers saw your listing ${last.listingViews.toLocaleString('en-US')} times in ${monthName}`,
        text: `A featured spot puts ${listing.name} above every other listing in its category, labeled Sponsored.`,
      };
    else if (justClaimed && timing === 'control')
      prompt = {
        title: 'Your listing is yours now',
        text: `Add your hours and a description below. When you want more, a featured spot puts ${listing.name} above every other listing in its category, labeled Sponsored.`,
      };
  }

  return (
    <section aria-labelledby="proof-h" data-testid="owner-proof">
      <h2 id="proof-h">How your listing is doing</h2>
      <p data-testid="owner-proof-line">
        {line ??
          `Not enough data yet: we show your numbers once your listing has been seen ${PROOF_MINIMUMS.listingViews} times in 30 days (now ${proof.views}).`}
      </p>
      {missed ? <p data-testid="owner-missed">{missed}</p> : null}
      {peer ? (
        <p className="meta" data-testid="owner-peer">
          {peer}
        </p>
      ) : null}
      {prompt && best ? (
        <div className={styles.prompt} data-testid="owner-prompt">
          <strong>{prompt.title}</strong>
          <p>{prompt.text}</p>
          <form method="post" action={`/owner/${listing.slug}/checkout`}>
            <input type="hidden" name="product" value="sponsored_slot" />
            <input type="hidden" name="rank" value={best.rank ?? ''} />
            <button type="submit" className="button">
              Get spot #{best.rank} for ${best.monthlyUsd} a month
              {best.trialDays > 0 ? `, first ${best.trialDays} days free` : ''}
            </button>
          </form>
          <p className="meta">Cancel anytime from this page.</p>
        </div>
      ) : null}
    </section>
  );
}
