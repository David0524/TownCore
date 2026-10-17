import { expect, test } from '@playwright/test';

// Logo art cut in code (owner, 2026-10-17). Pine Hollow has imported art (placeholder art cut by
// the same code as `pnpm identity import`, in public/brand/pine-hollow): its homepage hero and
// icons come from there. Harbor Point has none and keeps the motif and icons drawn in code.

const pine = 'http://pinehollow.test';
const harbor = 'http://harborpoint.test';
// Node-side requests can't use the browser's host mapping: go direct with the Host header.
const direct = 'http://127.0.0.1:3100';
const get = (host: string, path: string) =>
  [`${direct}${path}`, { headers: { Host: host }, maxRedirects: 0 }] as const;

test.use({ viewport: { width: 1280, height: 900 } });

test('Pine Hollow: the hero and icons are cut from its logo art', async ({ page, request }) => {
  await page.goto(`${pine}/`);
  const hero = page.locator('[data-module="good-morning"] img');
  await expect(hero).toHaveAttribute('src', '/brand/pine-hollow/hero.webp');
  // The image actually loaded, at its 3:1 size.
  await expect
    .poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(1221);

  const icon = await request.get(...get('pinehollow.test', '/icon-192.png'));
  expect(icon.status()).toBe(307);
  expect(icon.headers()['location']).toBe('/brand/pine-hollow/icon-192.png');
  const iconFile = await request.get(...get('pinehollow.test', '/brand/pine-hollow/icon-192.png'));
  expect(iconFile.headers()['content-type']).toBe('image/png');
  expect((await iconFile.body()).subarray(1, 4).toString()).toBe('PNG');
});

test('Harbor Point: no logo art, so the motif and code-drawn icons stay', async ({
  page,
  request,
}) => {
  await page.goto(`${harbor}/`);
  await expect(page.locator('img[src^="/brand/"]')).toHaveCount(0);
  const icon = await request.get(...get('harborpoint.test', '/icon-192.png'));
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toBe('image/png');
});
