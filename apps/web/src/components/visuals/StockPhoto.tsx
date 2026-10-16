import type { StockPhotoSpec } from '@towncore/config';
import styles from './visuals.module.css';

/**
 * A licensed stock photo (CLAUDE.md §11c), only ever a generic illustration for an evergreen
 * guide. Shown from Unsplash's own servers, as its API guidelines require, at a reserved 16:9
 * size (no layout shift), and always with "Stock photo" and the photographer's credit, so it is
 * never mistaken for the scene itself.
 */
export function StockPhoto({
  spec,
  alt,
  siteName,
}: {
  spec: StockPhotoSpec;
  alt: string;
  siteName: string;
}) {
  // Unsplash asks for the app's name as utm_source on every link back.
  const appName = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const link = (url: string) => {
    const u = new URL(url);
    u.searchParams.set('utm_source', appName);
    u.searchParams.set('utm_medium', 'referral');
    return u.toString();
  };
  // Unsplash's image service crops and sizes on request.
  const sized = (width: number) => {
    const u = new URL(spec.src);
    u.searchParams.set('w', String(width));
    u.searchParams.set('h', String(Math.round((width * 9) / 16)));
    u.searchParams.set('fit', 'crop');
    u.searchParams.set('auto', 'format');
    u.searchParams.set('q', '75');
    return u.toString();
  };
  return (
    <div className={styles.stock} data-visual="stock">
      {/* Hotlinked by design: Unsplash requires its own URLs. */}
      <img
        src={sized(1200)}
        srcSet={[640, 960, 1200, 1600].map((w) => `${sized(w)} ${w}w`).join(', ')}
        sizes="(max-width: 600px) 100vw, 760px"
        width={1200}
        height={675}
        alt={alt}
        decoding="async"
        className={styles.stockImage}
      />
      <p className={`meta ${styles.stockCredit}`} data-testid="stock-credit">
        Stock photo. Photo by{' '}
        <a href={link(spec.photographerUrl)} rel="noopener">
          {spec.photographer}
        </a>{' '}
        on{' '}
        <a href={link('https://unsplash.com/')} rel="noopener">
          Unsplash
        </a>
      </p>
    </div>
  );
}
