import type { Metadata } from 'next';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Confirm your subscription', robots: { index: false } };

// Opened from the confirmation email. The button posts; a GET alone confirms nothing.
export default async function ConfirmPage({
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
      <h1>Confirm your subscription</h1>
      {t ? (
        <form method="post" action="/newsletter/confirmed">
          <input type="hidden" name="t" value={t} />
          <p>Press the button to start getting the {town.siteName} newsletter.</p>
          <button type="submit">Confirm my subscription</button>
        </form>
      ) : (
        <p>
          This link is missing its code. <a href="/newsletter">Sign up again</a>.
        </p>
      )}
    </StandardPage>
  );
}
