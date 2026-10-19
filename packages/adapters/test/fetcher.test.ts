import { describe, expect, it } from 'vitest';
import {
  Fetcher,
  FetchPolicyError,
  insideVisitTime,
  OutsideVisitTime,
  preambleCrawlDelay,
  retryAfterMs,
  visitWindows,
  type FetchFn,
} from '../src/http/fetcher';
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
    // Proxies, feed bridges and page caches: reading through them gets around robots.txt.
    'https://rsshub.app/twitter/user/x',
    'https://rsshub.example.org/instagram/user/x',
    'https://rsshub2.example.net/',
    'https://rss-bridge.example.com/?action=display',
    'https://politepol.com/fd/abc',
    'https://fetchrss.com/rss/abc.xml',
    'https://api.supadata.ai/v1/web/scrape?url=x',
    'https://supadata.ai/',
    'https://api.scraperapi.com/?url=x',
    'https://p.webshare.io/',
    'https://web.archive.org/web/2024/https://city.example/',
    'https://archive.org/wayback/available?url=x',
    'https://archive.ph/abc',
    'https://archive.today/abc',
    'https://webcache.googleusercontent.com/search?q=cache:x',
    'https://city-example-gov.translate.goog/',
  ])('blocks %s', (url) => {
    expect(isBlockedUrl(new URL(url))).not.toBeNull();
  });

  it.each([
    'https://www.myboca.us/',
    'https://api.weather.gov/alerts',
    'https://www.google.com/search',
    'https://www.rsshubcity.gov/',
    'https://www.myarchive.org/',
  ])('allows %s', (url) => {
    expect(isBlockedUrl(new URL(url))).toBeNull();
  });

  it('lets only the launcher domain-history check read web.archive.org', () => {
    const cdx = new URL('https://web.archive.org/cdx/search/cdx?url=x.com');
    expect(isBlockedUrl(cdx, { domainHistory: true })).toBeNull();
    expect(isBlockedUrl(new URL('https://archive.ph/x'), { domainHistory: true })).not.toBeNull();
    expect(isBlockedUrl(new URL('https://archive.org/x'), { domainHistory: true })).not.toBeNull();
    expect(isBlockedUrl(new URL('https://yelp.com/'), { domainHistory: true })).not.toBeNull();
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

  it('refuses archive hosts unless asked for domain history', async () => {
    let calls = 0;
    const fetcher = new Fetcher({
      fetchImpl: async () => (calls++, new Response('[]', { status: 200 })),
      minIntervalMs: 0,
    });
    const url = 'https://web.archive.org/cdx/search/cdx?url=x.com&output=json';
    await expect(fetcher.get(url)).rejects.toBeInstanceOf(FetchPolicyError);
    expect(calls).toBe(0);
    expect((await fetcher.forDomainHistory().get(url)).ok).toBe(true);
    await expect(fetcher.forDomainHistory().get('https://archive.ph/x')).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
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

  it('checks robots.txt again on every redirect hop, including to another host', async () => {
    const redirect = (from: string, to: string, status = 302) => ({
      url: from,
      status,
      headers: { location: to },
      body: '',
    });
    const exchanges = [
      robots('User-agent: *\nDisallow: /private'),
      redirect('https://city.example/video', 'https://media.example/watch/1'),
      {
        url: 'https://media.example/robots.txt',
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: *\nDisallow: /',
      },
      redirect('https://city.example/old', '/new', 301),
      page('/new', 'moved'),
      redirect('https://city.example/sneaky', '/private/doc'),
      redirect('https://city.example/social', 'https://www.facebook.com/city'),
      redirect('https://city.example/loop', '/loop'),
    ];
    const seen: string[] = [];
    const replay = replayFetch({ recordedAt: '', exchanges });
    const fetcher = new Fetcher({
      fetchImpl: async (input, init) => {
        seen.push(input);
        expect(init?.redirect).toBe(input.endsWith('/robots.txt') ? 'follow' : 'manual');
        return replay(input, init);
      },
      ...fakeClock(),
    });
    // A same-host relative redirect is followed.
    await expect(fetcher.getText('https://city.example/old')).resolves.toBe('moved');
    // Another host whose robots.txt disallows us: refused, its page never requested.
    await expect(fetcher.get('https://city.example/video')).rejects.toThrow(
      /media\.example\/watch\/1 \(redirected from https:\/\/city\.example\/video\): disallowed by robots/,
    );
    // A disallowed path on the same host, and a never-scrape host, are refused too.
    await expect(fetcher.get('https://city.example/sneaky')).rejects.toThrow(/robots/);
    await expect(fetcher.get('https://city.example/social')).rejects.toThrow(FetchPolicyError);
    await expect(fetcher.get('https://city.example/loop')).rejects.toThrow(/too many redirects/);
    expect(seen).not.toContain('https://media.example/watch/1');
    expect(seen).not.toContain('https://city.example/private/doc');
    expect(seen).not.toContain('https://www.facebook.com/city');
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

  it('honors robots.txt Crawl-delay for our agent or everyone, capped at a minute', async () => {
    const clock = fakeClock();
    const times: number[] = [];
    const fetchImpl: FetchFn = async (url) => {
      if (url === 'https://slow.example/robots.txt')
        return new Response('User-agent: *\nCrawl-delay: 5\nDisallow: /admin\n');
      if (url === 'https://slower.example/robots.txt')
        return new Response('User-agent: *\nCrawl-delay: 600\n');
      times.push(clock.now());
      return new Response('ok');
    };
    const fetcher = new Fetcher({ fetchImpl, ...clock });
    await fetcher.getText('https://slow.example/a');
    await fetcher.getText('https://slow.example/b');
    expect(fetcher.intervalFor('slow.example')).toBe(5_000);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(5_000);
    await fetcher.getText('https://slower.example/a');
    expect(fetcher.intervalFor('slower.example')).toBe(60_000);
  });

  it('honors a Crawl-delay written before the first User-agent group', async () => {
    // data.cms.gov's robots.txt, checked 2026-10-17.
    const robots =
      '# 10 second crawl delays\ncrawl-delay: 10\n\nUser-agent: *\nDisallow: /admin/\n';
    expect(preambleCrawlDelay(robots)).toBe(10);
    expect(preambleCrawlDelay('User-agent: *\nCrawl-delay: 5\n')).toBeUndefined();
    const clock = fakeClock();
    const fetchImpl: FetchFn = async (url) =>
      new Response(url.endsWith('/robots.txt') ? robots : 'ok');
    const fetcher = new Fetcher({ fetchImpl, ...clock });
    await fetcher.getText('https://data.example/a');
    expect(fetcher.intervalFor('data.example')).toBe(10_000);
  });

  it('reads robots.txt Visit-time for our agent, else everyone', () => {
    const text = [
      'User-agent: Slurp',
      'Disallow: /',
      'Visit-time: 0000-2359',
      '',
      'User-agent: *',
      'Disallow: /images/',
      'Crawl-delay: 5',
      'Visit-time: 0100-0645 # UTC',
    ].join('\n');
    expect(visitWindows(text, USER_AGENT)).toEqual([{ from: 60, to: 405 }]);
    expect(visitWindows(`${text}\nUser-agent: TownCoreBot\nAllow: /\n`, USER_AGENT)).toEqual([]);
    expect(visitWindows('User-agent: *\nDisallow:\n', USER_AGENT)).toEqual([]);
    const at = (iso: string) => new Date(`2026-10-16T${iso}:00Z`);
    const night = [{ from: 60, to: 405 }];
    expect(insideVisitTime(night, at('02:30'))).toBe(true);
    expect(insideVisitTime(night, at('21:15'))).toBe(false);
    expect(insideVisitTime([{ from: 1380, to: 120 }], at('00:30'))).toBe(true);
    expect(insideVisitTime([], at('12:00'))).toBe(true);
  });

  it('fetches a Visit-time host only inside its window', async () => {
    let t = Date.parse('2026-10-16T21:15:00Z');
    const fetched: string[] = [];
    const fetchImpl: FetchFn = async (url) => {
      if (url.endsWith('/robots.txt'))
        return new Response('User-agent: *\nAllow: /\nVisit-time: 0100-0645\n');
      fetched.push(url);
      return new Response('ok');
    };
    const fetcher = new Fetcher({ fetchImpl, now: () => t, sleep: async (ms) => void (t += ms) });
    await expect(fetcher.getText('https://night.example/a')).rejects.toBeInstanceOf(
      OutsideVisitTime,
    );
    expect(fetched).toEqual([]);
    t = Date.parse('2026-10-17T02:00:00Z');
    expect(await fetcher.getText('https://night.example/a')).toBe('ok');
  });

  it('parses Retry-After seconds and dates, capped at a minute', () => {
    expect(retryAfterMs('5')).toBe(5_000);
    expect(retryAfterMs('600')).toBe(60_000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});
