import type { Metadata } from 'next';
import Link from 'next/link';
import {
  directoryCategory,
  directoryProducts,
  featuredRanks,
  type FeaturedRank,
} from '@towncore/config';
import {
  categoryCounts,
  eligibleListings,
  listingsHolding,
  ownerListings,
  parseStartRequest,
  searchListings,
  startOffer,
  type StartRequest,
} from '@towncore/directory';
import { WaitlistForm } from '@/components/directory/OwnerBar';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { OFFERS, SPOTS, startPath, usd } from '@/lib/advertise';
import { db } from '@/lib/db';
import { listingDetail } from '@/lib/directory';
import { THIN_PAGE } from '@/lib/indexing';
import { currentOwner } from '@/lib/owner';
import { StandardPage } from '@/lib/pages';
import { stripe } from '@/lib/stripe';
import { requireTown } from '@/lib/town';
import directory from '../../directory/directory.module.css';
import styles from '../advertise.module.css';

export const metadata: Metadata = {
  title: 'Get started',
  alternates: { canonical: '/advertise' },
  robots: THIN_PAGE,
};

type Search = {
  product?: string;
  category?: string;
  rank?: string;
  period?: string;
  q?: string;
};

/** "Featured spot #1 in Plumbers", "Morning email sponsor", "Category sponsor: Plumbers". */
function offerTitle(request: Pick<StartRequest, 'product' | 'category' | 'rank'>): string {
  if (request.product === 'sponsored_slot')
    return `Featured spot #${request.rank} in ${request.category!.name}`;
  const title = OFFERS[request.product].title;
  return request.category ? `${title}: ${request.category.name}` : title;
}

/**
 * The second step of buying from the advertise page (owner, 2026-10-17): what the offer is, at
 * its current price, then either the signed-in owner's claimed listings, each one press away
 * from Stripe Checkout (the same checkout as the owner page; only the verified webhook turns a
 * placement on), or, for a visitor, how to find and claim their listing first. Claiming keeps
 * its email confirmation and an editor's check; nothing here signs anyone in.
 */
