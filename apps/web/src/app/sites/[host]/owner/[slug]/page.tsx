import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CARD_LIMITS, listingOffers, ownerListings, sponsorCards } from '@towncore/directory';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import { currentOwner } from '@/lib/owner';
import { stripe } from '@/lib/stripe';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../../directory/directory.module.css';

export const metadata: Metadata = { title: 'Edit your listing', robots: { index: false } };

const PAYMENT_MESSAGES: Record<string, string> = {
  paid: 'Thanks. Your placement turns on as soon as Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled; nothing was charged.',
  sold_out: 'That placement just sold out in your category.',
  already_active: 'You already have that placement.',
  unavailable: 'Paid placements aren’t open on this site yet.',
  no_billing: 'There’s no billing account for you yet.',
  card_sent: 'Thanks. Your card is waiting for review; we’ll put it up once it’s checked.',
  card_headline: `Write a headline of up to ${CARD_LIMITS.headline} characters.`,
  card_body: `Keep the text under ${CARD_LIMITS.body} characters.`,
  card_no_placement: 'Your sponsored slot isn’t active yet.',
};

const OFFER_NOTES: Record<string, string> = {
  enhanced: 'Your hours, website and description on your listing card in the category list.',
  sponsored_slot: 'A labeled card at the top of your category, linking to your listing.',
};

type Props = {
  params: Promise<{ host: string; slug: string }>;
  searchParams: Promise<{ s?: string; e?: string | string[] }>;
};

/** An owner edits their listing. A new name waits for staff; the rest shows at once. */
export default async function EditListing({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const email = await currentOwner(town);
  if (!email) redirect('/owner');
  const { slug } = await params;
  const listing = (await ownerListings(db(), town.id, email)).find((l) => l.slug === slug);
  if (!listing) notFound();
  const { s, e } = await searchParams;
  const offers = stripe() ? await listingOffers(db(), town.id, listing) : [];
  const sponsored = offers.find((o) => o.product === 'sponsored_slot')?.placement;
  const cards = sponsored?.status === 'active' ? await sponsorCards(db(), sponsored.id) : null;
  const liveCard = cards?.find((c) => c.status === 'live');
  const latest = cards?.[0];
  const errors = (Array.isArray(e) ? e : e ? [e] : []).slice(0, 5);
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href="/owner">Your listings</Link> ›{' '}
        <Link href={listingPath(listing)}>View listing</Link> ›{' '}
        <Link href={`/owner/${listing.slug}/report`}>Report</Link>
      </p>
      <LargeTitle title={listing.name} as="h1" always />
      {s === 'saved' || s === 'review' ? (
        <p role="status" data-testid="owner-saved">
          Saved.
          {s === 'review' ? ' The new business name shows once our staff check it.' : ''}
        </p>
      ) : null}
      {s && PAYMENT_MESSAGES[s] ? (
        <p role="status" data-testid="owner-payment">
          {PAYMENT_MESSAGES[s]}
        </p>
      ) : null}
      {errors.length ? (
        <ul role="alert" data-testid="owner-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <form method="post" action={`/owner/${listing.slug}/save`} className={styles.claim}>
        <label>
          Business name
          <input name="name" defaultValue={listing.pendingName ?? listing.name} maxLength={120} />
        </label>
        {listing.pendingName ? (
          <p className="meta">Waiting for review: {listing.pendingName}</p>
        ) : null}
        <label>
          Phone
          <input name="phone" type="tel" defaultValue={listing.phone ?? ''} maxLength={40} />
        </label>
        <label>
          Website
          <input name="website" defaultValue={listing.website ?? ''} maxLength={300} />
        </label>
        <label>
          Hours
          <textarea name="hours" rows={3} defaultValue={listing.hours ?? ''} maxLength={500} />
        </label>
        <label>
          Service area
          <input name="serviceArea" defaultValue={listing.serviceArea ?? ''} maxLength={200} />
        </label>
        <label>
          About the business
          <textarea
            name="description"
            rows={5}
            defaultValue={listing.description ?? ''}
            maxLength={1000}
          />
        </label>
        <p className="meta">
          Your license details come from the state and can&apos;t be edited here. Photos come later.
        </p>
        <button type="submit" className="button">
          Save
        </button>
      </form>
      {offers.length > 0 ? (
        <section aria-labelledby="promote-h" data-testid="promote">
          <h2 id="promote-h">Promote this listing</h2>
          <p className={styles.note}>
            Paid placements are always labeled &quot;Sponsored&quot; and never change the order of
            the regular listings. Billed monthly through Stripe; cancel any time.
          </p>
          <ul className={styles.offers}>
            {offers.map((offer) => (
              <li key={offer.product}>
                <strong>{offer.name}</strong> · ${offer.monthlyUsd}/month
                <span className="meta">
                  {OFFER_NOTES[offer.product] ?? ''}
                  {offer.left !== null ? ` ${offer.left} of 3 left in this category.` : ''}
                </span>
                {offer.placement ? (
                  <span className="meta" data-testid={`placement-${offer.product}`}>
                    {offer.placement.status === 'held'
                      ? 'Paid, but this category filled up first. We’ll refund you or offer the next opening.'
                      : `Active${offer.placement.endsAt ? ` until ${offer.placement.endsAt.toISOString().slice(0, 10)}` : ''}.`}
                  </span>
                ) : offer.left === 0 ? (
                  <span className="meta">Sold out.</span>
                ) : (
                  <form method="post" action={`/owner/${listing.slug}/checkout`}>
                    <input type="hidden" name="product" value={offer.product} />
                    <button type="submit" className="button">
                      Buy {offer.name.toLowerCase()}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {cards ? (
            <section id="card" aria-labelledby="card-h" data-testid="sponsor-card">
              <h3 id="card-h">Your sponsored card</h3>
              <p className={styles.note}>
                It shows at the top of your category, labeled &quot;Sponsored&quot;, and links to
                your listing. Our staff check each version before it goes up; a live card stays up
                while a new version is reviewed.
              </p>
              {liveCard ? (
                <p className="meta" data-testid="card-live">
                  Live: {liveCard.headline}
                </p>
              ) : null}
              {latest?.status === 'waiting' ? (
                <p className="meta" data-testid="card-waiting">
                  Waiting for review: {latest.headline}
                </p>
              ) : null}
              {latest?.status === 'rejected' ? (
                <p className="meta" data-testid="card-rejected">
                  Not approved: {latest.note}
                </p>
              ) : null}
              <form method="post" action={`/owner/${listing.slug}/card`} className={styles.claim}>
                <label>
                  Headline
                  <input
                    name="headline"
                    required
                    maxLength={CARD_LIMITS.headline}
                    defaultValue={latest?.headline ?? ''}
                  />
                </label>
                <label>
                  Short text (optional)
                  <textarea
                    name="body"
                    rows={2}
                    maxLength={CARD_LIMITS.body}
                    defaultValue={latest?.body ?? ''}
                  />
                </label>
                <button type="submit" className="button">
                  Send for review
                </button>
              </form>
            </section>
          ) : null}
          <form method="post" action="/owner/billing">
            <input type="hidden" name="slug" value={listing.slug} />
            <button type="submit" className={`button ${styles.secondary}`}>
              Manage billing
            </button>
          </form>
        </section>
      ) : null}
    </StandardPage>
  );
}
