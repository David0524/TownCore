import { loadEnv } from '@towncore/config';
import { PHOTO_REJECTIONS, photoStorageFromEnv, type PhotoStorage } from '@towncore/photos';

// Reader and business photos (M9): where they're kept, and what the forms say back.

let storage: PhotoStorage | undefined;
export function photoStorage(): PhotoStorage {
  storage ??= photoStorageFromEnv(loadEnv());
  return storage;
}

/**
 * Whether the photo forms take uploads: always with S3; on local disk only off Vercel (development,
 * CI, a single server), since a Vercel deploy's disk is temporary and photos there would be lost.
 */
export function photosOpen(): boolean {
  return photoStorage().kind === 's3' || !loadEnv().VERCEL;
}

/** Outcomes the photo forms show, by the code in the redirect. */
export const PHOTO_MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  thanks: {
    tone: 'ok',
    text: 'Thanks! An editor looks at every photo before it appears. We’ll credit it as you asked.',
  },
  error: { tone: 'error', text: 'Something went wrong. Please try again later.' },
  origin: { tone: 'error', text: 'Please send the form from this site.' },
  closed: { tone: 'error', text: 'Photo submissions aren’t open yet. Please try again soon.' },
  ...Object.fromEntries(
    Object.entries(PHOTO_REJECTIONS).map(([code, text]) => [code, { tone: 'error', text }]),
  ),
};

/** The JPEG response for a stored photo; a day's cache, since approved photos don't change. */
export function jpegResponse(bytes: Uint8Array, cache = 'public, max-age=86400, immutable') {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
