// Network brand tokens (CLAUDE.md §11). Towns may override only site name and logo,
// so colors and fonts live here and nowhere else.

export const brandColors = {
  navy: '#16233A',
  brick: '#C2461F',
  teal: '#1F8A8A',
  paper: '#F6F1E7',
  slate: '#5B6475',
  white: '#FFFFFF',
} as const;

export type BrandColor = keyof typeof brandColors;

export const brandFonts = {
  headline: 'Source Serif 4',
  ui: 'Inter',
} as const;

/**
 * The only foreground/background pairs the site may use, and what for.
 * - `text`: body-size text, must meet WCAG AA (4.5:1).
 * - `large`: large text only (>= 24px, or >= 18.66px bold), must meet 3:1.
 * - `decoration`: non-text accents (rules, borders, icons), must meet 3:1.
 * Brick on navy is never allowed (CLAUDE.md §11).
 */
export const allowedColorPairs = [
  { fg: 'slate', bg: 'paper', use: 'text' },
  { fg: 'navy', bg: 'paper', use: 'text' },
  { fg: 'white', bg: 'brick', use: 'text' },
  { fg: 'white', bg: 'navy', use: 'text' },
  { fg: 'paper', bg: 'navy', use: 'text' },
  { fg: 'brick', bg: 'paper', use: 'large' },
  { fg: 'teal', bg: 'paper', use: 'decoration' },
] as const satisfies ReadonlyArray<{
  fg: BrandColor;
  bg: BrandColor;
  use: 'text' | 'large' | 'decoration';
}>;

export const forbiddenColorPairs = [{ fg: 'brick', bg: 'navy' }] as const;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = relativeLuminance(fgHex);
  const b = relativeLuminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
