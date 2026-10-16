import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ownerListings } from '@towncore/directory';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import { currentOwner } from '@/lib/owner';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../../directory/directory.module.css';

export const metadata: Metadata = { title: 'Edit your listing', robots: { index: false } };

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
  const errors = (Array.isArray(e) ? e : e ? [e] : []).slice(0, 5);
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href="/owner">Your listings</Link> ›{' '}
        <Link href={listingPath(listing)}>View listing</Link>
      </p>
      <LargeTitle title={listing.name} as="h1" always />
      {s === 'saved' || s === 'review' ? (
        <p role="status" data-testid="owner-saved">
          Saved.
          {s === 'review' ? ' The new business name shows once our staff check it.' : ''}
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
    </StandardPage>
  );
}
