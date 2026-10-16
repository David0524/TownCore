import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resetEnvCache } from '@towncore/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch, type FixtureFile } from '../src/http/fixtures';
import { missingEnv } from '../src/registry';
import { isoDurationSeconds, titleTime, youtubeAdapter, youtubeChannel } from '../src/youtube';
import type { SourceConfig } from '../src/types';

// Recorded live from the City of Delray Beach channel (linked from delraybeach.legistar.com)
// with a 45-day window; `now` is the recording time so the window replays the same videos.
const fixturePath = fileURLToPath(
  new URL('../fixtures/youtube/delray-channel.json', import.meta.url),
);
const recorded = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureFile;
const NOW = new Date(recorded.recordedAt);
const delray: SourceConfig = {
  id: 'yt',
  townId: 't',
  kind: 'meeting_video',
  platform: 'youtube',
  url: 'https://www.youtube.com/@cityofdelraybeachfl/streams',
  config: { days: 45 },
};

function ctx(fixture: FixtureFile = recorded) {
  const seen: { url: string; key: string | undefined }[] = [];
  const replay = replayFetch(fixture);
  const fetcher = new Fetcher({
    fetchImpl: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: input, key: headers['x-goog-api-key'] });
      return replay(input, init);
    },
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
  return { ctx: { fetcher, now: NOW }, seen };
}

/** The recording with one video's embedding turned off by its owner. */
function withEmbeddingOff(videoId: string): FixtureFile {
  const copy = structuredClone(recorded);
  const exchange = copy.exchanges.find((e) => e.url.includes('/youtube/v3/videos?'))!;
  const body = JSON.parse(exchange.body!) as {
    items: { id: string; status: { embeddable: boolean } }[];
  };
  body.items.find((v) => v.id === videoId)!.status.embeddable = false;
  exchange.body = JSON.stringify(body);
  return copy;
}

const MEETING_WORDS =
  /\b(meeting|commission|council|board|committee|workshop|hearing|magistrate|agency|cra)\b/i;

