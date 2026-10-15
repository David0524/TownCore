import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { subscriberForToken } from '@towncore/mail';
import styles from '@/components/NewsletterForm.module.css';
import { StandardPage } from '@/lib/pages';
import { bulkDeps } from '@/lib/newsletter';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Your subscription', robots: { index: false } };

// The newsletter footer's unsubscribe link (brief §7.3): one button, no login. It leads to the
// same result as the one-click header. Someone who left can subscribe again (double opt-in).
export default async function SubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string; token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const town = await requireTown(params);
  const { token } = await params;
  const { done } = await searchParams;
  const deps = bulkDeps();
  const sub = deps ? await subscriberForToken(deps, decodeURIComponent(token)) : null;
  if (!sub || sub.townId !== town.id) notFound();
  const subscribed = sub.status === 'active' || sub.status === 'pending';
  return (
    <StandardPage town={town}>
      <h1>Your {town.siteName} newsletter</h1>
      {done && (
        <p className={styles.notice} role="status">
          {sub.email} is unsubscribed. You won’t get the newsletter again.
        </p>
      )}
      {subscribed ? (
        <form method="post" action={`/api/newsletter/unsubscribe/${token}`}>
          <input type="hidden" name="from" value="page" />
          <p>
            Stop sending the newsletter to <strong>{sub.email}</strong>?
          </p>
          <button type="submit">Unsubscribe</button>
        </form>
      ) : (
        <form method="post" action="/newsletter/subscribe">
          {!done && <p>{sub.email} isn’t subscribed.</p>}
          <input type="hidden" name="email" value={sub.email} />
          <input type="hidden" name="source" value="/u" />
          <p>Changed your mind? We’ll send a link to confirm.</p>
          <button type="submit">Subscribe again</button>
        </form>
      )}
    </StandardPage>
  );
}
