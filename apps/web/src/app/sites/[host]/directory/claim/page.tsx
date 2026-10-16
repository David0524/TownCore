import type { Metadata } from 'next';
import Link from 'next/link';
import { directoryCategory } from '@towncore/config';
import { searchListings } from '@towncore/directory';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { directoryPath, listingDetail } from '@/lib/directory';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../directory.module.css';

export const metadata: Metadata = {
  title: 'Claim your listing',
  alternates: { canonical: '/directory/claim' },
};

/** Find your business to claim it (owner, 2026-10-16), or add it when it isn't listed. */
export default async function ClaimIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const town = await requireTown(params);
  const q = ((await searchParams).q ?? '').trim().slice(0, 80);
  const found = q ? await searchListings(db(), town.id, q, 20) : [];
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href={directoryPath()}>Places</Link> › Claim your listing
      </p>
      <LargeTitle title="Claim your listing" as="h1" always />
      <p className={styles.note}>
        Claiming is free. Find your business, confirm your email, and once an editor approves it you
        can add your phone, website, hours and a description.
      </p>
      <form action="/directory/claim" method="get" role="search" className={styles.search}>
        <label htmlFor="claim-q" className="sr-only">
          Business name
        </label>
        <input
          id="claim-q"
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
          <ul className={styles.claimList} data-testid="claim-results">
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
                  <span className="meta">Managed by its owner</span>
                ) : (
                  <Link href={`/directory/claim/${listing.slug}`} className="button">
                    Claim
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="claim-none">No listing matches &ldquo;{q}&rdquo;.</p>
        )
      ) : null}
      <p>
        Not listed? <Link href="/directory/add">Add your business</Link>. It&rsquo;s free too.
      </p>
    </StandardPage>
  );
}
