import { mastheadSvg, type MastheadStyle } from './masthead';
import { escapeXml, motifPaths, type MotifName } from './motifs';

// Site-level identity assets for a new town (CLAUDE.md §10b "derived assets"), drawn in code from
// the theme: no image model, no city seal. The launcher renders each SVG to PNG at its exact size
// (Playwright) for the launch report and the manual Facebook and newsletter setup. App icons and
// per-article share images are drawn by the web app itself.

export const siteAssets = {
  /** Facebook page cover (the recommended size, 1640×624). */
  'facebook-cover': { width: 1640, height: 624 },
  /** Default Open Graph image for pages without their own (1200×630). */
  'share-default': { width: 1200, height: 630 },
  /** Social profile picture (square; platforms crop it to a circle). */
  'social-avatar': { width: 512, height: 512 },
  /** Top of the daily email (600 wide, the email-safe width). */
  'newsletter-header': { width: 600, height: 120 },
} as const;
export type SiteAsset = keyof typeof siteAssets;

export type AssetInput = {
  siteName: string;
  /** "Delray Beach, Florida" for the share card's second line. */
  place: string;
  masthead: MastheadStyle;
  motif: MotifName;
  palette: { ink: string; accent: string; accentText: string; tint: string; background: string };
  /** A CSS font-family stack available where the SVG is rendered (the launcher loads the town's fonts). */
  fontFamily: string;
  fontWeight: number;
  advanceEm: number;
};

/** The masthead SVG scaled into a box, centered, in `color`. */
function placedMasthead(
  input: AssetInput,
  box: { x: number; y: number; w: number; h: number },
  color: string,
) {
  const inner = mastheadSvg({
    siteName: input.siteName,
    style: input.masthead,
    motif: input.motif,
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    advanceEm: input.advanceEm,
  });
  const [, , vw, vh] = inner
    .match(/viewBox="([^"]+)"/)![1]!
    .split(' ')
    .map(Number) as [number, number, number, number];
  const scale = Math.min(box.w / vw, box.h / vh);
  const x = box.x + (box.w - vw * scale) / 2;
  const y = box.y + (box.h - vh * scale) / 2;
  const body = inner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})" color="${color}">${body}</g>`;
}

const motif = (name: MotifName, x: number, y: number, size: number, color: string, width = 1.6) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${motifPaths(name)}</g>`;

export function siteAssetSvg(kind: SiteAsset, input: AssetInput): string {
  const { width, height } = siteAssets[kind];
  const p = input.palette;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(input.siteName)}">`;
  let body: string;
  switch (kind) {
    case 'facebook-cover':
      // Facebook overlays the profile picture bottom-left on desktop and crops the sides on
      // phones, so the wordmark sits in the middle 60% and the motif pattern fills the edges.
      body =
        `<rect width="${width}" height="${height}" fill="${p.tint}"/>` +
        motif(input.motif, 60, 60, 160, p.accent, 0.9) +
        motif(input.motif, width - 220, height - 220, 160, p.accent, 0.9) +
        placedMasthead(input, { x: width * 0.2, y: 150, w: width * 0.6, h: 250 }, p.ink) +
        `<text x="${width / 2}" y="470" text-anchor="middle" font-family="${escapeXml(input.fontFamily)}" font-size="34" fill="${p.ink}">${escapeXml(input.place)}</text>`;
      break;
    case 'share-default':
      body =
        `<rect width="${width}" height="${height}" fill="${p.background}"/>` +
        `<rect y="${height - 18}" width="${width}" height="18" fill="${p.accent}"/>` +
        placedMasthead(input, { x: 100, y: 150, w: width - 200, h: 230 }, p.ink) +
        `<text x="${width / 2}" y="470" text-anchor="middle" font-family="${escapeXml(input.fontFamily)}" font-size="36" fill="${p.ink}">${escapeXml(input.place)}</text>`;
      break;
    case 'social-avatar':
      // The motif alone, centered in a circle-safe area, on the brand color.
      body =
        `<rect width="${width}" height="${height}" fill="${p.accent}"/>` +
        motif(input.motif, 136, 136, 240, p.accentText, 1.4);
      break;
    case 'newsletter-header':
      body =
        `<rect width="${width}" height="${height}" fill="${p.background}"/>` +
        placedMasthead(input, { x: 30, y: 14, w: width - 60, h: height - 34 }, p.ink) +
        `<rect y="${height - 4}" width="${width}" height="4" fill="${p.accent}"/>`;
      break;
  }
  return `${open}${body}</svg>`;
}
