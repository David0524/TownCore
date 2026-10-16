import { loadEnv } from '@towncore/config';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// YouTube meeting videos through the YouTube Data API v3 (owner's decision, 2026-10-16), the only
// allowed way to list a town's videos: youtube.com's robots.txt disallows the channel RSS feed,
// and Granicus video is off-limits. The API's own host, youtube.googleapis.com, serves YouTube's
// robots.txt, which has no rule for /youtube/v3/. (www.googleapis.com serves the same API, but
// cloud sessions add a Google OAuth token there that overrides the key.) Records keep
// metadata only (title, times, duration, whether the owner allows embedding); the site embeds the
// video itself with a click-to-play player. Captions aren't available: the API gives them only to
// the channel's owner.
//
// The key goes in the X-goog-api-key header, never the URL, so it can't reach a fixture or a log.
// Each run costs 3 quota units (channel, uploads list, video details) of the free 10,000 a day.
//
// Source config: { handle?: '@cityofdelraybeachfl' | channelId?: 'UC…',
//                  titleMatch?: regex source (default: meeting words), days?: number }

export const YOUTUBE_API = 'https://youtube.googleapis.com/youtube/v3';
/** Titles that look like public meetings; a channel also posts promos and event clips. */
const MEETING_TITLE =
  /\b(meeting|commission|council|board|committee|workshop|hearing|magistrate|agency|cra)\b/i;

type Options = {
  handle: string | null;
  channelId: string | null;
  titleMatch: RegExp;
  days: number;
};

function options(source: SourceConfig): Options {
  const c = source.config as {
    handle?: string;
    channelId?: string;
    titleMatch?: string;
    days?: number;
  };
  const fromUrl = source.url ? youtubeChannel(source.url) : null;
  const handle = c.handle ?? fromUrl?.handle ?? null;
  const channelId = c.channelId ?? fromUrl?.channelId ?? null;
  if (!handle && !channelId) {
    throw new Error(`YouTube source ${source.id} needs config.handle or config.channelId`);
  }
  return {
    handle: handle && !handle.startsWith('@') ? `@${handle}` : handle,
    channelId,
    titleMatch: c.titleMatch ? new RegExp(c.titleMatch, 'i') : MEETING_TITLE,
    days: c.days ?? 45,
  };
}

/** The channel a youtube.com URL names: /@handle/… or /channel/UC…. */
export function youtubeChannel(
  url: string,
): { handle: string | null; channelId: string | null } | null {
  const u = new URL(url);
  if (!/^(www\.|m\.)?youtube\.com$/i.test(u.hostname)) return null;
  const handle = u.pathname.match(/^\/(@[A-Za-z0-9._-]+)/)?.[1] ?? null;
  const channelId = u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1] ?? null;
  return handle || channelId ? { handle, channelId } : null;
}

/** "PT2H13M5S" → seconds. */
export function isoDurationSeconds(value: string | null | undefined): number | null {
  const m = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number];
  return ((d * 24 + h) * 60 + mi) * 60 + s;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

type Channel = {
  id: string;
  snippet?: { title?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
type PlaylistItem = { contentDetails?: { videoId?: string; videoPublishedAt?: string } };
export type YouTubeVideo = {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: { actualStartTime?: string; scheduledStartTime?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
};

function apiKey(): string {
  const key = loadEnv().YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  return key;
}

async function api<T>(ctx: AdapterContext, path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return ctx.fetcher.getJson<{ items?: T[] }>(`${YOUTUBE_API}/${path}?${query}`, {
    'x-goog-api-key': apiKey(),
  });
}

/** When the meeting happened: the stream's start, else the upload time. */
export function videoTime(video: YouTubeVideo): Date | null {
  const at =
    video.liveStreamingDetails?.actualStartTime ??
    video.liveStreamingDetails?.scheduledStartTime ??
    video.snippet?.publishedAt;
  return at ? new Date(at) : null;
}

async function fetchVideos(source: SourceConfig, ctx: AdapterContext): Promise<RawRecord[]> {
  const opts = options(source);
  const channels = await api<Channel>(ctx, 'channels', {
    part: 'contentDetails,snippet',
    ...(opts.channelId ? { id: opts.channelId } : { forHandle: opts.handle! }),
  });
  const channel = channels.items?.[0];
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!channel || !uploads) {
    throw new Error(`YouTube channel ${opts.channelId ?? opts.handle} not found`);
  }
  const listed = await api<PlaylistItem>(ctx, 'playlistItems', {
    part: 'contentDetails',
    playlistId: uploads,
    maxResults: '50',
  });
  const cutoff = ctx.now.getTime() - opts.days * 86_400_000;
  const ids = (listed.items ?? [])
    .filter((i) => i.contentDetails?.videoId)
    .filter((i) => new Date(i.contentDetails?.videoPublishedAt ?? 0).getTime() >= cutoff)
    .map((i) => i.contentDetails!.videoId!);
  if (ids.length === 0) return [];
  const details = await api<YouTubeVideo>(ctx, 'videos', {
    part: 'snippet,contentDetails,liveStreamingDetails,status',
    id: ids.join(','),
  });

  const records: RawRecord[] = [];
  for (const video of details.items ?? []) {
    const title = video.snippet?.title?.trim() ?? '';
    // Public, finished videos that look like meetings; upcoming and live streams come later.
    if (!opts.titleMatch.test(title)) continue;
    if (video.status?.privacyStatus && video.status.privacyStatus !== 'public') continue;
    if (video.snippet?.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none') {
      continue;
    }
    const at = videoTime(video);
    const seconds = isoDurationSeconds(video.contentDetails?.duration);
    const channelTitle = video.snippet?.channelTitle ?? channel.snippet?.title ?? null;
    records.push({
      externalId: `video:${video.id}`,
      type: 'meeting-video',
      title,
      text: [
        at ? `Recorded: ${at.toISOString()}` : null,
        formatDuration(seconds) ? `Length: ${formatDuration(seconds)}` : null,
        channelTitle ? `Channel: ${channelTitle}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: `https://www.youtube.com/watch?v=${video.id}`,
      occurredAt: at,
      raw: {
        videoId: video.id,
        channelId: video.snippet?.channelId ?? channel.id,
        channelTitle,
        durationSeconds: seconds,
        embeddable: video.status?.embeddable !== false,
      },
    });
  }
  return records;
}

export const youtubeAdapter: SourceAdapter = {
  platform: 'youtube',
  kinds: ['meeting_video'],
  requiresEnv: ['YOUTUBE_API_KEY'],

  async detect(url, html) {
    if (youtubeChannel(url)) return 1;
    if (/https?:\/\/(www\.)?youtube\.com\/(@[A-Za-z0-9._-]+|channel\/UC)/i.test(html)) return 0.5;
    return 0;
  },

  fetch: (source, _since, ctx) => fetchVideos(source, ctx),

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      const channels = await api<Channel>(ctx, 'channels', {
        part: 'id',
        ...(opts.channelId ? { id: opts.channelId } : { forHandle: opts.handle! }),
      });
      return channels.items?.length
        ? { ok: true }
        : { ok: false, detail: 'YouTube channel not found' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
