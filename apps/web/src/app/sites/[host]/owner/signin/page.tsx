import type { Metadata } from 'next';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

// Opened from the sign-in email. The button posts; a GET alone signs no one in, so link
// scanners in mail systems can't use up the link.
export default async function OwnerSignIn({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const town = await requireTown(params);
  const { t } = await searchParams;
  return (
    <StandardPage town={town}>
      <LargeTitle title="Sign in" as="h1" always />
      {t ? (
        <form method="post" action="/owner/session">
          <input type="hidden" name="t" value={t} />
          <p>Press the button to sign in and manage your listing on {town.siteName}.</p>
          <button type="submit" className="button">
            Sign in
          </button>
        </form>
      ) : (
        <p>This link is missing its code.</p>
      )}
    </StandardPage>
  );
}
