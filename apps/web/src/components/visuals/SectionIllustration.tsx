import { AI_ILLUSTRATION_LABEL, illustrationSrc, type IllustrationSpec } from '@towncore/config';
import styles from './visuals.module.css';

/**
 * A section illustration from the network library (CLAUDE.md §11c): a generic AI-generated
 * picture of the kind of thing a story is about, never its scene. Always labeled underneath.
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
        {AI_ILLUSTRATION_LABEL}
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
        Illustration
      </span>
    </span>
  );
}
