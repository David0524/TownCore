import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
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
  storefrontCategories,
} from '@towncore/directory';
import { CategoryIcon } from '@/components/directory/CategoryIcon';
import { WaitlistForm } from '@/components/directory/OwnerBar';
import { OFFERS, SPOTS, startPath, usd } from '@/lib/advertise';
import { db } from '@/lib/db';
import { categoryFlavor, directoryPath } from '@/lib/directory';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from './advertise.module.css';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Get your business featured',
  alternates: { canonical: '/advertise' },
  robots: THIN_PAGE,
};

/**
 * The directory's storefront, at the town's real current prices (owner, 2026-10-16, after
 * bocatownsquare.com; 2026-10-17, "a full build out of the advertise page… working in full"). A
 * business picks its category (each with its listing count, open spots and from-price), then a
 * featured spot (#1, #2 or #3) or the category sponsorship beside them; the Enhanced listing,
 * the morning email's week and the category's month have their own cards. Every "Get" button
 * leads to /advertise/start, which checks out a signed-in owner's claimed listing through Stripe
 * Checkout (D-M6-5) or shows how to claim one first. When every spot is sold, the waitlist is the
 * way in. Proof lines (readers, advertisers, testimonials) appear only when the real numbers clear
 * their minimums.
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
  const trial = pricing.free_trial_days;
  const [
    categories,
    listPrices,
    enhancedCents,
    newsletterCents,
    categoryCents,
    readers,
    advertisers,
    quotes,
    layout,
  ] = await Promise.all([
    storefrontCategories(db(), town),
    featuredPrices(db(), town, null),
    categoryPrice(db(), town, 'enhanced', null),
    categoryPrice(db(), town, 'newsletter', null),
    categoryPrice(db(), town, 'exclusive', category?.slug ?? null),
    readerReach(db(), town.id),
    advertiserCount(db(), town.id),
    approvedTestimonials(db(), town.id),
    townVariant(db(), 'advertise-tiers', town),
  ]);
  const chosen = category ? categories.find((c) => c.category.slug === category.slug) : undefined;
  // A category with no listings yet still sells its spots, at its own prices.
  const open: FeaturedRank[] | null = category
    ? (chosen?.open ?? (await openFeaturedRanks(db(), town.id, category.slug)))
    : null;
  const prices =
    chosen?.prices ?? (category ? await featuredPrices(db(), town, category.slug) : listPrices);
  const [newsletterWeeks, categoryMonths] = await Promise.all([
    newsletterCents
      ? openWindows(db(), {
          townId: town.id,
          timezone: town.timezone,
          product: 'newsletter',
          category: null,
        })
      : [],
    categoryCents && category
      ? openWindows(db(), {
          townId: town.id,
          timezone: town.timezone,
          product: 'exclusive',
          category: category.slug,
        })
      : [],
  ]);
  const proof = socialProofLine(advertisers, town.name);
  const contact = townContactEmail(config);
  const categoryName = category ? category.name.toLowerCase() : null;
  const pickFirst = (
    <a href="#choose" className={styles.pick}>
      Pick a category first
    </a>
  );

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
        <span className={styles.action}>
          {!category ? (
            pickFirst
          ) : taken ? null : (
            <Link
              href={startPath('sponsored_slot', { category: category.slug, rank })}
              className="button"
            >
              Get spot #{rank}
            </Link>
          )}
        </span>
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
        Your card in the header of {categoryName ?? 'a category'}, one business a month.
      </span>
      {categoryCents ? (
        <span className={styles.action}>
          {!category ? (
            pickFirst
          ) : categoryMonths.length ? (
            <Link
              href={startPath('exclusive', { category: category.slug })}
              className={`button ${styles.quiet}`}
            >
              Get started
            </Link>
          ) : (
            <span className="meta">Every upcoming month is booked.</span>
          )}
        </span>
      ) : null}
    </li>
  );

  const cards = [
    enhancedCents
      ? {
          product: 'enhanced' as const,
          cents: enhancedCents,
          note: trial > 0 ? `The first ${trial} days are free.` : null,
          href: startPath('enhanced'),
        }
      : null,
    newsletterCents
      ? {
          product: 'newsletter' as const,
          cents: newsletterCents,
          note: newsletterWeeks.length
            ? `Open: ${newsletterWeeks
                .slice(0, 3)
                .map((w) => w.label.replace('Week of ', ''))
                .join(', ')}${newsletterWeeks.length > 3 ? ' and later' : ''}.`
            : 'Every upcoming week is booked.',
          href: newsletterWeeks.length ? startPath('newsletter') : null,
        }
      : null,
    categoryCents
      ? {
          product: 'exclusive' as const,
          cents: categoryCents,
          note: category
            ? categoryMonths.length
              ? `Open: ${categoryMonths.map((w) => w.label).join(', ')}.`
              : 'Every upcoming month is booked.'
            : 'Pick your category on the next step.',
          href:
            !category || categoryMonths.length
              ? startPath('exclusive', { category: category?.slug ?? null })
              : null,
        }
      : null,
  ].filter((c) => c !== null);

  const chooser = (
    <ul className={styles.categories}>
      {categories.map((c) => {
        const flavor = categoryFlavor(c.category.slug);
        return (
          <li key={c.category.slug}>
            <Link
              href={`/advertise?category=${c.category.slug}#spots`}
              className={styles.categoryLink}
              aria-current={c.category.slug === category?.slug ? 'true' : undefined}
              data-testid={`choose-${c.category.slug}`}
            >
              <span
                className={styles.round}
                style={
                  {
                    '--tint-bg': `var(--food-${flavor})`,
                    '--tint-ink': `var(--food-${flavor}-ink)`,
                  } as CSSProperties
                }
              >
                <CategoryIcon category={c.category} />
              </span>
              <span className={styles.categoryText}>
                <strong>{c.category.name}</strong>
                <span className={styles.categoryMeta}>
                  {c.count.toLocaleString('en-US')} {c.count === 1 ? 'place' : 'places'}
                </span>
                <span className={styles.categoryMeta} data-open={c.open.length > 0 || undefined}>
                  {c.open.length
                    ? `${c.open.length} of ${featuredRanks.length} open`
                    : 'All taken, waitlist open'}
                </span>
              </span>
              <span className={styles.from}>
                From {usd(c.fromCents)}
                <span className={styles.per}> a month</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  // Before the spots until a category is picked; after them, folded, once one is.
  const chooserSection =
    categories.length > 0 ? (
      <section id="choose" aria-labelledby="choose-h" data-testid="category-chooser">
        <h2 id="choose-h">{category ? 'Another category?' : 'Pick your category'}</h2>
        {category ? (
          <details className={styles.chooser}>
            <summary>Show all {categories.length} categories</summary>
            {chooser}
          </details>
        ) : (
          chooser
        )}
      </section>
    ) : null;

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

      {category ? null : chooserSection}

      <section id="spots" aria-labelledby="spots-h">
        <h2 id="spots-h">{category ? `Featured spots in ${category.name}` : 'Featured spots'}</h2>
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
            : ' Prices are per category and can change from month to month for new bookings; pick a category to see its current price. What you pay never changes while you keep your spot.'}
        </p>
      </section>

      {category ? chooserSection : null}

      {cards.length ? (
        <section aria-labelledby="more-h">
          <h2 id="more-h">More ways to be seen</h2>
          <ul className={styles.cards} data-testid="advertise-bookings">
            {cards.map((card) => (
              <li key={card.product} className={styles.card} data-testid={`offer-${card.product}`}>
                <strong className={styles.title}>{OFFERS[card.product].title}</strong>
                <span className={styles.price}>
                  {usd(card.cents)}
                  <span className={styles.per}> {OFFERS[card.product].per}</span>
                </span>
                <span className={styles.where}>{OFFERS[card.product].where(categoryName)}</span>
                {card.note ? <span className="meta">{card.note}</span> : null}
                {card.href ? (
                  <Link href={card.href} className={`button ${styles.quiet}`}>
                    Get started
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="meta">
            A booked week or month is paid once through Stripe; an editor checks your card before it
            runs.
          </p>
        </section>
      ) : null}

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

      <h2 id="claim">How it works</h2>
      <ol className={styles.steps}>
        <li>Pick what you want above and press its button.</li>
        <li>
          Find your business in <Link href="/directory/claim">Places</Link> (or{' '}
          <Link href="/directory/add">add it</Link> if it isn&rsquo;t listed) and claim it.
          It&rsquo;s free: we email you a link to confirm, and an editor checks the first claim of
          every listing.
        </li>
        <li>
          Check out with Stripe in one step from your owner page. Already claimed?{' '}
          <Link href="/owner">Sign in</Link> and go straight there.
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
      <p className="meta">
        Something else in mind, like a sponsorship on the homepage? Write to{' '}
        <a href={`mailto:${contact}?subject=${encodeURIComponent('Advertising')}`}>{contact}</a>.
      </p>
    </StandardPage>
  );
}
