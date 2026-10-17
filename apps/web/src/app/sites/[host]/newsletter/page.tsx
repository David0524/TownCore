import type { Metadata } from 'next';
import { NewsletterForm } from '@/components/NewsletterForm';
import styles from '@/components/NewsletterForm.module.css';
import { StandardPage } from '@/lib/pages';
import { newsletterOpen, SIGNUP_MESSAGES } from '@/lib/newsletter';
import { requireTown } from '@/lib/town';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Newsletter',
  alternates: { canonical: '/newsletter' },
  robots: THIN_PAGE,
};

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
      <h1 id="signup">The daily newsletter</h1>
      {message && (
        <p className={styles.notice} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <p>
        Every morning, {town.siteName} sends the weather, what happened in {town.name} yesterday,
        what’s coming up, and links to every record we wrote from. It’s free.
      </p>
      {open ? (
        <NewsletterForm source="/newsletter" />
      ) : (
        <p>Our free daily newsletter is launching soon.</p>
      )}
    </StandardPage>
  );
}
