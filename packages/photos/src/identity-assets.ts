import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

// Every identity asset, cut in code from a town's logo art (owner, 2026-10-17). This automates
// what was done by hand for Boca (apps/web/public/brand/boca-raton): the art's white background
// made transparent for the homepage hero (3:1, like Boca's 1221×407), its left part (Boca's left
// palm and tower) for the icons (the browser tab's on transparent, the Home Screen's on white,
// with a maskable version inside Android's safe zone),
// and the share, avatar, cover and email header images on white. Boca's set is the reference the
// tests compare against.

/** The files cut from the art, kept in apps/web/public/brand/<slug>/. */
export const IDENTITY_FILES = [
  'hero.webp',
  'icon-32.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'social-avatar.png',
  'share-default.png',
  'newsletter-header.png',
  'facebook-cover.png',
] as const;
export type IdentityFile = (typeof IDENTITY_FILES)[number];

/** The homepage hero's size: Boca's. */
export const HERO_SIZE = { width: 1221, height: 407 } as const;
/** How wide the icons' left part is, as a multiple of the art's height (Boca's icon art). */
const ICON_ASPECT = 1.85;
/**
 * Margin around the art in the maskable Home Screen icon. Android crops maskable icons to a
 * circle 80% of the icon's width; at this margin even the corners of the wide icon art stay
 * inside it, so the town's art is never clipped on an Android Home Screen.
 */
export const MASKABLE_MARGIN = 0.15;
/** Pixels this far from white (0–255) and joined to the edge are background. */
const BACKGROUND = 24;

export type DerivedAsset = { bytes: Uint8Array; width: number; height: number };
export type Region = { left: number; top: number; width: number; height: number };

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 255, g: 255, b: 255, alpha: 0 };

/**
 * The art with its white background made transparent and trimmed to what's drawn. Only white
 * joined to the image's edges is background, so white walls and boats inside the scene stay;
 * alpha rises over the last few shades so edges stay soft.
 */
export async function cutOut(
  art: Uint8Array,
  region?: Region,
): Promise<{ png: Buffer; width: number; height: number }> {
  const source = region ? sharp(art).extract(region) : sharp(art);
  const { data, info } = await sharp(await source.png().toBuffer())
    .flatten({ background: WHITE })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const distance = (p: number) => 255 - Math.min(data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!);
  const background = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (p: number) => {
    if (!background[p] && distance(p) <= BACKGROUND) {
      background[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < width * (height - 1)) visit(p + width);
  }
  for (let p = 0; p < width * height; p++)
    if (background[p])
      data[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(((distance(p) - 4) / 20) * 255)));
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const { data: trimmed, info: out } = await sharp(png)
    .trim({ background: CLEAR, threshold: 1 })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: trimmed, width: out.width, height: out.height };
}

/** The art's left part, its first framing tree and what's beside it, trimmed. */
async function iconArt(cut: { png: Buffer; width: number; height: number }) {
  const width = Math.min(cut.width, Math.round(cut.height * ICON_ASPECT));
  return sharp(
    await sharp(cut.png).extract({ left: 0, top: 0, width, height: cut.height }).png().toBuffer(),
  )
    .trim({ background: CLEAR, threshold: 1 })
    .png()
    .toBuffer();
}

async function fit(input: Buffer, width: number, height: number, margin: number) {
  return sharp(input)
    .resize({
      width: Math.round(width * (1 - 2 * margin)),
      height: Math.round(height * (1 - 2 * margin)),
      fit: 'contain',
      background: CLEAR,
    })
    .png()
    .toBuffer();
}

async function onWhite(input: Buffer, width: number, height: number, margin = 0.08) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: WHITE } })
    .composite([{ input: await fit(input, width, height, margin), gravity: 'center' }])
    .removeAlpha()
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(bytes), width, height };
}

/**
 * Every identity asset from one logo image. `region` cuts the art out of a larger image first
 * (Boca's logo file has its wordmark under the art; ChatGPT images without text need none).
 */
export async function deriveIdentityAssets(
  art: Uint8Array,
  region?: Region,
): Promise<Record<IdentityFile, DerivedAsset>> {
  const cut = await cutOut(art, region);
  const hero = await sharp(cut.png)
    .resize({ ...HERO_SIZE, fit: 'contain', background: CLEAR })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();
  const icon = await iconArt(cut);
  const tab = await sharp({
    create: { width: 32, height: 32, channels: 4, background: CLEAR },
  })
    .composite([{ input: await fit(icon, 32, 32, 0) }])
    .png()
    .toBuffer();
  return {
    'hero.webp': { bytes: new Uint8Array(hero), ...HERO_SIZE },
    'icon-32.png': { bytes: new Uint8Array(tab), width: 32, height: 32 },
    'icon-180.png': await onWhite(icon, 180, 180),
    'icon-192.png': await onWhite(icon, 192, 192),
    'icon-512.png': await onWhite(icon, 512, 512),
    'icon-maskable-512.png': await onWhite(icon, 512, 512, MASKABLE_MARGIN),
    'social-avatar.png': await onWhite(icon, 512, 512),
    'share-default.png': await onWhite(cut.png, 1200, 630, 0.1),
    'newsletter-header.png': await onWhite(cut.png, 600, 120, 0.08),
    'facebook-cover.png': await onWhite(cut.png, 1640, 624, 0.12),
  };
}

/** Writes a town's assets to `dir`; returns what its config should say, served from `urlBase`. */
export function writeIdentityAssets(
  dir: string,
  urlBase: string,
  assets: Record<IdentityFile, DerivedAsset>,
): { hero_art: { src: string; width: number; height: number }; app_icon: string } {
  mkdirSync(dir, { recursive: true });
  for (const file of IDENTITY_FILES) writeFileSync(join(dir, file), assets[file].bytes);
  return {
    hero_art: { src: `${urlBase}/hero.webp`, ...HERO_SIZE },
    app_icon: urlBase,
  };
}
