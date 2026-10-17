import type { Metadata } from 'next';
import { directoryCategory } from '@towncore/config';
import { categoryQuoteRequests, localMonth, missedLine } from '@towncore/directory';
import { db } from '@/lib/db';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Confirm your claim', robots: { index: false } };

const RESULTS: Record<string, string> = {
  pending:
    'Thanks, your email address is confirmed. Our staff now review the claim, usually within two business days, and email you when it is approved.',
  expired: 'That link has expired. Go back to the listing and claim it again for a new link.',
  invalid: 'That link isn’t valid, or it has already been used.',
};

// Opened from the claim email. The button posts; a GET alone confirms nothing.
export default async function VerifyClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ t?: string; s?: string; c?: string }>;
}) {
  const town = await requireTown(params);
  const { t, s, c } = await searchParams;
  const result = s ? RESULTS[s] : undefined;
  // What happens next, from real counts (owner, 2026-10-17): the category's quote requests this
  // month, a public aggregate, shown only when there were some.
  const category = s === 'pending' ? directoryCategory(c ?? '') : null;
  const missed = category
    ? missedLine({
        count: await categoryQuoteRequests(db(), {
          townId: town.id,
          category: category.slug,
          timezone: town.timezone,
          month: localMonth(new Date(), town.timezone),
        }),
        category: category.slug,
        townName: town.name,
        period: 'this month',
      })
    : null;
  return (
    <StandardPage town={town}>
      <LargeTitle title="Confirm your claim" as="h1" always />
      {result ? (
        <>
          <p role="status" data-testid="claim-result">
            {result}
          </p>
          {s === 'pending' ? (
            <p data-testid="claim-next">
              Once it&rsquo;s approved, your owner page shows how often readers see your listing and
              how many call you.{missed ? ` ${missed}` : ''}
            </p>
          ) : null}
        </>
      ) : t ? (
        <form method="post" action="/directory/claim/verify/confirm">
          <input type="hidden" name="t" value={t} />
          <p>Press the button to confirm your email address for this claim.</p>
          <button type="submit" className="button">
            Confirm my claim
          </button>
        </form>
      ) : (
        <p>This link is missing its code.</p>
      )}
    </StandardPage>
  );
}
