import type { Metadata } from 'next';
import { ownerListings } from '@towncore/directory';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { currentOwner, directoryMailDeps } from '@/lib/owner';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../directory/directory.module.css';

export const metadata: Metadata = { title: 'Manage your listing', robots: { index: false } };

const MESSAGES: Record<string, string> = {
  sent: 'If that address manages a listing here, a sign-in link is on its way. It works once and expires in 30 minutes.',
  invalid: 'That email address doesn’t look right.',
  unavailable: 'Sign-in isn’t open on this site yet. Please try again soon.',
  expired: 'That sign-in link has expired or was already used. Ask for a new one below.',
  out: 'You’re signed out.',
};

/** The owner portal (D-M6-11): sign in by email link, then the listings you manage. */
export default async function OwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const town = await requireTown(params);
  const message = MESSAGES[(await searchParams).s ?? ''];
  const email = await currentOwner(town);
  const listings = email ? await ownerListings(db(), town.id, email) : [];
  return (
    <StandardPage town={town}>
      <LargeTitle title="Manage your listing" as="h1" always />
      {message ? (
        <p role="status" data-testid="owner-message">
          {message}
        </p>
      ) : null}
      {email ? (
        <>
          <p className="muted">Signed in as {email}.</p>
          {listings.length > 0 ? (
            <Grouped
              title="Your listings"
              rows={listings.map((l) => ({
                key: l.id,
                href: `/owner/${l.slug}`,
                label: l.name,
                detail: l.pendingName
                  ? `New name waiting for review: ${l.pendingName}`
                  : l.licenseType,
              }))}
            />
          ) : (
            <p>You don&apos;t manage any listings on {town.siteName} yet.</p>
          )}
          <form method="post" action="/owner/signout">
            <button type="submit" className={`button ${styles.secondary}`}>
              Sign out
            </button>
          </form>
        </>
      ) : directoryMailDeps() ? (
        <form method="post" action="/owner/link" className={styles.claim}>
          <p className={styles.note}>
            Enter the email address on your approved claim. We&apos;ll send a sign-in link; there is
            no password. To manage a listing for the first time, claim it from its page in the
            directory.
          </p>
          <label>
            Email
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <button type="submit" className="button">
            Email me a sign-in link
          </button>
        </form>
      ) : (
        <p>Sign-in isn&apos;t open on this site yet.</p>
      )}
    </StandardPage>
  );
}
