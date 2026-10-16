import { illustrationSrc, type IllustrationSpec } from '@towncore/config';
import { plainAlt } from './alt';
import styles from './visuals.module.css';

/**
 * An AI-generated picture (CLAUDE.md §11c): a library illustration, or one a person pinned to the
 * story; generic, never the story's scene. No label (owner, 2026-10-16); the record of what it
 * is and who approved it stays in `images`.
 */
export function SectionIllustration({ spec, alt }: { spec: IllustrationSpec; alt: string }) {
  return (
    <div className={styles.stock} data-visual="section-illustration">
      <img
        src={illustrationSrc(spec.illustrationId)}
        width={spec.width}
        height={spec.height}
        alt={plainAlt(alt)}
        decoding="async"
        className={styles.stockImage}
      />
    </div>
  );
}

/** The same at list-row size. */
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
    </span>
  );
}
