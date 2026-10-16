import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Fetcher, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { searchPhotos, trackDownload, unsplashLink } from '../src/unsplash';

// Unsplash stock photos for guides (§11c). The fixture follows Unsplash's documented response
// shape; it is re-recorded live once the app's access key is set.
const fixture = fileURLToPath(
  new URL('../fixtures/unsplash/recycling-search.json', import.meta.url),
);

function recording(inner: FetchFn) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: FetchFn = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return inner(url, init);
  };
  return {
    calls,
    fetcher: new Fetcher({ fetchImpl, sleep: async () => {}, now: () => 0, minIntervalMs: 0 }),
  };
}

describe('unsplash', () => {
  it('searches landscape photos with the safest filter, sending the key and API version', async () => {
    const { calls, fetcher } = recording(replayFetch(fixture));
    const photos = await searchPhotos(fetcher, 'test-key', 'recycling bins');
    expect(photos.map((p) => p.id)).toEqual(['fixture1', 'fixture2', 'fixture3']);
    const search = calls.find((c) => c.url.includes('/search/photos'))!;
    expect(new URL(search.url).searchParams.get('orientation')).toBe('landscape');
    expect(new URL(search.url).searchParams.get('content_filter')).toBe('high');
    expect(search.headers).toMatchObject({
      authorization: 'Client-ID test-key',
      'accept-version': 'v1',
    });
    // The API host's robots.txt disallows crawlers; it is a documented API (Rule 8), so the
    // request goes out anyway, still identified and rate-limited.
    expect(search.headers['user-agent']).toMatch(/^TownCoreBot\/1\.0/);
  });

  it("pings a photo's download_location when it is used, and only on Unsplash's API", async () => {
    const { calls, fetcher } = recording(replayFetch(fixture));
    const [photo] = await searchPhotos(fetcher, 'test-key', 'recycling bins');
    await trackDownload(fetcher, 'test-key', photo!);
    expect(calls.at(-1)!.url).toBe(
      'https://api.unsplash.com/photos/fixture1/download?ixid=fixture1',
    );
    await expect(
      trackDownload(fetcher, 'test-key', {
        links: { html: '', download_location: 'https://evil.example/steal' },
      }),
    ).rejects.toThrow(/Unexpected download_location host/);
  });

  it('tags links back to Unsplash with the app name', () => {
    expect(unsplashLink('https://unsplash.com/@sample', 'boca_town_square')).toBe(
      'https://unsplash.com/@sample?utm_source=boca_town_square&utm_medium=referral',
    );
  });
});
