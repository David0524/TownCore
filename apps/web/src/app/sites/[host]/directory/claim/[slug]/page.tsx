import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getListing } from '@towncore/directory';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { listingPath } from '@/lib/directory';
import { directoryMailDeps } from '@/lib/owner';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../../directory.module.css';

export const metadata: Metadata = { title: 'Claim this listing', robots: { index: false } };

type Props = {
  params: Promise<{ host: string; slug: string }>;
  searchParams: Promise<{ s?: string }>;
};

const MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  ok: {
    tone: 'ok',
    text: 'Check your inbox: we sent a link to confirm your email address. After you confirm, our staff review the claim, usually within two business days.',
  },
  invalid: {
    tone: 'error',
    text: 'Please fill in every field, use a valid email address and tick the box.',
  },
  rate_limited: {
    tone: 'error',
    text: 'Too many claims from your connection. Please try again in an hour.',
  },
  unavailable: {
    tone: 'error',
    text: 'Claims aren’t open on this site yet. Please try again soon.',
  },
};

/** Claim a listing (D-M6-4): we verify the email address, then staff approve. */
export default async function ClaimPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const { slug } = await params;
  const listing = await getListing(db(), town.id, slug);
  if (!listing) notFound();
  const message = MESSAGES[(await searchParams).s ?? ''];
  const open = directoryMailDeps() !== null;
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href={listingPath(listing)}>{listing.name}</Link> › Claim
      </p>
      <LargeTitle title={`Claim ${listing.name}`} as="h1" always />
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} data-testid="claim-message">
          {message.text}
        </p>
      ) : null}
      {listing.claimedAt ? (
        <p className={styles.note}>
          This listing is already managed by its owner. If you believe that&apos;s wrong, claim it
          anyway and our staff will look into it.
        </p>
      ) : null}
      {open && message?.tone !== 'ok' ? (
        <form
          method="post"
          action={`/directory/claim/${listing.slug}/submit`}
          className={styles.claim}
        >
          <p className={styles.note}>
            Claiming is free. Once our staff approve it, you can add your phone number, website,
            hours and a short description. Use an email address at the business if you have one.
          </p>
          <label>
            Your name
            <input name="name" required maxLength={100} autoComplete="name" />
          </label>
          <label>
            Your role at the business
            <input name="role" required maxLength={80} placeholder="Owner, manager…" />
          </label>
          <label>
            Business email
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label className={styles.check}>
            <input type="checkbox" name="attest" value="yes" required /> I am authorized to manage
            this business&apos;s listing.
          </label>
          {/* Hidden from people; bots fill it in. */}
          <div className="sr-only" aria-hidden="true">
            <label>
              Leave this empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button type="submit" className="button">
            Send me a confirmation link
          </button>
        </form>
      ) : null}
      {!open ? <p>Claims aren&apos;t open on this site yet. Please check back soon.</p> : null}
    </StandardPage>
  );
}
