import { aiLabel, illustrationSrc, type IllustrationSpec } from '@towncore/config';
import styles from './visuals.module.css';

/**
 * An AI-generated picture (CLAUDE.md §11c): a library illustration, or one a person pinned to the
 * story; generic, never the story's scene. Always labeled underneath, as an illustration or,
 * when photorealistic, an AI image.
 */
export function SectionIllustration({ spec, alt }: { spec: IllustrationSpec; alt: string }) {
  return (
    <div className={styles.stock} data-visual="section-illustration">
      <img
        src={illustrationSrc(spec.illustrationId)}
        width={spec.width}
        height={spec.height}
        alt={alt}
        decoding="async"
        className={styles.stockImage}
      />
      <p className={`meta ${styles.stockCredit}`} data-testid="photo-credit">
        {aiLabel(spec)}
      </p>
    </div>
  );
}

/** The same at list-row size, with a small "Illustration" tag so it's labeled there too. */
export function SectionIllustrationThumb({ spec }: { spec: IllustrationSpec }) {
  return (
    <span className={styles.thumbIllustration}>
      <img
        src={illustrationSrc(spec.illustrationId)}
        alt=""
        width={spec.width}
        height={spec.height}
        loading="lazy"
        decoding="async"
        className={styles.thumbImage}
      />
      <span className={styles.thumbTag} aria-hidden="true">
        {spec.photoreal ? 'AI image' : 'Illustration'}
      </span>
    </span>
  );
}
