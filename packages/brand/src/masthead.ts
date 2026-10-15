import { escapeXml, motifPaths, type MotifName } from './motifs';

// SVG wordmarks generated in code from the site name, headline font and motif (CLAUDE.md §11a,
// §10b). No image model, no city seal or official logo. Text stays live <text> in the town's
// headline font: sharp, editable and accessible. Converting to outlines for favicons and OG
// images comes with those assets (M4/M7).

export const mastheadStyleNames = ['centered-serif', 'left-motif'] as const;
export type MastheadStyle = (typeof mastheadStyleNames)[number];

export type MastheadInput = {
  siteName: string;
  style: MastheadStyle;
  motif: MotifName;
  /** CSS font-family value; normally var(--font-headline). */
  fontFamily?: string;
  /** Mean glyph advance of the headline font at `fontWeight`, in em (from the type set). */
  advanceEm?: number;
  /** The display face's headline weight; single-weight faces use 400, never a faked bold. */
  fontWeight?: number;
};

// The viewBox is sized from the font's measured mean advance; textLength then fits the text
// exactly by nudging letter spacing (never glyph shapes).
const DEFAULT_ADVANCE_EM = 0.52;
const FONT_SIZE = 40;

export function mastheadSvg({
  siteName,
  style,
  motif,
  fontFamily = 'var(--font-headline)',
  advanceEm = DEFAULT_ADVANCE_EM,
  fontWeight = 700,
}: MastheadInput): string {
  const name = escapeXml(siteName.trim());
  const textWidth = Math.round(siteName.trim().length * FONT_SIZE * advanceEm);
  const textAttrs =
    `font-family="${escapeXml(fontFamily)}" font-size="${FONT_SIZE}" font-weight="${fontWeight}" fill="currentColor"` +
    ` textLength="${textWidth}" lengthAdjust="spacing"`;
  const icon = (x: number, y: number, size: number) =>
    `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="currentColor"` +
    ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${motifPaths(motif)}</g>`;

  if (style === 'centered-serif') {
    // Motif centered above the name, a hairline rule under it.
    const width = textWidth + 8;
    const height = 116;
    const cx = width / 2;
    return svg(width, height, siteName, [
      icon(cx - 22, 0, 44),
      `<text x="${cx}" y="90" text-anchor="middle" ${textAttrs}>${name}</text>`,
      `<path d="M${cx - textWidth * 0.3} 108H${cx + textWidth * 0.3}" stroke="currentColor" stroke-width="1.5"/>`,
    ]);
  }

  // left-motif: motif to the left of the name, one line.
  const iconSize = 40;
  const gap = 12;
  const width = iconSize + gap + textWidth + 4;
  const height = 52;
  return svg(width, height, siteName, [
    icon(0, 4, iconSize),
    `<text x="${iconSize + gap}" y="40" ${textAttrs}>${name}</text>`,
  ]);
}

function svg(width: number, height: number, label: string, children: string[]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"` +
    ` aria-label="${escapeXml(label)}" data-masthead>${children.join('')}</svg>`
  );
}
