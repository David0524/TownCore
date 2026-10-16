import { AI_ILLUSTRATION_LABEL, type ImageKind, type PhotoSpec } from '@towncore/config';
import styles from './visuals.module.css';

/**
 * A photo someone sent us, or an approved AI illustration (M9, CLAUDE.md §11c), served from the
 * town's own domain at a reserved 16:9 size. Underneath, always: a reader photo's own caption
 * ("Reader photo: …"), so it never passes as the story's scene; the credit line; and for an
 * illustration, the "Illustration (AI-generated)" label.
 */
export function SentPhoto({ kind, spec, alt }: { kind: ImageKind; spec: PhotoSpec; alt: string }) {
  const note =
    kind === 'reader-photo'
      ? `Reader photo: ${[spec.caption, spec.takenWhere, spec.takenWhen]
          .filter(Boolean)
          .join(', ')
          .replace(/[.\s]+$/, '')}.`
      : null;
  return (
    <div className={styles.stock} data-visual={kind}>
      <img
        src={`/photos/${spec.photoId}.jpg`}
        width={spec.width}
        height={spec.height}
        alt={alt}
        decoding="async"
        className={styles.stockImage}
      />
      <p className={`meta ${styles.stockCredit}`} data-testid="photo-credit">
        {kind === 'ai-illustration' ? (
          AI_ILLUSTRATION_LABEL
        ) : (
          <>
            {note ? `${note} ` : null}
            {spec.credit}
          </>
        )}
      </p>
    </div>
  );
}
