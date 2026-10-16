import { expect, test } from '@playwright/test';

// Evergreen guides (CLAUDE.md §6a; docs/plans/M4.md §5): the guides index, the guide page, the
// Essentials module, one address per article, and guides kept out of news lists and feeds.
const boca = 'http://bocatownsquare.com';
const feed = 'http://feedtown.test';
const guide = 'test-guide-trash';

test('the guides index lists guides by section and links to them', async ({ page }) => {
  await page.goto(`${boca}/guides`);
  await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
  const community = page.getByRole('region', { name: 'Community' });
  const link = community.getByRole('link', { name: /How trash pickup works/ });
  await expect(link).toHaveAttribute('href', `/guides/${guide}`);
});

test('links to other sites open in a new tab; our own links stay in this one', async ({
  page,
  context,
}) => {
  await context.route('https://www.myboca.us/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>City page</p>' }),
  );
  await page.goto(`${boca}/guides/${guide}`);
  // Any link to another site, even one written without a target (article text, say).
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://www.myboca.us/1/Plain';
    link.textContent = 'A plain outside link';
    document.querySelector('main')!.append(link);
  });
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: 'A plain outside link' }).click(),
  ]);
  await expect(popup).toHaveURL('https://www.myboca.us/1/Plain');
  await expect(page).toHaveURL(`${boca}/guides/${guide}`);
  await expect(page.getByRole('link', { name: 'A plain outside link' })).toHaveAttribute(
    'rel',
    'noopener',
  );
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Corrections', exact: true })
    .click();
  await expect(page).toHaveURL(`${boca}/corrections`);
  expect(context.pages()).toHaveLength(2);
});

test('a guide shows when it was updated and checked, the official-pages note and its sources', async ({
  page,
}) => {
  await page.goto(`${boca}/guides/${guide}`);
  await expect(page.locator('h1')).toContainText('How trash pickup works');
  await expect(page.getByTestId('byline')).toHaveText('Boca Town Square Newsroom');
  await expect(page.getByTestId('guide-dates')).toHaveText(/^Updated .+ · Last checked .+$/);
  await expect(page.getByTestId('guide-note')).toContainText('check those pages before you act');
  await expect(page.getByTestId('sources').getByRole('link')).toHaveAttribute(
    'href',
    'https://www.myboca.us/665/Sanitation',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://bocatownsquare.com/guides/${guide}`,
  );
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.some((t) => t.includes('"@type":"Article"'))).toBe(true);
  expect(jsonLd.some((t) => t.includes('"@type":"NewsArticle"'))).toBe(false);
  // The slot contract holds on guides like any article (§11b).
  await expect(page.locator('[data-slot="article.inline"]')).toHaveCount(1);
});

test('each article has one address: guides under /guides, news under /news', async ({ page }) => {
  await page.goto(`${boca}/news/${guide}`);
  expect(new URL(page.url()).pathname).toBe(`/guides/${guide}`);
  await page.goto(`${boca}/guides/test-article`);
  expect(new URL(page.url()).pathname).toBe('/news/test-article');
  const missing = await page.goto(`${boca}/guides/no-such-guide`);
  expect(missing?.status()).toBe(404);
});

test('the Essentials module links guides; news lists never show them', async ({ page }) => {
  await page.goto(`${boca}/`);
  const essentials = page.locator('[data-module="essentials"]');
  await expect(essentials.getByRole('link', { name: /How trash pickup works/ })).toHaveAttribute(
    'href',
    `/guides/${guide}`,
  );
  await expect(essentials.getByRole('link', { name: 'All guides' })).toHaveAttribute(
    'href',
    '/guides',
  );
  await expect(
    page.locator('[data-module="latest-list"]').getByRole('link', { name: /How trash pickup/ }),
  ).toHaveCount(0);
  await page.goto(`${boca}/beat/community`);
  await expect(page.getByRole('main').getByRole('link', { name: /How trash pickup/ })).toHaveCount(
    0,
  );
});

test('search finds guides', async ({ page }) => {
  await page.goto(`${boca}/search?q=trash+pickup`);
  await expect(
    page.getByRole('main').getByRole('link', { name: /How trash pickup works/ }),
  ).toHaveAttribute('href', `/guides/${guide}`);
});

test('a live town lists guides in their own sitemap, never in feeds or the news sitemap', async ({
  page,
}) => {
  const text = async (path: string) => (await page.goto(`${feed}${path}`))!.text();
  const loc = 'https://feedtown.test/guides/fixture-guide-recycling';
  expect(await text('/sitemap.xml')).toContain(
    '<loc>https://feedtown.test/sitemaps/guides.xml</loc>',
  );
  const guides = await text('/sitemaps/guides.xml');
  expect(guides).toContain(`<loc>${loc}</loc>`);
  expect(guides).not.toContain('/news/');
  expect(await text('/sitemaps/pages.xml')).toContain('<loc>https://feedtown.test/guides</loc>');
  for (const path of ['/feed.xml', '/news-sitemap.xml']) {
    expect(await text(path), path).not.toContain('fixture-guide-recycling');
  }
  const month = new Date().toISOString().slice(0, 7);
  expect(await text(`/sitemaps/articles-${month}.xml`)).not.toContain('fixture-guide-recycling');
});

test('a guide can carry a credited stock photo, never mistaken for the scene', async ({ page }) => {
  await page.goto(`${boca}/guides/${guide}`);
  const stock = page.getByRole('main').locator('figure [data-visual="stock"]');
  const img = stock.getByRole('img');
  await expect(img).toHaveAttribute('alt', 'Stock photo: garbage bins lined up at the curb.');
  // Hotlinked from Unsplash at a reserved 16:9 size.
  await expect(img).toHaveAttribute(
    'src',
    /^https:\/\/images\.unsplash\.com\/photo-test-fixture\?/,
  );
  await expect(img).toHaveAttribute('width', '1200');
  await expect(img).toHaveAttribute('height', '675');
  const credit = stock.getByTestId('stock-credit');
  await expect(credit).toHaveText('Stock photo. Photo by Sample Photographer on Unsplash');
  await expect(credit.getByRole('link', { name: 'Sample Photographer' })).toHaveAttribute(
    'href',
    'https://unsplash.com/@sample?utm_source=boca_town_square&utm_medium=referral',
  );
  await expect(credit.getByRole('link', { name: 'Unsplash' })).toHaveAttribute(
    'href',
    'https://unsplash.com/?utm_source=boca_town_square&utm_medium=referral',
  );
});
