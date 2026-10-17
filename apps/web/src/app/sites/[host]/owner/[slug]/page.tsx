import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CARD_LIMITS, listingOffers, ownerListings, sponsorCards } from '@towncore/directory';
import {
  businessLicense,
  ownerPhotos,
  PHOTO_REJECTIONS,
  PHOTOS_PER_LISTING,
} from '@towncore/photos';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import { currentOwner } from '@/lib/owner';
import { photosOpen } from '@/lib/photos';
import { stripe } from '@/lib/stripe';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../../directory/directory.module.css';

export const metadata: Metadata = { title: 'Edit your listing', robots: { index: false } };

const PAYMENT_MESSAGES: Record<string, string> = {
  paid: 'Thanks. Your placement turns on as soon as Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled; nothing was charged.',
  sold_out: 'Someone just took that spot in your category. Pick another open one.',
  already_active: 'You already have that placement.',
  unavailable: 'Paid placements aren’t open on this site yet.',
  no_billing: 'There’s no billing account for you yet.',
  card_sent: 'Thanks. Your card is waiting for review; we’ll put it up once it’s checked.',
  card_headline: `Write a headline of up to ${CARD_LIMITS.headline} characters.`,
  card_body: `Keep the text under ${CARD_LIMITS.body} characters.`,
  card_no_placement: 'That placement isn’t active yet.',
  photo_sent: 'Thanks. Your photo shows on your listing once our staff check it.',
  photo_closed: 'Photo uploads aren’t open yet. Please try again soon.',
  photo_error: 'Something went wrong with that photo. Please try again later.',
  ...Object.fromEntries(Object.entries(PHOTO_REJECTIONS).map(([k, v]) => [`photo_${k}`, v])),
};

const OFFER_NOTES: Record<string, string> = {
  enhanced: 'Your hours, website and description on your listing card in the category list.',
  sponsored_slot: 'A labeled card above every other listing in your category, linking to yours.',
  newsletter:
    'Your card at the top of every morning email for one week (Monday to Sunday), labeled Sponsored.',
  exclusive:
    'Your card in the header of your category page for one calendar month, labeled Sponsored.',
};