describe('youtube', () => {
  // The environment is parsed once and cached; reset it whenever the test changes a variable.
  const setKey = (value: string) => {
    vi.stubEnv('YOUTUBE_API_KEY', value);
    resetEnvCache();
  };
  beforeEach(() => setKey('test-key'));
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('reads channel URLs and durations', () => {
    expect(youtubeChannel('https://www.youtube.com/@cityofdelraybeachfl/streams')).toEqual({
      handle: '@cityofdelraybeachfl',
      channelId: null,
    });
    expect(
      youtubeChannel('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')?.channelId,
    ).toBe('UCabcdefghijklmnopqrstuv');
    expect(youtubeChannel('https://www.delraybeachfl.gov/')).toBeNull();
    expect(isoDurationSeconds('PT3H12M40S')).toBe(11_560);
    expect(isoDurationSeconds('PT45S')).toBe(45);
    expect(isoDurationSeconds('nonsense')).toBeNull();
  });

  it("lists a channel's recent meeting videos, with the key only in a header", async () => {
    const { ctx: c, seen } = ctx();
    const records = await youtubeAdapter.fetch(delray, null, c);
    expect(records).toHaveLength(20);
    const cutoff = NOW.getTime() - 45 * 86_400_000;
    for (const r of records) {
      expect(r.type).toBe('meeting-video');
      // Meeting-titled videos only.
      expect(r.title).toMatch(MEETING_WORDS);
      expect(r.url).toBe(
        `https://www.youtube.com/watch?v=${(r.raw as { videoId: string }).videoId}`,
      );
      expect(r.raw).toMatchObject({
        channelId: 'UCc2j0JhnR8Hx0Hj13RhCJag',
        channelTitle: 'City of Delray Beach',
        embeddable: true,
      });
      expect(r.occurredAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());
      // A meeting is streamed, or uploaded within days of it, so it falls near the window.
      expect(r.occurredAt!.getTime()).toBeGreaterThan(cutoff - 7 * 86_400_000);
    }
    // A service-awards ceremony and two short budget explainers are left out.
    const ids = records.map((r) => r.externalId);
    for (const clip of ['OQrBMSn6Nwo', 'aXDb-SLQves', 'rKeHgEQiUak']) {
      expect(ids).not.toContain(`video:${clip}`);
    }

    const commission = records.find((r) => r.externalId === 'video:XVM7k_LoURc');
    expect(commission).toMatchObject({
      title: 'City Commission Regular Meeting 10-13-2026 5:00 PM',
      url: 'https://www.youtube.com/watch?v=XVM7k_LoURc',
      // The stream's start, not the upload time (2026-10-14T01:27:20Z).
      occurredAt: new Date('2026-10-13T21:07:21Z'),
    });
    expect(commission!.text).toContain('Length: 4 h 10 min');
    expect(commission!.text).toContain('Channel: City of Delray Beach');
    expect(commission!.raw).toMatchObject({ videoId: 'XVM7k_LoURc', durationSeconds: 15_002 });
    // An upload with no stream details takes the meeting time in its title (5:00 PM Eastern on
    // 9/22), not its upload time four days later (2026-09-26T02:28:09Z).
    expect(records.find((r) => r.externalId === 'video:FfwHj_t1UCU')!.occurredAt).toEqual(
      new Date('2026-09-22T21:00:00Z'),
    );

    // Uploads older than the 45-day window aren't looked up.
    const lookup = seen.find((s) => s.url.includes('/youtube/v3/videos?'))!;
    expect(new URL(lookup.url).searchParams.get('id')!.split(',')).toHaveLength(23);

    const api = seen.filter((s) => s.url.startsWith('https://youtube.googleapis.com/youtube/'));
    expect(api).toHaveLength(3);
    for (const s of api) {
      expect(s.key).toBe('test-key');
      expect(s.url).not.toMatch(/key=/);
    }
    for (const s of seen) expect(s.url).not.toMatch(/key=/);
  });

  it("keeps a video whose owner turned embedding off, flagged so it's never embedded", async () => {
    const records = await youtubeAdapter.fetch(
      delray,
      null,
      ctx(withEmbeddingOff('l6vdjQNDd7k')).ctx,
    );
    expect(records).toHaveLength(20);
    expect(records.find((r) => r.externalId === 'video:l6vdjQNDd7k')!.raw).toMatchObject({
      embeddable: false,
    });
    expect(records.find((r) => r.externalId === 'video:XVM7k_LoURc')!.raw).toMatchObject({
      embeddable: true,
    });
  });

  it('reads the meeting date and time from a title, in the town time zone', () => {
    const tz = 'America/New_York';
    expect(titleTime('City Commission Regular Meeting 09-22-2026 5:00 PM', tz)).toEqual(
      new Date('2026-09-22T21:00:00Z'),
    );
    expect(titleTime('Commission Workshop Meeting 9/22/2026 3:00 p.m.', tz)).toEqual(
      new Date('2026-09-22T19:00:00Z'),
    );
    // No time: noon local, so the local date can't slip.
    expect(titleTime('CRA Meeting 12-01-2026', tz)).toEqual(new Date('2026-12-01T17:00:00Z'));
    expect(titleTime('Budget Discussion for Fiscal Year 2026-27', tz)).toBeNull();
    expect(titleTime('Meeting 13-45-2026', tz)).toBeNull();
  });

  it('needs its key; ingest skips the source while it is missing', async () => {
    setKey('');
    expect(missingEnv(youtubeAdapter)).toEqual(['YOUTUBE_API_KEY']);
    await expect(youtubeAdapter.fetch(delray, null, ctx().ctx)).rejects.toThrow(
      /YOUTUBE_API_KEY is not set/,
    );
    setKey('test-key');
    expect(missingEnv(youtubeAdapter)).toEqual([]);
  });

  it('detects channel pages and links to them', async () => {
    expect(await youtubeAdapter.detect('https://www.youtube.com/@cityofdelraybeachfl', '')).toBe(1);
    expect(
      await youtubeAdapter.detect(
        'https://delraybeach.legistar.com/Calendar.aspx',
        '<a href="https://www.youtube.com/@cityofdelraybeachfl/streams">Watch</a>',
      ),
    ).toBe(0.5);
  });
});
