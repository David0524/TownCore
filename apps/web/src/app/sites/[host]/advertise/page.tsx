import type { Metadata } from 'next';
import Link from 'next/link';
import {
  directoryCategory,
  featuredRanks,
  scarcityLine,
  townContactEmail,
  townPricing,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import { townVariant } from '@towncore/db';
import {
  advertiserCount,
  approvedTestimonials,
  categoryPrice,
  featuredPrices,
  openFeaturedRanks,
  openWindows,
  readerReach,
  socialProofLine,
} from '@towncore/directory';
import { WaitlistForm } from '@/components/directory/OwnerBar';
import { db } from '@/lib/db';
import { directoryPath } from '@/lib/directory';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from './advertise.module.css';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Get your business featured',
  alternates: { canonical: '/advertise' },
  robots: THIN_PAGE,
};

const SPOTS: Record<FeaturedRank, { title: string; where: string }> = {
  1: {
    title: 'Top spot',
    where: 'The first business on its category page, above everything else.',
  },
  2: { title: 'Second spot', where: 'Right below the Top spot, above every other listing.' },
  3: { title: 'Third spot', where: 'Below #2, still above every other listing.' },
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/**
 * What the directory sells, at the town's real current prices (owner, 2026-10-16, after
 * bocatownsquare.com; 2026-10-17, "Grow ad and directory revenue"): featured spots #1, #2 and #3
 * per category side by side, the category sponsorship beside them as the premium option, the
 * first month free, bought by the business itself from its claimed listing through Stripe
 * Checkout (D-M6-5). With `?category=`, it shows that category's own prices and which spots are
 * open; when all are sold, the waitlist. Proof lines (readers, advertisers, testimonials) appear
 * only when the real numbers clear their minimums.
 */
export default async function AdvertisePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ category?: string; waitlist?: string }>;
}) {
  const town = await requireTown(params);
  const config = town.config as TownConfig;
  const pricing = townPricing(town);
  const { category: rawCategory, waitlist } = await searchParams;
  const category = directoryCategory(rawCategory ?? '');
  const open = category ? await openFeaturedRanks(db(), town.id, category.slug) : null;
  const prices = await featuredPrices(db(), town, category?.slug ?? null);
  const trial = pricing.free_trial_days;
  // Self-serve bookings, shown only when switched on and priced for this town (D-M6-6).
  const newsletterCents = await categoryPrice(db(), town, 'newsletter', null);
  const categoryCents = await categoryPrice(db(), town, 'exclusive', category?.slug ?? null);
  const newsletterWeeks = newsletterCents
    ? await openWindows(db(), {
        townId: town.id,
        timezone: town.timezone,
        product: 'newsletter',
        category: null,
      })
    : [];
  const categoryMonths =
    categoryCents && category
      ? await openWindows(db(), {
          townId: town.id,
          timezone: town.timezone,
          product: 'exclusive',
          category: category.slug,
        })
      : [];
  const [readers, advertisers, quotes, layout] = await Promise.all([
    readerReach(db(), town.id),
    advertiserCount(db(), town.id),
    approvedTestimonials(db(), town.id),
    townVariant(db(), 'advertise-tiers', town),
  ]);
  const proof = socialProofLine(advertisers, town.name);
  const contact = townContactEmail(config);

  const spotTiles = featuredRanks.map((rank) => {
    const taken = open !== null && !open.includes(rank);
    return (
      <li
        key={rank}
        className={styles.spot}
        data-top={rank === 1 || undefined}
        data-taken={taken || undefined}
        data-testid={`tier-${rank}`}
      >
        <span className={styles.rank}>#{rank}</span>
        <strong className={styles.title}>{SPOTS[rank].title}</strong>
        <span className={styles.price}>
          {usd(prices[rank])}
          <span className={styles.per}> a month</span>
        </span>
        <span className={styles.where}>{SPOTS[rank].where}</span>
        {open !== null ? <span className={styles.status}>{taken ? 'Taken' : 'Open'}</span> : null}
      </li>
    );
  });
  const premiumTile = (
    <li key="premium" className={styles.spot} data-premium data-testid="tier-premium">
      <span className={styles.rank}>Premium</span>
      <strong className={styles.title}>Category sponsor</strong>
      {categoryCents ? (
        <span className={styles.price}>
          {usd(categoryCents)}
          <span className={styles.per}> a month</span>
        </span>
      ) : (
        <span className={styles.price}>
          <a href={`mailto:${contact}?subject=${encodeURIComponent('Category sponsorship')}`}>
            Ask us
          </a>
        </span>
      )}
      <span className={styles.where}>
        Your card in the header of {category ? category.name.toLowerCase() : 'a category'}, one
        business a month.
      </span>
    </li>
  );

  return (
    <StandardPage town={town} shortOnPhones>
      <h1>Get your business featured</h1>
      <p className={styles.lead}>
        Featured spots put your business at the top of its category in {town.siteName}&rsquo;s
        directory, where {town.name} readers look for a{' '}
        {category ? category.singular : 'restaurant, a plumber or a place to shop'}.
        {trial > 0 ? ` Your first ${trial} days are free.` : ''}
      </p>
      {readers || proof ? (
        <p className={styles.proof} data-testid="advertise-proof">
          {readers
            ? `${readers.toLocaleString('en-US')} ${town.name} readers get our morning email. `
            : ''}
          {proof ?? ''}
        </p>
      ) : null}
      {category ? (
        <p className="meta" data-testid="advertise-category">
          Spots in <Link href={directoryPath(category.slug)}>{category.name}</Link>:{' '}
          {open && open.length > 0
            ? `${open.map((r) => `#${r}`).join(', ')} open`
            : 'all taken right now'}
          . {scarcityLine(open?.length ?? 0, featuredRanks.length, category.name)}
        </p>
      ) : null}
      <ul className={styles.spots} data-testid="featured-spots">
        {layout === 'premium-first' ? [premiumTile, ...spotTiles] : [...spotTiles, premiumTile]}
      </ul>
      {category && open?.length === 0 ? (
        <section id="waitlist" aria-label="Waitlist">
          <WaitlistForm category={category} source="advertise" status={waitlist} />
        </section>
      ) : null}
      <p className="meta">
        {trial > 0
          ? `The first ${trial} days of your first spot are free: cancel before then and you pay nothing. After that, `
          : ''}
        Stripe bills you monthly.{' '}
        <Link href="/owner" data-testid="cancel-anytime">
          Cancel anytime
        </Link>{' '}
        from your owner page, in one step on Stripe&rsquo;s billing page. One business per spot in
        each category.
        {category
          ? ''
          : ' Prices are per category and can change from month to month for new bookings; a category’s page shows its current price, and what you pay never changes while you keep your spot.'}
      </p>

      {quotes.length ? (
        <section aria-labelledby="quotes-h">
          <h2 id="quotes-h">From businesses that advertise here</h2>
          <ul className={styles.quotes} data-testid="testimonials">
            {quotes.map((q) => (
              <li key={q.id}>
                <figure>
                  <blockquote>{q.quote}</blockquote>
                  <figcaption>{q.attribution}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 id="claim">How to get one</h2>
      <ol className={styles.steps}>
        <li>
          Find your business in <Link href="/directory/claim">Places</Link> (or{' '}
          <Link href="/directory/add">add it</Link> if it isn&rsquo;t listed).
        </li>
        <li>
          Claim the listing. It&rsquo;s free: we email you a link to confirm, and an editor checks
          the first claim of every listing.
        </li>
        <li>
          On your <Link href="/owner">owner page</Link>, pick an open spot and check out with
          Stripe. Already claimed? <Link href="/owner">Sign in</Link> and go straight there.
        </li>
        <li>
          Write a short card about your business. An editor checks it, and it goes up labeled
          &ldquo;Sponsored.&rdquo;
        </li>
      </ol>

      <h2>What a spot doesn&rsquo;t do</h2>
      <p>
        Featured spots are always labeled Sponsored, and payment never changes the order of the
        listings below them, which is the same for everyone: a verified license, complete details
        and recent updates first. Our news coverage is never for sale.
      </p>

      {newsletterCents || categoryCents ? (
        <>
          <h2>Book a week or a month</h2>
          <ul className={styles.steps} data-testid="advertise-bookings">
            {newsletterCents ? (
              <li>
                <strong>Morning email sponsor</strong>, {usd(newsletterCents)} a week: your card at
                the top of every issue for one week, labeled Sponsored.{' '}
                {newsletterWeeks.length
                  ? `Open: ${newsletterWeeks
                      .slice(0, 4)
                      .map((w) => w.label.replace('Week of ', ''))
                      .join(', ')}${newsletterWeeks.length > 4 ? ' and later' : ''}.`
                  : 'Every upcoming week is booked.'}
              </li>
            ) : null}
            {categoryCents ? (
              <li>
                <strong>Category sponsor</strong>, {usd(categoryCents)} a month: your card in the
                header of {category ? category.name.toLowerCase() : 'your category'} for one month.{' '}
                {category
                  ? categoryMonths.length
                    ? `Open: ${categoryMonths.map((w) => w.label).join(', ')}.`
                    : 'Every upcoming month is booked.'
                  : ''}
              </li>
            ) : null}
          </ul>
          <p className="meta">
            Paid once through Stripe from your owner page; an editor checks your card before it
            runs.
          </p>
        </>
      ) : null}

      <h2>Also available</h2>
      <p>
        An enhanced listing (${pricing.enhanced_usd} a month
        {trial > 0 ? `, the first ${trial} days free` : ''}) marks your listing in its category. For
        a sponsorship on the homepage or in the morning email, write to{' '}
        <a href={`mailto:${contact}?subject=${encodeURIComponent('Advertising')}`}>{contact}</a>.
      </p>
    </StandardPage>
  );
}
