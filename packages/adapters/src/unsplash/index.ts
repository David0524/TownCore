import type { Fetcher } from '../http/fetcher';

// Unsplash stock photos (CLAUDE.md §11c "Licensed stock"; owner approved 2026-10-16). Used only
// as generic illustrations for evergreen guides, never as the scene of a story. Unsplash's API
// guidelines, built in here and in the page that shows a photo:
// - hotlink: show the image from the URLs the API returns, never a copy on our servers;
// - when a photo is used (not when it's merely searched), call its download_location;
// - credit "Photo by {name} on Unsplash", linking the photographer and Unsplash, with our app
//   name as utm_source.

const API = 'https://api.unsplash.com';

export const UNSPLASH_LICENSE = 'Unsplash License';
export const UNSPLASH_LICENSE_URL = 'https://unsplash.com/license';

/** The fields we read from a photo in a search result. */
export type UnsplashPhoto = {
  id: string;
  width: number;
  height: number;
  color: string | null;
  description: string | null;
  alt_description: string | null;
  urls: { raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
};

const headers = (accessKey: string) => ({
  authorization: `Client-ID ${accessKey}`,
  'accept-version': 'v1',
});

/** Landscape photos for a query, safest content filter, best match first. */
export async function searchPhotos(
  fetcher: Fetcher,
  accessKey: string,
  query: string,
  { perPage = 10 }: { perPage?: number } = {},
): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({
    query,
    orientation: 'landscape',
    content_filter: 'high',
    per_page: String(perPage),
  });
  const data = await fetcher.getJson<{ results?: UnsplashPhoto[] }>(
    `${API}/search/photos?${params}`,
    headers(accessKey),
  );
  return data.results ?? [];
}

/** Tells Unsplash a photo is being used (its API guidelines require this on use). */
export async function trackDownload(
  fetcher: Fetcher,
  accessKey: string,
  photo: Pick<UnsplashPhoto, 'links'>,
): Promise<void> {
  const url = new URL(photo.links.download_location);
  // Only ever Unsplash's own API: the URL comes from a response, so check before sending the key.
  if (url.origin !== API) throw new Error(`Unexpected download_location host ${url.host}`);
  await fetcher.getJson(url.toString(), headers(accessKey));
}

/** A link to Unsplash with the referral tags its guidelines ask for. */
export function unsplashLink(url: string, appName: string): string {
  const link = new URL(url);
  link.searchParams.set('utm_source', appName);
  link.searchParams.set('utm_medium', 'referral');
  return link.toString();
}
