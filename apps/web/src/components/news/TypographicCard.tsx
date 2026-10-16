import { motifPaths } from '@towncore/brand';
import type { Theme } from '@towncore/config';
import { beats } from '@towncore/config';
import { beatColorVar } from '@/lib/theme';
import styles from './news.module.css';

// The typographic card (CLAUDE.md §11c): the visual every story can have, built in code from the
// town's colors, its motif and the story's own text or records. No photo, no image model. It
// repeats what the page already says, so it's hidden from screen readers.

// Beat glyphs: simple stroke icons in our own SVG (24×24, round caps).
const beatGlyphs: Record<string, string[]> = {
  government: ['M3 21h18', 'M5 21V10', 'M19 21V10', 'M9 21v-7', 'M15 21v-7', 'M2 10l10-6 10 6z'],
  development: ['M4 21V9l8-5 8 5v12', 'M9 21v-6h6v6', 'M2 21h20'],
  business: ['M3 9l1.5-5h15L21 9', 'M4 9v12h16V9', 'M3 9h18', 'M10 21v-6h4v6'],
  schools: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c3 2 9 2 12 0v-5', 'M22 9v6'],
  'public-safety': ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  community: [
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M16 11a3 3 0 1 0 0-6',
    'M2 20c0-3 3-5 6-5s6 2 6 5',
    'M16 15c3 0 6 2 6 5',
  ],
};

function Glyph({ beat }: { beat: string }) {
  const paths = beatGlyphs[beat] ?? beatGlyphs.community!;
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export type CardFigure = { figure: string; label: string };

/**
 * `beat`: beat glyph, label and the headline. `number`: a big figure and what it counts, from
 * the story's own records (e.g. how many filings a roundup lists).
 */
export function TypographicCard({
  theme,
  beat,
  headline,
  figure,
  ratio = 'wide',
}: {
  theme: Theme;
  beat: string;
  headline: string;
  figure?: CardFigure | null;
  /** `thumb`: a small 3:2 tile beside a list row: the motif, the glyph and any figure. */
  ratio?: 'wide' | 'photo' | 'thumb';
}) {
  const label = beats.find((b) => b.slug === beat)?.label ?? beat;
  if (ratio === 'thumb') {
    return (
      <div className={`${styles.card} ${styles.cardThumb}`} aria-hidden="true" data-visual="thumb">
        <span className={styles.cardMotif} dangerouslySetInnerHTML={{ __html: motifSvg(theme) }} />
        {figure ? <span className={styles.thumbNumber}>{figure.figure}</span> : <span />}
        <span className={styles.cardGlyph}>
          <Glyph beat={beat} />
        </span>
      </div>
    );
  }
  return (
    <div
      className={`${styles.card} ${ratio === 'wide' ? styles.cardWide : styles.cardPhoto}`}
      aria-hidden="true"
      data-visual="typographic-card"
    >
      <span className={styles.cardMotif} dangerouslySetInnerHTML={{ __html: motifSvg(theme) }} />
      <span className={`${styles.cardTop} meta`}>
        <span className={styles.dot} style={{ background: beatColorVar(beat) }} />
        {label}
      </span>
      {figure ? (
        <span className={styles.cardFigure}>
          <span className={styles.cardNumber}>{figure.figure}</span>
          <span className={styles.cardFigureLabel}>{figure.label}</span>
        </span>
      ) : (
        <span className={styles.cardHeadline}>{headline}</span>
      )}
      <span className={styles.cardGlyph}>
        <Glyph beat={beat} />
      </span>
    </div>
  );
}

const motifSvg = (theme: Theme) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round">${motifPaths(theme.motif)}</svg>`;
