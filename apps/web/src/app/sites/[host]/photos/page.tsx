import type { Metadata } from 'next';
import { readerLicense } from '@towncore/photos';
import formStyles from '@/components/NewsletterForm.module.css';
import { StandardPage } from '@/lib/pages';
import { PHOTO_MESSAGES, photosOpen } from '@/lib/photos';
import { requireTown } from '@/lib/town';
import styles from './photos.module.css';
import { THIN_PAGE } from '@/lib/indexing';

export const metadata: Metadata = {
  title: 'Send us a photo',
  alternates: { canonical: '/photos' },
  robots: THIN_PAGE,
};

/**
 * The reader photo form (M9, CLAUDE.md §11c): a plain multipart form with the license grant, the
 * credit line and a honeypot. Nothing appears until an editor approves it and writes alt text.
 */
export default async function PhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const town = await requireTown(params);
  const { s } = await searchParams;
  const message = s ? PHOTO_MESSAGES[s] : undefined;
  const license = readerLicense(town.siteName);
  return (
    <StandardPage town={town} shortOnPhones>
      <h1 id="send">Send us a photo</h1>
      {message && (
        <p
          className={formStyles.notice}
          role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid="photo-message"
        >
          {message.text}
        </p>
      )}
      <p>
        Took a good picture in {town.name}: the weather, an event, a sunset, a new building going
        up? Send it in. An editor looks at every photo before it appears, and we always print your
        credit line.
      </p>
      {!photosOpen() ? (
        <p>Photo submissions open soon.</p>
      ) : (
        <form
          method="post"
          action="/photos/send"
          encType="multipart/form-data"
          className={styles.form}
          data-testid="photo-form"
        >
          <label htmlFor="photo-file">Photo (JPEG, PNG or WebP, up to 12 MB)</label>
          <input
            id="photo-file"
            name="photo"
            type="file"
            required
            accept="image/jpeg,image/png,image/webp"
          />
          <label htmlFor="photo-caption">What it shows</label>
          <textarea id="photo-caption" name="caption" required maxLength={300} rows={2} />
          <div className={styles.pair}>
            <div>
              <label htmlFor="photo-where">Where (optional)</label>
              <input
                id="photo-where"
                name="where"
                maxLength={120}
                placeholder="A street or place"
              />
            </div>
            <div>
              <label htmlFor="photo-when">When (optional)</label>
              <input
                id="photo-when"
                name="when"
                maxLength={60}
                placeholder="e.g. Oct. 15, evening"
              />
            </div>
          </div>
          <label htmlFor="photo-credit">Credit line to print</label>
          <input
            id="photo-credit"
            name="credit"
            required
            maxLength={80}
            placeholder="Photo: Your Name"
          />
          <div className={styles.pair}>
            <div>
              <label htmlFor="photo-name">Your name</label>
              <input id="photo-name" name="name" required maxLength={120} autoComplete="name" />
            </div>
            <div>
              <label htmlFor="photo-email">Your email (never shown)</label>
              <input
                id="photo-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </div>
          </div>
          <label className={styles.agree}>
            <input type="checkbox" name="agree" value="yes" required />
            <span data-testid="photo-license">{license.text}</span>
          </label>
          <div className={formStyles.trap} aria-hidden="true">
            <label htmlFor="photo-website">Website</label>
            <input id="photo-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <button type="submit" className={styles.submit}>
            Send photo
          </button>
          <p className={formStyles.fine}>
            We remove location and camera data from every photo. We don’t publish photos of
            identifiable children, or of crime or accident scenes. <a href="/privacy">Privacy</a>
          </p>
        </form>
      )}
    </StandardPage>
  );
}
