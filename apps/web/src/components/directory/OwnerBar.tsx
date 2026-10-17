import Link from 'next/link';
import {
  scarcityLine,
  featuredRanks,
  type DirectoryCategory,
  type FeaturedRank,
} from '@towncore/config';
import type { Town } from '@towncore/db';
import styles from './places.module.css';

const WAITLIST_MESSAGES: Record<string, string> = {
  joined:
    'You’re on the waitlist. If the email is a claimed listing’s, we’ll write once when a spot opens.',
  already: 'You’re already on the waitlist for this category.',
  open: 'A spot just opened: see it on the advertise page.',
  invalid: 'Enter an email address and tick the box to join.',
  rate_limited: 'Too many sign-ups from here just now. Please try again in an hour.',
  error: 'Something went wrong. Please try again.',
};

/**
 * For business owners (owner, 2026-10-16: "prominent, non-scammy buttons"): what a listing costs
 * (nothing) and the two ways in, claiming a listing or adding a missing business. Plain buttons
 * in the town's colors; no countdowns or urgency. On a category page it also says how many of
 * its featured spots are open, from real inventory (owner, 2026-10-17), and when all are sold,
 * offers the waitlist instead.
 */
export function OwnerBar({
  town,
  spots,
}: {
  town: Town;
  spots?: {
    category: DirectoryCategory;
    openRanks: readonly FeaturedRank[];
    /** The cheapest open spot's price, in cents. */
    fromCents: number | null;
    waitlistStatus?: string | undefined;
  };
}) {
  const open = spots?.openRanks.length ?? 0;
  return (
    <section className={styles.owner} aria-labelledby="owner-h" data-testid="owner-bar">
      <div>
        <h2 id="owner-h" className={styles.ownerTitle}>
          Own a business in {town.name}?
        </h2>
        <p className={styles.ownerText}>
          Listings are free. Claim yours to add hours and a description, or add a business
          we&rsquo;re missing.
        </p>
        {spots ? (
          <p className={styles.ownerText} data-testid="spots-open">
            {scarcityLine(open, featuredRanks.length, spots.category.name)}{' '}
            {open > 0 ? (
              <Link href={`/advertise?category=${spots.category.slug}`}>
                {spots.fromCents ? `From $${spots.fromCents / 100} a month` : 'See the spots'}
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className={styles.ownerButtons}>
        <Link href="/directory/claim" className={`${styles.ownerButton} ${styles.primary}`}>
          Claim your listing
        </Link>
        <Link href="/directory/add" className={styles.ownerButton}>
          Add your business
        </Link>
      </div>
      {spots && open === 0 ? (
        <WaitlistForm category={spots.category} source="category" status={spots.waitlistStatus} />
      ) : null}
    </section>
  );
}

/** "Get notified when a spot opens": an email and a consent box, nothing more. */
export function WaitlistForm({
  category,
  source,
  status,
}: {
  category: DirectoryCategory;
  source: 'category' | 'advertise';
  status?: string | undefined;
}) {
  return (
    <form
      method="post"
      action="/directory/waitlist"
      className={styles.waitlist}
      data-testid="waitlist-form"
    >
      <input type="hidden" name="category" value={category.slug} />
      <input type="hidden" name="source" value={source} />
      <label className={styles.waitlistEmail}>
        <span>Get notified when a spot opens</span>
        <input name="email" type="email" required maxLength={200} autoComplete="email" />
      </label>
      <label className={styles.waitlistConsent}>
        <input type="checkbox" name="consent" value="yes" required />
        <span>
          Email me once when a featured spot in {category.name.toLowerCase()} opens. Notices go to
          the email of a claimed listing.
        </span>
      </label>
      {/* Hidden from people; bots fill it in. */}
      <div className="sr-only" aria-hidden="true">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" className={styles.ownerButton}>
        Join the waitlist
      </button>
      {status && WAITLIST_MESSAGES[status] ? (
        <p role="status" className={styles.ownerText} data-testid="waitlist-status">
          {WAITLIST_MESSAGES[status]}
        </p>
      ) : null}
    </form>
  );
}
