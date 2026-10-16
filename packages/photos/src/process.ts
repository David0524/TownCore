import sharp, { type Metadata } from 'sharp';

// Every photo is re-encoded before it's stored (docs/plans/M9.md §1): JPEG, at most 2000 px on
// the long side, auto-rotated, and with all metadata stripped (EXIF, GPS, camera serials), so a
// reader's location never leaks through a published photo. Anything that isn't a real JPEG, PNG
// or WebP image is refused.

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_EDGE = 2000;
/** Too small to be worth publishing. */
export const MIN_EDGE = 600;

/** Why a photo was refused, in words the sender sees (the page shows these by code only). */
export const PHOTO_REJECTIONS = {
  empty: 'No photo was attached.',
  too_big: 'The photo is larger than 12 MB.',
  unreadable: "That file isn't a photo we can read (JPEG, PNG or WebP).",
  format: 'Send a JPEG, PNG or WebP photo.',
  too_small: `The photo is too small (at least ${MIN_EDGE} pixels on its long side).`,
  license: 'Please agree to the license to send a photo.',
  caption: 'Add a caption: what the photo shows.',
  credit: 'Add the credit line to print with the photo.',
  contact: 'Add your name and a working email address.',
  rate: 'Thanks! That is enough photos for now; please try again in an hour.',
  listing: 'Which listing is this for?',
  limit: 'A listing keeps at most 5 photos.',
  site: 'Unknown site.',
} as const;
export type PhotoRejection = keyof typeof PHOTO_REJECTIONS;

export class PhotoRejected extends Error {
  constructor(readonly code: PhotoRejection) {
    super(PHOTO_REJECTIONS[code]);
  }
}

export async function processPhoto(
  bytes: Uint8Array,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  if (bytes.byteLength === 0) throw new PhotoRejected('empty');
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new PhotoRejected('too_big');
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new PhotoRejected('unreadable');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format))
    throw new PhotoRejected('format');
  // sharp drops all metadata unless asked to keep it; rotate() applies the EXIF orientation first.
  const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  if (Math.max(info.width, info.height) < MIN_EDGE) throw new PhotoRejected('too_small');
  return { jpeg: new Uint8Array(data), width: info.width, height: info.height };
}
