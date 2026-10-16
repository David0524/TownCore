import type { AdapterContext } from '../types';

// Swagit (Granicus) meeting video. Its robots.txt has every rule commented out, so the normal
// Fetcher checks apply. Each video page has a plain-text transcript at /videos/<id>/transcript:
// machine captions, in capitals, with timestamps and the agenda item markers the clerk added.
// Transcripts are supporting text for meeting recaps (owner's decision, 2026-10-16); they are
// never a story's only source, and a story citing one goes to review, since caption spellings
// of names can be wrong.

/** Transcripts are long (about 95 KB for a council meeting); records keep this much. */
const MAX_TRANSCRIPT = 150_000;

/** The video page for a Swagit URL like https://jupiterfl.new.swagit.com/videos/403164. */
export function swagitVideo(url: string | null | undefined): { page: string; id: string } | null {
  if (!url) return null;
  const m = url.match(/^https:\/\/([a-z0-9-]+\.(?:new\.)?swagit\.com)\/videos\/(\d+)/i);
  return m ? { page: `https://${m[1]!.toLowerCase()}/videos/${m[2]}`, id: m[2]! } : null;
}

/**
 * Transcript text as stored: timestamp lines dropped, agenda item markers kept on their own
 * lines, whitespace collapsed. Capitals are left as they are; it's the source's own text.
 */
export function tidyTranscript(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^\[\d{1,2}:\d{2}:\d{2}\]$/.test(l));
  const text = lines.join('\n');
  return text.length > MAX_TRANSCRIPT ? `${text.slice(0, MAX_TRANSCRIPT).trimEnd()}\n…` : text;
}

/** The transcript of a Swagit video, or null when it isn't published (yet). */
export async function fetchSwagitTranscript(
  ctx: AdapterContext,
  videoUrl: string,
): Promise<{ url: string; text: string } | null> {
  const video = swagitVideo(videoUrl);
  if (!video) return null;
  const url = `${video.page}/transcript`;
  const response = await ctx.fetcher.get(url, { accept: 'text/plain' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  const text = tidyTranscript(await response.text());
  return text ? { url, text } : null;
}
