import { expect, test, type Page } from '@playwright/test';

// Discovery files per town (docs/plans/M4.md §1): robots.txt, sitemaps, Google News sitemap,
// RSS, canonical URLs and JSON-LD. Draft towns (Boca, Harbor Point) list nothing; the fictional
// live Feed Town lists its "fixture-" stories and never "test-" ones.

// Fetched through the browser, which maps the test hosts to the local server.
async function get(page: Page, url: string) {
  const response = (await page.goto(url))!;
  return {
    status: () => response.status(),
    headers: () => response.headers(),
    text: () => response.text(),
  };
}

const boca = 'http://bocatownsquare.com';
const feed = 'http://feedtown.test';

test.describe('draft towns are never listed', () => {
  test('robots.txt disallows everything and sitemaps are empty', async ({ page }) => {
    const robots = await get(page, `${boca}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');

    for (const path of ['/sitemap.xml', '/news-sitemap.xml', '/feed.xml', '/sitemaps/pages.xml']) {
      const res = await get(page, `${boca}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['x-robots-tag'], path).toBe('noindex');
      expect(await res.text(), path).not.toContain('<loc>https://bocatownsquare.com/news/');
    }
    expect(await (await get(page, `${boca}/feed.xml`)).text()).not.toContain('<item>');
  });
});

test.describe('a live town', () => {
  test('robots.txt allows crawling and points to the sitemaps', async ({ page }) => {
    const text = await (await get(page, `${feed}/robots.txt`)).text();
    expect(text).toContain('Allow: /');
    expect(text).toContain('Disallow: /admin');
    expect(text).toContain('Sitemap: https://feedtown.test/sitemap.xml');
    expect(text).toContain('Sitemap: https://feedtown.test/news-sitemap.xml');
  });

  test('sitemap index → monthly article sitemaps list public stories only', async ({ page }) => {
    const index = await get(page, `${feed}/sitemap.xml`);
    expect(index.headers()['content-type']).toContain('application/xml');
    expect(index.headers()['x-robots-tag']).toBeUndefined();
    const locs = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs).toContain('https://feedtown.test/sitemaps/pages.xml');
    const months = locs.filter((l) => /articles-\d{4}-\d{2}\.xml$/.test(l));
    expect(months.length).toBeGreaterThan(0);

    let all = '';
    for (const loc of months) {
      all += await (await get(page, loc.replace('https://feedtown.test', feed))).text();
    }
    expect(all).toContain('<loc>https://feedtown.test/news/fixture-council-vote</loc>');
    expect(all).toContain('<loc>https://feedtown.test/news/fixture-park-opens</loc>');
    expect(all).not.toContain('test-never-listed');
    expect(all).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);

    const pages = await (await get(page, `${feed}/sitemaps/pages.xml`)).text();
    expect(pages).toContain('<loc>https://feedtown.test/about</loc>');
    expect(pages).toContain('<loc>https://feedtown.test/beat/government</loc>');
  });

  test('the news sitemap lists only the last 48 hours, with Google News fields', async ({
    page,
  }) => {
    const xml = await (await get(page, `${feed}/news-sitemap.xml`)).text();
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain('<loc>https://feedtown.test/news/fixture-council-vote</loc>');
    expect(xml).toContain('<news:name>The Feed Town Gazette</news:name>');
    expect(xml).toContain('<news:language>en</news:language>');
    expect(xml).toMatch(/<news:publication_date>\d{4}-\d{2}-\d{2}T[^<]+Z<\/news:publication_date>/);
    // Escaped title; the 72-hour-old story and the test fixture are left out.
    expect(xml).toContain('council approves a sample budget &amp; plan');
    expect(xml).not.toContain('fixture-park-opens');
    expect(xml).not.toContain('test-never-listed');
  });

  test('RSS for the site and per beat', async ({ page }) => {
    const site = await get(page, `${feed}/feed.xml`);
    expect(site.headers()['content-type']).toContain('application/rss+xml');
    const xml = await site.text();
    expect(xml).toContain('<title>The Feed Town Gazette</title>');
    expect(xml).toContain('<link>https://feedtown.test/news/fixture-council-vote</link>');
    expect(xml).not.toContain('test-never-listed');

    const beat = await (await get(page, `${feed}/beat/community/feed.xml`)).text();
    expect(beat).toContain('<title>The Feed Town Gazette: Community</title>');
    expect(beat).toContain('fixture-park-opens');
    expect(beat).not.toContain('fixture-council-vote');
    expect((await get(page, `${feed}/beat/not-a-beat/feed.xml`)).status()).toBe(404);
  });

  test('articles carry a canonical URL and NewsArticle JSON-LD naming the site', async ({
    page,
  }) => {
    await page.goto(`${feed}/news/fixture-council-vote`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://feedtown.test/news/fixture-council-vote',
    );
    const data = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent())!,
    );
    expect(data).toMatchObject({
      '@type': 'NewsArticle',
      headline: '[TEST] Feed Town council approves a sample budget & plan',
      mainEntityOfPage: 'https://feedtown.test/news/fixture-council-vote',
      author: { name: 'The Feed Town Gazette Newsroom' },
      publisher: { name: 'The Feed Town Gazette' },
    });
    expect(JSON.stringify(data)).not.toContain('TownCore');
    await expect(page.locator('link[type="application/rss+xml"]')).toHaveAttribute(
      'href',
      /\/feed\.xml$/,
    );
  });

  test('unknown hosts get no discovery files', async ({ page }) => {
    expect((await get(page, 'http://unknown-town.example/robots.txt')).status()).toBe(404);
    expect((await get(page, 'http://unknown-town.example/sitemap.xml')).status()).toBe(404);
  });
});