export default async function AdvertiseStartPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<Search>;
}) {
  const town = await requireTown(params);
  const search = await searchParams;
  const parsed = parseStartRequest(search);

  if (!parsed.ok) {
    // A category product without a category: pick one here, keeping the rest of the request.
    if (parsed.reason === 'needs_category' && parsed.product) {
      const counts = await categoryCounts(db(), town.id);
      const title =
        parsed.product === 'sponsored_slot' ? 'Featured spot' : OFFERS[parsed.product].title;
      return (
        <StandardPage town={town} shortOnPhones>
          <p className="meta">
            <Link href="/advertise">Advertise</Link> › Get started
          </p>
          <LargeTitle title={title} as="h1" always />
          <form
            method="get"
            action="/advertise/start"
            className={directory.claim}
            data-testid="start-category"
          >
            <input type="hidden" name="product" value={parsed.product} />
            {parsed.rank ? <input type="hidden" name="rank" value={parsed.rank} /> : null}
            <label>
              Your kind of business
              <select name="category" required defaultValue="">
                <option value="" disabled>
                  Pick one
                </option>
                {counts.map(({ category }) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button">
              Continue
            </button>
          </form>
        </StandardPage>
      );
    }
    return (
      <StandardPage town={town} shortOnPhones>
        <LargeTitle title="Get started" as="h1" always />
        <p data-testid="start-invalid">
          That offer isn&rsquo;t available. <Link href="/advertise">See what is</Link>.
        </p>
      </StandardPage>
    );
  }

  const request = parsed.request;
  const def = directoryProducts[request.product];
  const categoryName = request.category ? request.category.name.toLowerCase() : null;
  const [offer, email] = await Promise.all([startOffer(db(), town, request), currentOwner(town)]);
  const checkoutOpen = stripe() !== null && offer.cents !== null;
  const per = def.period ? `for one ${def.period}` : 'a month';
  const where =
    request.product === 'sponsored_slot'
      ? SPOTS[request.rank!].where.replace('its category page', `the ${categoryName} page`)
      : OFFERS[request.product].where(categoryName);
  const otherRanks = offer.openRanks.filter((r) => r !== request.rank);
  const firstWindow = offer.windows[0];
  const chosenWindow =
    offer.windows.find((w) => w.start === request.period)?.start ?? firstWindow?.start;

  // The owner's listings that can buy this, and which of them already have it.
  const owned = email ? await ownerListings(db(), town.id, email) : [];
  const eligible = eligibleListings(owned, request);
  const holding = await listingsHolding(
    db(),
    eligible.map((l) => l.id),
    request.product,
  );
  // A visitor's search for their business, among this category's listings for a category product.
  const q = (search.q ?? '').trim().slice(0, 80);
  const found =
    !email && q ? await searchListings(db(), town.id, q, 20, request.category?.slug) : [];
  const keep = {
    product: request.product,
    category: request.category?.slug ?? null,
    rank: request.rank,
    period: request.period,
  };

  return (
    <StandardPage town={town} shortOnPhones>
      <p className="meta">
        <Link
          href={request.category ? `/advertise?category=${request.category.slug}` : '/advertise'}
        >
          Advertise
        </Link>{' '}
        › Get started
      </p>
      <LargeTitle title={offerTitle(request)} as="h1" always />

      <dl className={styles.summary} data-testid="start-summary">
        <div>
          <dt>What it is</dt>
          <dd>
            {request.product === 'sponsored_slot'
              ? `${SPOTS[request.rank!].title} among ${categoryName}: a labeled card with your business, linking to your listing.`
              : `${OFFERS[request.product].title}${def.period ? `, booked for one ${def.period}` : ', month to month'}.`}
          </dd>
        </div>
        <div>
          <dt>Where it shows</dt>
          <dd>{where}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd data-testid="start-price">
            {offer.cents !== null ? `${usd(offer.cents)} ${per}` : 'Not on sale here yet'}
            {def.period
              ? ', paid once.'
              : '. Stripe bills you monthly; cancel anytime from your owner page.'}
          </dd>
        </div>
        {offer.trialDays > 0 ? (
          <div>
            <dt>Free trial</dt>
            <dd data-testid="start-trial">
              The first {offer.trialDays} days are free when it&rsquo;s your business&rsquo;s first{' '}
              {request.product === 'sponsored_slot' ? 'spot' : 'Enhanced listing'}: cancel before
              then and you pay nothing.
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="meta">
        Always labeled Sponsored, and it never changes the order of other listings. An editor checks
        your card before it runs. Our news coverage is never for sale.
      </p>

      {!offer.available ? (
        <section aria-label="Not available" data-testid="start-sold-out">
          {request.product === 'sponsored_slot' ? (
            otherRanks.length ? (
              <p>
                Spot #{request.rank} in {categoryName} is taken.{' '}
                {otherRanks.map((r: FeaturedRank, i) => (
                  <span key={r}>
                    {i > 0 ? ' or ' : ''}
                    <Link
                      href={startPath('sponsored_slot', {
                        category: request.category!.slug,
                        rank: r,
                      })}
                    >
                      Get spot #{r}
                    </Link>
                  </span>
                ))}{' '}
                instead.
              </p>
            ) : (
              <>
                <p>
                  All {featuredRanks.length} featured spots in {categoryName} are taken right now.
                  Join the waitlist and we&rsquo;ll email you once when one opens.
                </p>
                <WaitlistForm category={request.category!} source="advertise" />
              </>
            )
          ) : (
            <p>
              Every upcoming {def.period ?? 'period'} is booked.{' '}
              <Link href="/advertise">See the other ways to advertise</Link>.
            </p>
          )}
        </section>
      ) : !checkoutOpen ? (
        <p data-testid="start-unavailable">
          Paid placements aren&rsquo;t open on {town.siteName} yet. Please check back soon.
        </p>
      ) : email ? (
        <section aria-labelledby="buy-h" data-testid="start-owner">
          <h2 id="buy-h">Pick your listing</h2>
          <p className="meta">Signed in as {email}.</p>
          {offer.periodTaken && firstWindow ? (
            <p role="status" data-testid="start-period-taken">
              That {def.period} is booked. The next open one is {firstWindow.label}.
            </p>
          ) : null}
          {eligible.length > 0 ? (
            <ul className={styles.buyList}>
              {eligible.map((listing) => (
                <li key={listing.id} data-testid="start-listing">
                  <div>
                    <strong>{listing.name}</strong>
                    <div className="meta">
                      {directoryCategory(listing.category ?? '')?.singular ?? 'Listing'}
                    </div>
                  </div>
                  {holding.has(listing.id) ? (
                    <span className="meta">
                      You already have this.{' '}
                      <Link href={`/owner/${listing.slug}#promote`}>Manage it</Link>
                    </span>
                  ) : (
                    <form
                      method="post"
                      action={`/owner/${listing.slug}/checkout`}
                      className={styles.buyForm}
                    >
                      <input type="hidden" name="product" value={request.product} />
                      {request.rank ? (
                        <input type="hidden" name="rank" value={request.rank} />
                      ) : null}
                      {def.period ? (
                        <label>
                          {def.period === 'week' ? 'Week' : 'Month'}
                          <select name="period" defaultValue={chosenWindow}>
                            {offer.windows.map((w) => (
                              <option key={w.start} value={w.start}>
                                {w.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <button type="submit" className="button">
                        Continue to secure checkout
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="start-no-listing">
              {owned.length
                ? `None of your listings are in ${categoryName}.`
                : `You don’t manage a listing on ${town.siteName} yet.`}{' '}
              <Link href="/directory/claim">Find and claim yours</Link>, or{' '}
              <Link href="/directory/add">add your business</Link>.
            </p>
          )}
          <p className="meta">
            Checkout opens on Stripe&rsquo;s secure page; we never see your card. You come back to
            your owner page afterwards to write your card.
          </p>
        </section>
      ) : (
        <section aria-labelledby="find-h" data-testid="start-find">
          <h2 id="find-h">1. Find your business</h2>
          <p className={directory.note}>
            You buy from your listing, so claim it first. Claiming is free: we email you a link to
            confirm, and an editor checks the first claim of every listing. Once it&rsquo;s
            approved, checkout is one press from your owner page.
          </p>
          <form action="/advertise/start" method="get" role="search" className={directory.search}>
            <input type="hidden" name="product" value={keep.product} />
            {keep.category ? <input type="hidden" name="category" value={keep.category} /> : null}
            {keep.rank ? <input type="hidden" name="rank" value={keep.rank} /> : null}
            {keep.period ? <input type="hidden" name="period" value={keep.period} /> : null}
            <label htmlFor="start-q" className="sr-only">
              Business name
            </label>
            <input
              id="start-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Your business name"
              autoComplete="organization"
              required
              minLength={2}
            />
            <button type="submit" className="button">
              Find it
            </button>
          </form>
          {q ? (
            found.length > 0 ? (
              <ul className={directory.claimList} data-testid="start-results">
                {found.map((listing) => (
                  <li key={listing.id}>
                    <div>
                      <strong>{listing.name}</strong>
                      <div className="meta">
                        {[
                          directoryCategory(listing.category ?? '')?.singular,
                          listingDetail(town, listing),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {listing.claimedAt ? (
                      <span className="meta">Already claimed</span>
                    ) : (
                      <Link href={`/directory/claim/${listing.slug}`} className="button">
                        Claim
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p data-testid="start-none">
                No {categoryName ?? 'listing'} matches &ldquo;{q}&rdquo;.
              </p>
            )
          ) : null}
          <p>
            Not listed? <Link href="/directory/add">Add it</Link>. It&rsquo;s free too.
          </p>
          <h2>2. Check out</h2>
          <p>
            Already claimed? <Link href="/owner">Sign in to your owner page</Link> with the email on
            your claim, then come back here, or pick this from your owner page.
          </p>
        </section>
      )}
    </StandardPage>
  );
}
