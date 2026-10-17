import { motifSvg, type MotifName } from '@towncore/brand';
import type { StyleFamily } from '@towncore/config';
import sharp from 'sharp';

// Logo art for every town (owner, 2026-10-17: "build the system, not one paper"; "We will do
// ChatGPT image prompts for now"). The launcher writes three ready-to-paste ChatGPT image
// prompts in the style of Boca's art (docs/brand/boca-town-square-logo.webp); the owner makes the
// image, and `pnpm identity import` cuts every identity asset from it (identity-assets.ts). No
// image API is called by code. The wordmark is always set in code, never drawn in the image.

export type LogoArtInput = {
  town: string;
  state: string;
  family: StyleFamily;
  palette: { accent: string; ink: string; tint: string; secondary?: string | undefined };
  motif: MotifName;
  identityNotes: string;
};

/** How many prompts a launch offers: one main and two alternates. */
export const LOGO_PROMPTS = 3;

/** Boca's look, for every town: what the image is. */
const STYLE =
  'A flat, bright vector-style illustration with crisp, clean edges and simple flat shading, not a heavy-outline cartoon. ' +
  'A wide panoramic vignette, about 3:1 (three times as wide as tall), of the town’s character: ' +
  'its waterfront or landscape, its architectural style, its trees and vegetation, and one tower or skyline element. ' +
  'Tall foreground trees frame the scene on the left and on the right. ' +
  'The scene fades out at its edges into a pure white background, with no border, frame, box or hard edge.';

/** The owner's limits, in every prompt; code also checks the inputs (logoInputProblems). */
export const LOGO_RULES = [
  'No text, letters, numbers, words, signs or logos anywhere in the image (the name is added separately).',
  'Evoke the town’s architectural character, but never draw a recognizable copy of a specific real building or landmark.',
  'No city seal, badge, crest, flag, emblem or official logo, and nothing that looks like a government sign or document.',
  'No people.',
  'Landscape image on a plain white background.',
];

/** Words that would make the art read as official, or that ask for text, in the inputs. */
const OFFICIAL =
  /\b(seal|crest|badge|emblem|coat of arms|flag|official|city hall|government|department|police|sheriff|logo of)\b/i;

/** Why the inputs can't go into a prompt (empty when they can). */
export function logoInputProblems(input: LogoArtInput): string[] {
  const problems: string[] = [];
  const hit = input.identityNotes.match(OFFICIAL)?.[0];
  if (hit) problems.push(`identity notes mention "${hit}": logo art never looks official`);
  if (/"[^"]+"|\btext\b|\blettering\b|\bwords?\b/i.test(input.identityNotes))
    problems.push('identity notes ask for text: the wordmark is set in code, not drawn');
  return problems;
}

/** The three prompts differ only in what leads the scene, never in style or rules. */
const VARIANTS = [
  'Center the scene on a tower or the tallest local building type, with the waterfront or main landscape in front.',
  'Lead with the landscape (water, hills, fields or forest, whichever fits the town), with low buildings in the town’s style along it and a small tower in the distance.',
  'Show a main street of buildings in the town’s style, trees along it, and the landscape opening out behind.',
];

/** One ready-to-paste ChatGPT image prompt (`option` 1–3). */
export function logoArtPrompt(input: LogoArtInput, option: number): string {
  const problems = logoInputProblems(input);
  if (problems.length) throw new Error(`Logo art input refused: ${problems.join('; ')}`);
  const colors = [input.palette.accent, input.palette.secondary].filter(Boolean).join(' and ');
  return [
    `Create a logo illustration for a local news site in ${input.town}, ${input.state}.`,
    STYLE,
    `About the place: ${input.identityNotes}`,
    `Include a ${input.motif.replace(/-/g, ' ')} somewhere in the scene.`,
    `Colors: the brand ${colors} for water, sky accents and roofs or awnings, natural greens for the trees, and warm building tones; keep it bright and clean.`,
    VARIANTS[(option - 1) % VARIANTS.length],
    ...LOGO_RULES,
  ].join('\n');
}

/**
 * Placeholder art for tests and fixtures only: the motif in the town's colors across a horizon
 * on white, wide like a real logo image. Deterministic. Never published as a town's art.
 */
export async function placeholderLogoArt(
  input: Pick<LogoArtInput, 'motif' | 'palette'>,
  size = { width: 1400, height: 640 },
): Promise<Uint8Array> {
  const { width, height } = size;
  const { accent, ink, tint } = input.palette;
  // [x, y, size] as shares of the canvas width and height: a tall motif at each side, framing.
  const layout = [
    [0.08, 0.1, 0.75],
    [0.4, 0.28, 0.55],
    [0.7, 0.1, 0.75],
  ];
  const shapes = layout
    .map(([x, y, k]) =>
      motifSvg(input.motif, Math.round(k! * height))
        .replace('<svg ', `<svg x="${Math.round(x! * width)}" y="${Math.round(y! * height)}" `)
        .replace(/currentColor/g, accent),
    )
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
    `<ellipse cx="${width / 2}" cy="${height * 0.86}" rx="${width * 0.44}" ry="${height * 0.06}" fill="${tint}"/>` +
    `<rect x="${width * 0.08}" y="${height * 0.85}" width="${width * 0.84}" height="${Math.max(4, height * 0.012)}" fill="${ink}"/>` +
    `${shapes}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
