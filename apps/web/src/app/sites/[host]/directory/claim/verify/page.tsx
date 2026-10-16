import type { Metadata } from 'next';
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
  searchParams: Promise<{ t?: string; s?: string }>;
}) {
  const town = await requireTown(params);
  const { t, s } = await searchParams;
  const result = s ? RESULTS[s] : undefined;
  return (
    <StandardPage town={town}>
      <LargeTitle title="Confirm your claim" as="h1" always />
      {result ? (
        <p role="status" data-testid="claim-result">
          {result}
        </p>
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
