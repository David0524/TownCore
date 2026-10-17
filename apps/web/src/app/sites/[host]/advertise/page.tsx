import type { Metadata } from 'next';
import Link from 'next/link';
import {
  directoryCategory,
  featuredRanks,
  productPrice,
  townContactEmail,
  type FeaturedRank,
  type TownConfig,
} from '@towncore/config';
import { openFeaturedRanks, openWindows } from '@towncore/directory';
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

/**
 * What the directory sells, at the town's real prices (owner, 2026-10-16, after
 * bocatownsquare.com): featured spots #1, #2 and #3 per category, the first month free, bought by
 * the business itself from its claimed listing through Stripe Checkout (D-M6-5). With
 * `?category=`, the page says which spots in that category are still open.
 */
export default async function AdvertisePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const town = await requireTown(params);
  const config = town.config as TownConfig;
  const { pricing } = config;
  const category = directoryCategory((await searchParams).category ?? '');
  const open = category ? await openFeaturedRanks(db(), town.id, category.slug) : null;
  const trial = pricing.free_trial_days;
  // Self-serve bookings, shown only when switched on and priced for this town (D-M6-6).
  const prices = pricing as Record<string, unknown>;
  const newsletterUsd = productPrice(prices, 'newsletter');
  const categoryUsd = productPrice(prices, 'exclusive');
  const newsletterWeeks = newsletterUsd
    ? await openWindows(db(), {
        townId: town.id,
        timezone: town.timezone,
        product: 'newsletter',
        category: null,
      })
    : [];
  const categoryMonths =
    categoryUsd && category
      ? await openWindows(db(), {
          townId: town.id,
          timezone: town.timezone,
          product: 'exclusive',
          category: category.slug,
        })
      : [];

  return (
    <StandardPage town={town} shortOnPhones>
      <h1>Get your business featured</h1>
      <p className={styles.lead}>
        Featured spots put your business at the top of its category in {town.siteName}&rsquo;s
        directory, where {town.name} readers look for a{' '}
        {category ? category.singular : 'restaurant, a plumber or a place to shop'}.
        {trial > 0 ? ` Your first ${trial} days are free.` : ''}
      </p>
      {category ? (
        <p className="meta" data-testid="advertise-category">
          Spots in <Link href={directoryPath(category.slug)}>{category.name}</Link>:{' '}
          {open && open.length > 0
            ? `${open.map((r) => `#${r}`).join(', ')} open`
            : 'all taken right now'}
          .
        </p>
      ) : null}
      <ul className={styles.spots} data-testid="featured-spots">
        {featuredRanks.map((rank) => {
          const taken = open !== null && !open.includes(rank);
          return (
            <li key={rank} className={styles.spot} data-taken={taken || undefined}>
              <span className={styles.rank}>#{rank}</span>
              <strong className={styles.title}>{SPOTS[rank].title}</strong>
              <span className={styles.price}>
                ${pricing.featured_usd[rank - 1]}
                <span className={styles.per}> a month</span>
              </span>
              <span className={styles.where}>{SPOTS[rank].where}</span>
              {open !== null ? (
                <span className={styles.status}>{taken ? 'Taken' : 'Open'}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="meta">
        {trial > 0
          ? `The first ${trial} days of your first spot are free: cancel before then and you pay nothing. After that, `
          : ''}
        Stripe bills you monthly, and you can cancel anytime from your owner page. One business per
        spot in each category.
      </p>

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

      {newsletterUsd || categoryUsd ? (
        <>
          <h2>Book a week or a month</h2>
          <ul className={styles.steps} data-testid="advertise-bookings">
            {newsletterUsd ? (
              <li>
                <strong>Morning email sponsor</strong>, ${newsletterUsd} a week: your card at the
                top of every issue for one week, labeled Sponsored.{' '}
                {newsletterWeeks.length
                  ? `Open: ${newsletterWeeks
                      .slice(0, 4)
                      .map((w) => w.label.replace('Week of ', ''))
                      .join(', ')}${newsletterWeeks.length > 4 ? ' and later' : ''}.`
                  : 'Every upcoming week is booked.'}
              </li>
            ) : null}
            {categoryUsd ? (
              <li>
                <strong>Category sponsor</strong>, ${categoryUsd} a month: your card in the header
                of {category ? category.name.toLowerCase() : 'your category'} for one month.{' '}
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
        <a href={`mailto:${townContactEmail(config)}?subject=${encodeURIComponent('Advertising')}`}>
          {townContactEmail(config)}
        </a>
        .
      </p>
    </StandardPage>
  );
}
