import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadEnv } from '@towncore/config';
import { ownerForMailToken } from '@towncore/directory';
import { db } from '@/lib/db';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Emails about your listing', robots: { index: false } };

// The unsubscribe link in owner reports and follow-ups: one button, no login, the same result as
// the one-click header. Account mail (sign-in links, claim decisions, quote requests) still goes.
export default async function OwnerStopPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string; token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const town = await requireTown(params);
  const { token } = await params;
  const { done } = await searchParams;
  const secret = loadEnv().MAIL_TOKEN_SECRET;
  const business = secret
    ? await ownerForMailToken(db(), { secret, token: decodeURIComponent(token), townId: town.id })
    : null;
  if (!business) notFound();
  return (
    <StandardPage town={town}>
      <h1>Emails about {business.name}</h1>
      {done || business.optOut ? (
        <p role="status" data-testid="owner-stopped">
          Done. {town.siteName} won’t send monthly reports or tips about your listing again. You
          still get the emails you ask for, like sign-in links and quote requests.
        </p>
      ) : (
        <form method="post" action={`/api/owner/unsubscribe/${token}`}>
          <input type="hidden" name="from" value="page" />
          <p>
            Stop monthly reports and tips about your listing on {town.siteName}
            {business.email ? (
              <>
                {' '}
                to <strong>{business.email}</strong>
              </>
            ) : null}
            ?
          </p>
          <button type="submit" className="button">
            Unsubscribe
          </button>
        </form>
      )}
    </StandardPage>
  );
}
