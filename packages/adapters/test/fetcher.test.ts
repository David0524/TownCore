import { describe, expect, it } from 'vitest';
import { Fetcher, FetchPolicyError, retryAfterMs, type FetchFn } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';
import { DOCUMENTED_APIS, isBlockedUrl, USER_AGENT } from '../src/http/policy';

const robots = (body: string, status = 200) => ({
  url: 'https://city.example/robots.txt',
  status,
  headers: { 'content-type': 'text/plain' },
  body,
});
const page = (path: string, body = 'ok') => ({
  url: `https://city.example${path}`,
  status: 200,
  headers: { 'content-type': 'text/html' },
  body,
});

/** A fake clock so rate limiting is tested without real waiting. */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => void (t += ms),
    advance: (ms: number) => void (t += ms),
  };
}

describe('policy', () => {
  it.each([
    'https://www.yelp.com/biz/x',
    'https://m.facebook.com/page',
    'https://nextdoor.com/news_feed',
    'https://maps.google.com/?q=boca',
    'https://www.google.com/maps/place/x',
    'https://www.maxpreps.com/fl/boca',
  ])('blocks %s', (url) => {
    expect(isBlockedUrl(new URL(url))).not.toBeNull();
  });

  it.each([
    'https://www.myboca.us/',
    'https://api.weather.gov/alerts',
    'https://www.google.com/search',
  ])('allows %s', (url) => {
    expect(isBlockedUrl(new URL(url))).toBeNull();
  });

  it('identifies itself with the TownCore bot user agent', () => {
    expect(USER_AGENT).toBe('TownCoreBot/1.0 (info@towncore.net)');
  });
});

describe('Fetcher', () => {
  it('refuses never-scrape hosts without making any request', async () => {
    let calls = 0;
    const fetcher = new Fetcher({ fetchImpl: async () => (calls++, new Response('')) });
    await expect(fetcher.get('https://www.yelp.com/biz/x')).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
    expect(calls).toBe(0);
  });

  it('respects robots.txt, including the /RSS.aspx vs /RSSFeed.aspx distinction', async () => {
    const fetcher = new Fetcher({
      fetchImpl: replayFetch({
        recordedAt: '',
        exchanges: [
          robots('User-agent: *\nDisallow: /RSS.aspx\nDisallow: /admin'),
          page('/RSSFeed.aspx?ModID=1'),
        ],
      }),
      ...fakeClock(),
    });
    await expect(fetcher.get('https://city.example/RSS.aspx')).rejects.toThrow(/robots\.txt/);
    await expect(fetcher.get('https://city.example/admin/x')).rejects.toThrow(/robots\.txt/);
    await expect(fetcher.getText('https://city.example/RSSFeed.aspx?ModID=1')).resolves.toBe('ok');
  });

  it('treats a site that blocks all bots (like Granicus) as off-limits', async () => {
    const fetcher = new Fetcher({
      fetchImpl: replayFetch({
        recordedAt: '',
        exchanges: [
          robots('User-agent: Googlebot\nDisallow: /JSON.php\n\nUser-agent: *\nDisallow: /'),
        ],
      }),
      ...fakeClock(),
    });
    await expect(fetcher.get('https://city.example/ViewPublisher.php?view_id=2')).rejects.toThrow(
      /robots/,
    );
  });

  it('a missing robots.txt (404) allows; an erroring one (5xx) disallows', async () => {
    const allow = new Fetcher({
      fetchImpl: replayFetch({ recordedAt: '', exchanges: [robots('', 404), page('/x')] }),
      ...fakeClock(),
    });
    await expect(allow.getText('https://city.example/x')).resolves.toBe('ok');
    const deny = new Fetcher({
      fetchImpl: replayFetch({ recordedAt: '', exchanges: [robots('', 503), page('/x')] }),
      ...fakeClock(),
      retries: 1,
    });
    await expect(deny.get('https://city.example/x')).rejects.toThrow(/robots/);
  });

  it('sends the bot user agent and spaces requests to one host at least 1s apart', async () => {
    const clock = fakeClock();
    const seen: Array<{ url: string; at: number; ua: string | null }> = [];
    const fetchImpl: FetchFn = async (url, init) => {
      seen.push({ url, at: clock.now(), ua: new Headers(init?.headers).get('user-agent') });
      return url.endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response('ok');
    };
    const fetcher = new Fetcher({ fetchImpl, ...clock });
    await Promise.all([1, 2, 3].map((n) => fetcher.getText(`https://city.example/p${n}`)));
    const times = seen.map((s) => s.at);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1_000);
    expect(seen.every((s) => s.ua === USER_AGENT)).toBe(true);
  });

  it('retries 5xx responses and then gives up', async () => {
    let calls = 0;
    const fetchImpl: FetchFn = async (url) =>
      url.endsWith('robots.txt')
        ? new Response('', { status: 404 })
        : (calls++, new Response('', { status: 502 }));
    const fetcher = new Fetcher({ fetchImpl, ...fakeClock(), retries: 3 });
    const response = await fetcher.get('https://city.example/x');
    expect(response.status).toBe(502);
    expect(calls).toBe(3);
  });

  it('replay fails loudly on an unrecorded URL', async () => {
    const fetchImpl = replayFetch({ recordedAt: '', exchanges: [] });
    await expect(fetchImpl('https://city.example/x')).rejects.toThrow(/No recorded fixture/);
  });

  it('calls documented APIs without consulting their crawler robots.txt', async () => {
    const requested: string[] = [];
    const fetchImpl: FetchFn = async (url) => {
      requested.push(url);
      return url.endsWith('robots.txt')
        ? new Response('User-agent: *\nDisallow: /')
        : new Response('{}');
    };
    const fetcher = new Fetcher({ fetchImpl, ...fakeClock() });
    await expect(fetcher.getText('https://api.weather.gov/alerts?zone=FLZ168')).resolves.toBe('{}');
    expect(requested).toEqual(['https://api.weather.gov/alerts?zone=FLZ168']);
    // A website on a different host with the same robots.txt is still refused.
    await expect(
      fetcher.get('https://bocaraton.granicus.example/ViewPublisher.php'),
    ).rejects.toThrow(/robots/);
  });

  it('every documented API records the terms that permit automated access', () => {
    for (const api of Object.values(DOCUMENTED_APIS)) expect(api.terms).toMatch(/^https:\/\//);
  });

  it('on HTTP 429 waits Retry-After, retries, and permanently slows down for that host', async () => {
    const clock = fakeClock();
    const times: number[] = [];
    let n = 0;
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 });
      times.push(clock.now());
      n++;
      return n === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '5' } })
        : new Response('ok');
    };
    const fetcher = new Fetcher({ fetchImpl, ...clock });
    await expect(fetcher.getText('https://city.example/a')).resolves.toBe('ok');
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(5_000);
    expect(fetcher.intervalFor('city.example')).toBe(2_000);
    await fetcher.getText('https://city.example/b');
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(2_000);
  });

  it('parses Retry-After seconds and dates, capped at a minute', () => {
    expect(retryAfterMs('5')).toBe(5_000);
    expect(retryAfterMs('600')).toBe(60_000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});
