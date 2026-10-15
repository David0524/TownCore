import type { Metadata } from 'next';
import { NewsletterForm } from '@/components/NewsletterForm';
import styles from '@/components/NewsletterForm.module.css';
import { StandardPage } from '@/lib/pages';
import { newsletterOpen, SIGNUP_MESSAGES } from '@/lib/newsletter';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Newsletter', alternates: { canonical: '/newsletter' } };

export default async function NewsletterPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const town = await requireTown(params);
  const { s } = await searchParams;
  const message = s ? SIGNUP_MESSAGES[s] : undefined;
  const open = await newsletterOpen(town);
  return (
    <StandardPage town={town}>
      <h1 id="signup">The {town.siteName} newsletter</h1>
      {message && (
        <p className={styles.notice} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <p>
        Every morning: the weather, what happened in {town.name} yesterday, what’s coming up, and
        links to every record we wrote from. Free.
      </p>
      {open ? (
        <NewsletterForm source="/newsletter" />
      ) : (
        <p>Our free daily newsletter is launching soon.</p>
      )}
    </StandardPage>
  );
}
