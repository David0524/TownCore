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
  pine: {
    name: 'pine',
    label: 'Pine',
    paths: ['M12 3L7.6 9H10.2L6.4 14H9.2L5.2 19H18.8L14.8 14H17.6L13.8 9H16.4Z', 'M12 19V21.5'],
  },
  'mountain-ridge': {
    name: 'mountain-ridge',
    label: 'Mountain ridge',
    paths: [
      'M2.5 19L8.5 10.5L11.8 15',
      'M9.6 19L15.5 7.5L21.5 19',
      'M13.5 11.3L14.6 12.3L15.5 11.2L16.4 12.3L17.5 11.3',
      'M2 19H22',
    ],
  },
  river: {
    name: 'river',
    label: 'River',
    paths: [
      'M3 8C5 6.4 7 6.4 9 8S13 9.6 15 8 19 6.4 21 8',
      'M3 12.5C5 10.9 7 10.9 9 12.5S13 14.1 15 12.5 19 10.9 21 12.5',
      'M3 17C5 15.4 7 15.4 9 17S13 18.6 15 17 19 15.4 21 17',
    ],
  },
  bridge: {
    name: 'bridge',
    label: 'Bridge',
    paths: [
      'M7 19V5',
      'M17 19V5',
      'M2 12.5C4.5 12.5 6.2 9.5 7 5C7.8 9.5 9.6 12 12 12S16.2 9.5 17 5C17.8 9.5 19.5 12.5 22 12.5',
      'M2 15H22',
      'M10 12V15',
      'M14 12V15',
      'M4 19H20',
    ],
  },
  'clock-tower': {
    name: 'clock-tower',
    label: 'Clock tower',
    paths: [
      'M8.5 21V9.5H15.5V21',
      'M7.8 9.5L12 3.5L16.2 9.5',
      'M10 13.5A2 2 0 1 0 14 13.5A2 2 0 1 0 10 13.5',
      'M12 12.4V13.5H13',
      'M10.8 21V18.2H13.2V21',
      'M6 21H18',
    ],
  },
  'water-tower': {
    name: 'water-tower',
    label: 'Water tower',
    paths: [
      'M7 6.5H17V11.5H7Z',
      'M7 6.5C8.5 4 15.5 4 17 6.5',
      'M8.2 11.5L6.4 21',
      'M15.8 11.5L17.6 21',
      'M7.4 16H16.6',
      'M12 2.8V4.6',
      'M5 21H19',
    ],
  },
  citrus: {
    name: 'citrus',
    label: 'Citrus slice',
    paths: [
      'M4.5 13A7.5 7.5 0 1 0 19.5 13A7.5 7.5 0 1 0 4.5 13',
      'M12 13V6.4',
      'M12 13L17.7 9.7',
      'M12 13L17.7 16.3',
      'M12 13V19.6',
      'M12 13L6.3 16.3',
      'M12 13L6.3 9.7',
      'M12 5.5C12.5 3.6 14.2 2.6 16.2 3C15.7 4.8 14 5.6 12 5.5Z',
    ],
  },
  sailboat: {
    name: 'sailboat',
    label: 'Sailboat',
    paths: [
      'M12 3V16',
      'M12 4.2L18.2 15H12',
      'M10.6 6.5L5.8 15H10.6',
      'M3.8 17.2H20.2L17.8 20.5H6.2Z',
    ],
  },
  oak: {
    name: 'oak',
    label: 'Oak',
    paths: [
      'M7.2 15.2C4.4 15.2 3.2 12.4 4.8 10.6C4 7.6 6.6 5.6 8.8 6.4C9.6 3.6 14.4 3.6 15.2 6.4C17.4 5.6 20 7.6 19.2 10.6C20.8 12.4 19.6 15.2 16.8 15.2Z',
      'M12 15.2V21',
      'M12 17.6L9.8 15.2',
      'M12 16.8L14.2 15.2',
      'M8 21H16',
    ],
  },
  'grain-elevator': {
    name: 'grain-elevator',
    label: 'Grain elevator',
    paths: [
      'M4.5 21V8.5L7.5 5.5L10.5 8.5V21',
      'M7.5 5.5V2.8',
      'M10.5 21V11.5H14.5V21',
      'M14.5 21V11.5H18.5V21',
      'M10.5 11.5C11.2 9.6 13.8 9.6 14.5 11.5',
      'M14.5 11.5C15.2 9.6 17.8 9.6 18.5 11.5',
      'M6.4 12H8.6',
      'M3 21H21',
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
