import type { Metadata } from 'next';
import Link from 'next/link';
import { directoryCategories } from '@towncore/config';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { directoryPath } from '@/lib/directory';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import styles from '../directory.module.css';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Add your business',
  alternates: { canonical: '/directory/add' },
  robots: THIN_PAGE,
};

const MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  sent: {
    tone: 'ok',
    text: 'Thanks! An editor checks every new business, usually within two business days. Once it’s listed, you can claim it to add your hours and a description.',
  },
  missing: { tone: 'error', text: 'Please give the business’s name.' },
  contact: { tone: 'error', text: 'Please give your name and a valid email address.' },
  category: { tone: 'error', text: 'Please pick the kind of business.' },
  rate: { tone: 'error', text: 'Thanks! That’s enough for now; please try again in an hour.' },
  error: { tone: 'error', text: 'Something went wrong. Please try again.' },
};

/** "Add your business" (owner, 2026-10-16): free, checked by an editor before it's listed. */
export default async function AddBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const town = await requireTown(params);
  const message = MESSAGES[(await searchParams).s ?? ''];
  const kinds = [...directoryCategories].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <StandardPage town={town}>
      <p className="meta">
        <Link href={directoryPath()}>Places</Link> › Add your business
      </p>
      <LargeTitle title="Add your business" as="h1" always />
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} data-testid="add-message">
          {message.text}
        </p>
      ) : null}
      {message?.tone !== 'ok' ? (
        <form
          method="post"
          action="/directory/add/submit"
          className={styles.claim}
          data-testid="add-form"
        >
          <p className={styles.note}>
            Listings in {town.siteName} are free. If your business is already in Places, claim that
            listing instead. An editor checks every new business before it appears.
          </p>
          <label>
            Business name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Kind of business
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Pick one
              </option>
              {kinds.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Street address (shown on the listing; leave empty if you work from home)
            <input name="address" maxLength={160} autoComplete="street-address" />
          </label>
          <label>
            ZIP code
            <input name="zip" maxLength={10} inputMode="numeric" autoComplete="postal-code" />
          </label>
          <label>
            Business phone (optional)
            <input name="phone" type="tel" maxLength={30} autoComplete="tel" />
          </label>
          <label>
            Website (optional)
            <input name="site" maxLength={300} autoComplete="url" />
          </label>
          <label>
            Your name
            <input name="contact" required maxLength={120} autoComplete="name" />
          </label>
          <label>
            Your email (never shown)
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label>
            Anything we should know (optional)
            <textarea name="note" maxLength={500} rows={3} />
          </label>
          {/* Hidden from people; bots fill it in. */}
          <div className="sr-only" aria-hidden="true">
            <label>
              Leave this empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button type="submit" className="button">
            Send for review
          </button>
        </form>
      ) : (
        <p>
          <Link href={directoryPath()}>Back to Places</Link>
        </p>
      )}
    </StandardPage>
  );
}