const SPOT_NOTES: Record<number, string> = {
  1: 'The Top spot: first on your category page.',
  2: 'Right below the Top spot.',
  3: 'Below #2, above every other listing.',
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
  // Cards for booked weeks and months, one per booking.
  const bookingCards = new Map(
    await Promise.all(
      offers
        .flatMap((o) => o.bookings)
        .filter((b) => b.status === 'active')
        .map(async (b) => [b.id, await sponsorCards(db(), b.id)] as const),
    ),
  );
  const errors = (Array.isArray(e) ? e : e ? [e] : []).slice(0, 5);
  const photos = await ownerPhotos(db(), listing.id);
  const kept = photos.filter((p) => p.status !== 'rejected');
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
          Your license details come from the state and can&apos;t be edited here.
        </p>
        <button type="submit" className="button">
          Save
        </button>
      </form>
      <section id="photos" aria-labelledby="photos-h" data-testid="owner-photos">
        <h2 id="photos-h">Photos</h2>
        <p className={styles.note}>
          Up to {PHOTOS_PER_LISTING} photos of your business: the storefront, the inside, your work.
          Our staff check each one before it shows on your listing and in stories about your
          business. We remove location and camera data from every photo.
        </p>
        {photos.length > 0 ? (
          <ul className={styles.offers}>
            {photos.map((p) => (
              <li key={p.id}>
                {p.caption}
                <span className="meta">
                  {p.status === 'approved'
                    ? 'Showing on your listing.'
                    : p.status === 'pending'
                      ? 'Waiting for review.'
                      : 'Not approved.'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {kept.length < PHOTOS_PER_LISTING && photosOpen() ? (
          <form
            method="post"
            action={`/owner/${listing.slug}/photo`}
            encType="multipart/form-data"
            className={styles.claim}
          >
            <label>
              Photo (JPEG, PNG or WebP, up to 12 MB)
              <input name="photo" type="file" required accept="image/jpeg,image/png,image/webp" />
            </label>
            <label>
              What it shows
              <input name="caption" required maxLength={300} />
            </label>
            <label>
              Credit line
              <input
                name="credit"
                required
                maxLength={80}
                defaultValue={`Photo: ${listing.name}`}
              />
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="agree" value="yes" required />
              <span data-testid="business-license">{businessLicense(town.siteName).text}</span>
            </label>
            <button type="submit" className="button">
              Send photo
            </button>
          </form>
        ) : null}
      </section>
      {offers.length > 0 ? (
        <section aria-labelledby="promote-h" data-testid="promote">
          <h2 id="promote-h">Promote this listing</h2>
          <p className={styles.note}>
            Paid placements are always labeled &quot;Sponsored&quot; and never change the order of
            the regular listings. Monthly placements are billed through Stripe and can be canceled
            any time; a booked week or month is paid once.
          </p>
          <ul className={styles.offers}>
            {offers.map((offer) =>
              offer.period ? (
                <li key={offer.product} data-testid={`booking-${offer.product}`}>
                  <strong>{offer.name}</strong> · ${offer.monthlyUsd} a {offer.period}
                  <span className="meta">{OFFER_NOTES[offer.product] ?? ''}</span>
                  {offer.bookings.map((b) => {
                    const versions = bookingCards.get(b.id) ?? [];
                    const live = versions.find((c) => c.status === 'live');
                    const last = versions[0];
                    return (
                      <div key={b.id} data-testid="booking">
                        <span className="meta">
                          {b.window.label}:{' '}
                          {b.status === 'held'
                            ? 'Paid, but someone booked it first. We’ll refund you or offer another date.'
                            : live
                              ? `Booked. Card approved: ${live.headline}`
                              : last?.status === 'waiting'
                                ? `Booked. Card waiting for review: ${last.headline}`
                                : 'Booked. Write your card below; it shows once an editor checks it.'}
                        </span>
                        {b.status === 'active' ? (
                          <form
                            method="post"
                            action={`/owner/${listing.slug}/card`}
                            className={styles.claim}
                          >
                            <input type="hidden" name="placementId" value={b.id} />
                            <label>
                              Headline
                              <input
                                name="headline"
                                required
                                maxLength={CARD_LIMITS.headline}
                                defaultValue={last?.headline ?? ''}
                              />
                            </label>
                            <label>
                              Short text (optional)
                              <textarea
                                name="body"
                                rows={2}
                                maxLength={CARD_LIMITS.body}
                                defaultValue={last?.body ?? ''}
                              />
                            </label>
                            <button type="submit" className="button">
                              Send card for review
                            </button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                  {offer.open.length > 0 ? (
                    <form method="post" action={`/owner/${listing.slug}/checkout`}>
                      <input type="hidden" name="product" value={offer.product} />
                      <label>
                        {offer.period === 'week' ? 'Week' : 'Month'}
                        <select name="period" defaultValue={offer.open[0]!.start}>
                          {offer.open.map((w) => (
                            <option key={w.start} value={w.start}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="button">
                        Book a {offer.period} for ${offer.monthlyUsd}
                      </button>
                    </form>
                  ) : (
                    <span className="meta">Every upcoming {offer.period} is booked.</span>
                  )}
                </li>
              ) : (
                <li key={`${offer.product}-${offer.rank ?? 0}`}>
                  <strong>{offer.name}</strong> · ${offer.monthlyUsd}/month
                  <span className="meta">
                    {offer.rank ? SPOT_NOTES[offer.rank] : (OFFER_NOTES[offer.product] ?? '')}
                    {!offer.rank && offer.left !== null
                      ? ` ${offer.left} of 3 left in this category.`
                      : ''}
                    {offer.trialDays > 0 && !offer.placement
                      ? ` First ${offer.trialDays} days free.`
                      : ''}
                  </span>
                  {offer.placement ? (
                    <span className="meta" data-testid={`placement-${offer.product}`}>
                      {offer.placement.status === 'held'
                        ? 'Paid, but someone took this spot first. We’ll refund you or offer the next opening.'
                        : `Active${offer.placement.endsAt ? ` until ${offer.placement.endsAt.toISOString().slice(0, 10)}` : ''}.`}
                    </span>
                  ) : offer.left === 0 ? (
                    <span className="meta">Taken.</span>
                  ) : (
                    <form method="post" action={`/owner/${listing.slug}/checkout`}>
                      <input type="hidden" name="product" value={offer.product} />
                      {offer.rank ? <input type="hidden" name="rank" value={offer.rank} /> : null}
                      <button type="submit" className="button">
                        {offer.rank ? `Get spot #${offer.rank}` : `Buy ${offer.name.toLowerCase()}`}
                        {offer.trialDays > 0 ? ` free for ${offer.trialDays} days` : ''}
                      </button>
                    </form>
                  )}
                </li>
              ),
            )}
          </ul>
          {cards ? (
            <section id="card" aria-labelledby="card-h" data-testid="sponsor-card">
              <h3 id="card-h">Your sponsored card</h3>
              <p className={styles.note}>
                It shows in your featured spot at the top of your category, labeled
                &quot;Sponsored&quot;, and links to your listing. Our staff check each version
                before it goes up; a live card stays up while a new version is reviewed.
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
