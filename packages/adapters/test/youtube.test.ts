import { fileURLToPath } from 'node:url';
import { resetEnvCache } from '@towncore/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { missingEnv } from '../src/registry';
import { isoDurationSeconds, youtubeAdapter, youtubeChannel } from '../src/youtube';
import type { SourceConfig } from '../src/types';

// Hand-written from the YouTube Data API v3 reference (no key yet); re-record once one is set.
const fixture = fileURLToPath(new URL('../fixtures/youtube/delray-channel.json', import.meta.url));
const delray: SourceConfig = {
  id: 'yt',
  townId: 't',
  kind: 'meeting_video',
  platform: 'youtube',
  url: 'https://www.youtube.com/@cityofdelraybeachfl/streams',
  config: {},
};

function ctx() {
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
  return { ctx: { fetcher, now: new Date('2026-10-16T12:00:00Z') }, seen };
}

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
    // The promo clip and the June upload are left out.
    expect(records.map((r) => r.externalId)).toEqual(['video:tcFixture001', 'video:tcFixture003']);
    const [commission] = records;
    expect(commission).toMatchObject({
      type: 'meeting-video',
      title: 'City Commission Regular Meeting - October 13, 2026',
      url: 'https://www.youtube.com/watch?v=tcFixture001',
      // The stream's start, not the upload time.
      occurredAt: new Date('2026-10-13T21:02:11Z'),
    });
    expect(commission!.text).toContain('Length: 3 h 13 min');
    expect(commission!.raw).toMatchObject({ videoId: 'tcFixture001', embeddable: true });
    // The owner turned embedding off for this one: kept, but never embedded.
    expect(records[1]!.raw).toMatchObject({ embeddable: false });
    const api = seen.filter((s) => s.url.startsWith('https://www.googleapis.com/youtube/'));
    expect(api).toHaveLength(3);
    for (const s of api) {
      expect(s.key).toBe('test-key');
      expect(s.url).not.toMatch(/key=/);
    }
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
