import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ownerListings, previousMonth, proofReport } from '@towncore/directory';
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
