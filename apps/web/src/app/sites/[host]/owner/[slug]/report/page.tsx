import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { directoryCategory } from '@towncore/config';
import {
  categoryQuoteRequests,
  featuredUplift,
  ownerListings,
  paidInMonth,
  previousMonth,
  proofReport,
} from '@towncore/directory';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { currentOwner } from '@/lib/owner';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../../../directory/directory.module.css';

export const metadata: Metadata = { title: 'Your report', robots: { index: false } };

type Props = {
  params: Promise<{ host: string; slug: string }>;
  searchParams: Promise<{ month?: string }>;
};

const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-15T12:00:00Z`),
  );

/** The proof report (D-M6-10): what the listing and its paid placements did, by month. */
export default async function ReportPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const email = await currentOwner(town);
  if (!email) redirect('/owner');
  const { slug } = await params;
  const listing = (await ownerListings(db(), town.id, email)).find((l) => l.slug === slug);
  if (!listing) notFound();
  const now = new Date();
  const thisMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: town.timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const requested = (await searchParams).month;
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : thisMonth;
  const totals = await proofReport(db(), {
    businessId: listing.id,
    timezone: town.timezone,
    month,
  });
  const rows: Array<[string, number]> = [
    ['Listing views', totals.listingViews],
    ['Sponsored card views', totals.cardImpressions],
    ['Sponsored card clicks', totals.cardClicks],
    ['Calls (taps on your call button)', totals.calls],
    ['Quote requests', totals.quoteRequests],
  ];
  const last = previousMonth(now, town.timezone);
  // An owner without a featured spot sees what one did for listings like theirs, and the quote
  // requests in their category that went to featured businesses (owner, 2026-10-17).
  const featured = await paidInMonth(db(), listing.id, month, 'sponsored_slot');
  const category = directoryCategory(listing.category ?? '');
  const uplift = featured ? null : await featuredUplift(db(), { category: category?.slug ?? null });
  const missed =
    featured || !category
      ? 0
      : await categoryQuoteRequests(db(), {
          townId: town.id,
          category: category.slug,
          timezone: town.timezone,
          month,
        });
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href={`/owner/${listing.slug}`}>{listing.name}</Link> › Report
      </p>
      <LargeTitle title={`${monthName(month)} report`} as="h1" always />
      <dl className={styles.facts} data-testid="report">
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      <p className={`muted ${styles.note}`}>
        Counted without cookies or tracking: a view is your listing&apos;s contact area or your card
        being on screen; a call is a tap on your call button.{' '}
        {month === thisMonth ? 'This month so far.' : ''}
      </p>
      {uplift ? (
        <section aria-labelledby="featured-h" data-testid="report-featured">
          <h2 id="featured-h">What a featured spot would add</h2>
          {category ? (
            <p data-testid="report-missed">
              {missed === 1
                ? '1 quote request'
                : `${missed.toLocaleString('en-US')} quote requests`}{' '}
              for {category.name.toLowerCase()} {month === thisMonth ? 'this month' : 'that month'}{' '}
              went to businesses with a featured spot. Quote requests go only to them.
            </p>
          ) : null}
          {uplift.status === 'ok' ? (
            <dl className={styles.facts} data-testid="report-uplift">
              <dt>Listing views a month, featured</dt>
              <dd>{uplift.featuredViews}</dd>
              <dt>Listing views a month, not featured</dt>
              <dd>{uplift.unfeaturedViews}</dd>
              <dt>Quote requests a month, featured</dt>
              <dd>{uplift.featuredQuotes}</dd>
              <dt>Quote requests a month, not featured</dt>
              <dd>{uplift.unfeaturedQuotes}</dd>
            </dl>
          ) : null}
          <p className={`muted ${styles.note}`} data-testid="report-basis">
            {uplift.basis}
          </p>
          <p className="meta">
            <Link href={`/owner/${listing.slug}#promote-h`}>See open spots and prices</Link>
          </p>
        </section>
      ) : null}
      <p className="meta">
        {month === thisMonth ? (
          <Link href={`?month=${last}`}>See {monthName(last)}</Link>
        ) : (
          <Link href="?">See this month</Link>
        )}
      </p>
    </StandardPage>
  );
}
