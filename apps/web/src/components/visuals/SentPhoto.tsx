import type { ImageKind, PhotoSpec } from '@towncore/config';
import { plainAlt } from './alt';
import styles from './visuals.module.css';

/**
 * A photo someone sent us, or an approved AI illustration (M9, CLAUDE.md §11c), served from the
 * town's own domain at a reserved 16:9 size. Underneath, always: a reader photo's own caption
 * ("Reader photo: …"), so it never passes as the story's scene, and the credit line. An AI
 * illustration has no label (owner, 2026-10-16).
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
        alt={plainAlt(alt)}
        decoding="async"
        className={styles.stockImage}
      />
      {kind === 'ai-illustration' ? null : (
        <p className={`meta ${styles.stockCredit}`} data-testid="photo-credit">
          {note ? `${note} ` : null}
          {spec.credit}
        </p>
      )}
    </div>
  );
}
