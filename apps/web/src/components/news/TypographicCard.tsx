import styles from './news.module.css';
import { beatColorVar } from '@/lib/theme';

// The title card (CLAUDE.md §11c; docs/plans/default-images.md): the last-resort visual, a
// generic label slate in the town's brand color, like a news channel's "Breaking News" slate
// (owner, 2026-10-17). One label for the kind of story, the section's dot and the site name;
// never the story's own headline (it's beside the card) and never a drawing. It repeats what the
// page already says, so it's hidden from screen readers.

export type CardFigure = { figure: string; label: string };

/**
 * `label`: what kind of story this is ("Property Sales", "Breaking News"; `cardLabel()` in
 * @towncore/config). `figure`: a count from the story's own records, shown under the label.
 */
export function TypographicCard({
  label,
  siteName,
  beat,
  figure,
  ratio = 'wide',
}: {
  label: string;
  siteName: string;
  beat: string;
  figure?: CardFigure | null;
  /** `thumb`: a small 3:2 tile beside a list row: the label alone. */
  ratio?: 'wide' | 'photo' | 'thumb';
}) {
  const dot = <span className={styles.slateDot} style={{ background: beatColorVar(beat) }} />;
  if (ratio === 'thumb') {
    return (
      <div className={`${styles.card} ${styles.cardThumb}`} aria-hidden="true" data-visual="thumb">
        <span className={styles.thumbLabel}>{label}</span>
      </div>
    );
  }
  return (
    <div
      className={`${styles.card} ${ratio === 'wide' ? styles.cardWide : styles.cardPhoto}`}
      aria-hidden="true"
      data-visual="typographic-card"
      data-label={label}
    >
      <span className={styles.slateLabel}>
        {dot}
        {label}
      </span>
      {figure ? (
        <span className={styles.slateFigure}>
          {figure.figure} {figure.label}
        </span>
      ) : null}
      <span className={styles.slateSite}>{siteName}</span>
    </div>
  );
}
