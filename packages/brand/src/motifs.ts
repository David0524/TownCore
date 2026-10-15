// Motif library (CLAUDE.md §10b): simple single-color line icons drawn on a 24×24 grid.
// They use currentColor, so they always take the theme's ink. Add new motifs by human review.

export type Motif = { name: string; label: string; paths: string[] };

export const motifLibrary = {
  'palm-frond': {
    name: 'palm-frond',
    label: 'Palm frond',
    paths: [
      'M4 21C8 15.5 12 10.5 20 4',
      'M6.6 17.6L3.8 13.2',
      'M6.6 17.6L10.6 19.2',
      'M9.1 14.5L7.2 9.4',
      'M9.1 14.5L13.8 15.6',
      'M11.9 11.5L10.9 6.4',
      'M11.9 11.5L16.8 12',
      'M15 8.6L14.6 4',
      'M15 8.6L19.4 8.4',
    ],
  },
  lighthouse: {
    name: 'lighthouse',
    label: 'Lighthouse',
    paths: [
      'M9.2 21L10.2 9.5H13.8L14.8 21Z',
      'M9.6 9.5H14.4V6.6H9.6Z',
      'M9.2 6.6L12 3.6L14.8 6.6',
      'M9.8 14H14.2',
      'M9.5 17.6H14.5',
      'M3.6 6.4L8.2 7.8',
      'M20.4 6.4L15.8 7.8',
      'M5 21H19',
    ],
  },
} as const satisfies Record<string, Motif>;

export type MotifName = keyof typeof motifLibrary;

/** The motif as a standalone SVG (for inline use, favicons and OG images later). */
export function motifSvg(name: MotifName, size = 24, title?: string): string {
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"` +
    ` fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"` +
    `${title ? ' role="img"' : ' aria-hidden="true"'}>${label}${motifPaths(name)}</svg>`
  );
}

export function motifPaths(name: MotifName): string {
  return motifLibrary[name].paths.map((d) => `<path d="${d}"/>`).join('');
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
