import { expect, test } from '@playwright/test';

// Article visuals and share images (CLAUDE.md §11c; docs/plans/M4.md §3).
const boca = 'http://bocatownsquare.com';
const harbor = 'http://harborpoint.test';

test('a roundup over several days gets a data graphic built from its records', async ({ page }) => {
  await page.goto(`${harbor}/news/test-harbor-roundup`);
  const chart = page.getByRole('main').locator('figure [data-visual="data-graphic"]');
  await expect(chart).toHaveAttribute('role', 'img');
  await expect(chart).toHaveAttribute(
    'aria-label',
    /^Bar chart of new business filings by day, .+ Total 6\.$/,
  );
  await expect(page.getByRole('main').locator('figure figcaption')).toContainText(
    'Counted from this story',
  );
});

test('a story with a street address gets a block-level map with the OpenStreetMap credit', async ({
  page,
}) => {
  await page.goto(`${harbor}/news/test-site-plan`);
  const main = page.getByRole('main');
  const map = main.locator('figure [data-visual="map"]');
  await expect(map).toHaveAttribute('role', 'img');
  await expect(map).toHaveAttribute(
    'aria-label',
    /^Street map of Harbor Point centered on the 400 block of Sample Harbor Road, with Ferry Lane nearby\. The marked area shows the block, not an exact address\.$/,
  );
  // Never more precise than the block: the house number appears nowhere in the map.
  expect(await map.innerHTML()).not.toContain('412');
  const credit = main.getByTestId('map-credit');
  await expect(credit).toContainText('not an exact address');
  await expect(credit.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  );
  const res = (await page.goto(`${harbor}/news/test-site-plan/og`))!;
  expect(res.status()).toBe(200);
  const png = await res.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test('other stories get the typographic card', async ({ page }) => {
  await page.goto(`${boca}/news/test-article`);
  await expect(
    page.getByRole('main').locator('figure [data-visual="typographic-card"]'),
  ).toHaveCount(1);
});

test('every article has a 1200×630 share image in its metadata and structured data', async ({
  page,
}) => {
  for (const [url, slug] of [
    [boca, 'test-article'],
    [harbor, 'test-harbor-roundup'],
  ] as const) {
    await page.goto(`${url}/news/${slug}`);
    const domain = new URL(url).hostname;
    const share = `https://${domain}/news/${slug}/og`;
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', share);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200',
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonLd.some((t) => t.includes(`"image":["${share}"]`))).toBe(true);

    const res = (await page.goto(`${url}/news/${slug}/og`))!;
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    const png = await res.body();
    // PNG header: width and height are big-endian at bytes 16–23.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  }
});

test('no share image for a story that does not exist', async ({ page }) => {
  const res = (await page.goto(`${boca}/news/no-such-story/og`))!;
  expect(res.status()).toBe(404);
});
