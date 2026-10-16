import { expect, test } from '@playwright/test';

// Apple-native phone chrome below 600px on every town (docs/plans/M4b.md revision 5).
const boca = 'http://bocatownsquare.com';
const harbor = 'http://harborpoint.test';

test.describe('phone chrome', () => {
  test('phones get the tab bar and a large title; the town header is hidden', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone chrome');
    for (const url of [boca, harbor]) {
      await page.goto(`${url}/`);
      const tabs = page.getByTestId('tab-bar');
      await expect(tabs).toBeVisible();
      await expect(tabs.getByRole('link')).toHaveText([
        'Today',
        'Sections',
        'Events',
        'Places',
        'Search',
      ]);
      await expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(await tabs.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      await expect(page.getByTestId('large-title').first()).toContainText('Today');
      await expect(page.getByTestId('masthead')).toBeHidden();
      await expect(page.getByTestId('phone-masthead')).toBeVisible();
      // Every tab is at least a 44pt touch target.
      for (const box of await tabs
        .getByRole('link')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height)))
        expect(box).toBeGreaterThanOrEqual(44);
    }
  });

  test('desktop keeps the town header and never shows the tab bar', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.goto(`${boca}/`);
    await expect(page.getByTestId('tab-bar')).toBeHidden();
    await expect(page.getByTestId('phone-bar')).toBeHidden();
    await expect(page.getByTestId('masthead')).toBeVisible();
  });

  test('inner pages have a back button to their tab', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone chrome');
    await page.goto(`${boca}/beat/government`);
    const bar = page.getByTestId('phone-bar');
    await expect(bar.getByRole('link', { name: 'Sections' })).toHaveAttribute('href', '/sections');
    await expect(
      page.getByTestId('tab-bar').getByRole('link', { name: 'Sections' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.goto(`${boca}/news/test-article`);
    await expect(bar.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/');
  });

  test('weather stays above the fold on phones', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone chrome');
    await page.goto(`${boca}/about`);
    const any = page.locator(
      '[data-testid="phone-weather"], [data-testid="weather-line"], [data-testid="header-weather"]',
    );
    test.skip((await any.count()) === 0, 'no weather data in this database');
    const weather = page.getByTestId('phone-weather').or(page.getByTestId('weather-line'));
    await expect(weather.first()).toBeVisible();
    expect((await weather.first().boundingBox())!.y).toBeLessThan(page.viewportSize()!.height);
  });
});

test.describe('tab pages', () => {
  test('Sections lists every beat and the pages about the paper', async ({ page }) => {
    expect((await page.goto(`${boca}/sections`))?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Sections');
    await expect(main.getByRole('link', { name: /Government/ })).toHaveAttribute(
      'href',
      '/beat/government',
    );
    await expect(main.getByRole('link', { name: 'About', exact: true }).first()).toHaveAttribute(
      'href',
      '/about',
    );
  });

  test('Events lists upcoming public meetings or says there are none', async ({ page }) => {
    expect((await page.goto(`${harbor}/events`))?.status()).toBe(200);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Events');
  });

  test('Search finds published stories by headline and is not indexed', async ({ page }) => {
    await page.goto(`${boca}/search?q=test+article`);
    await expect(page.getByTestId('search-results')).toContainText('[TEST] This is a test article');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto(`${boca}/search?q=zzzz-nothing`);
    await expect(page.getByTestId('search-results')).toContainText('No stories match');
  });
});

test.describe('Your town, app icons and the Home Screen card', () => {
  test('the Your town sheet floats followed sections to the top, saved on the device', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone chrome');
    await page.goto(`${boca}/`);
    await expect(page.getByTestId('your-town-sheet')).toBeHidden();
    await page.getByRole('button', { name: 'Your Boca Raton' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your Boca Raton' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('switch', { name: 'Business' }).check({ force: true });
    await expect(sheet.getByRole('switch', { name: 'Business' })).toBeChecked();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();

    // After a reload the choice is applied before paint and Business leads the sections.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-follow', 'business');
    const order = await page
      .locator('[data-module="beat-sections"] > [data-follow-beat]')
      .evaluateAll((els) =>
        els
          .map((el) => ({
            beat: el.getAttribute('data-follow-beat'),
            y: el.getBoundingClientRect().y,
          }))
          .sort((a, b) => a.y - b.y)
          .map((s) => s.beat),
      );
    if (order.includes('business')) expect(order[0]).toBe('business');
  });

  test('each town has a web app manifest and its own icons', async ({ page }) => {
    await page.goto(`${boca}/`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    // Boca has its own icon files (its logo art); towns without them get the motif drawn in code.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/brand/boca-raton/icon-180.png',
    );
    await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
      'href',
      '/brand/boca-raton/icon-32.png',
    );
    await page.goto(`${harbor}/`);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png',
    );
    for (const url of [boca, harbor]) {
      // Through the browser, which resolves our test hosts to the local server.
      const manifest = (await page.goto(`${url}/manifest.webmanifest`))!;
      expect(manifest.status()).toBe(200);
      const json = await manifest.json();
      expect(json).toMatchObject({ start_url: '/', display: 'standalone' });
      expect(JSON.stringify(json)).not.toMatch(/towncore/i);
      for (const icon of ['/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']) {
        const res = (await page.goto(`${url}${icon}`))!;
        expect(res.status(), icon).toBe(200);
        expect(res.headers()['content-type']).toBe('image/png');
      }
    }
    const boca192 = await (await page.goto(`${boca}/icon-192.png`))!.body();
    const harbor192 = await (await page.goto(`${harbor}/icon-192.png`))!.body();
    expect(boca192.equals(harbor192)).toBe(false);
  });

  test('the Home Screen card appears from the second visit and stays dismissed', async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone chrome');
    await page.goto(`${boca}/`);
    await expect(page.getByTestId('home-screen-card')).toHaveCount(0);
    // A new tab is a new visit (one per browser session).
    const second = await context.newPage();
    await second.goto(`${boca}/`);
    const card = second.getByTestId('home-screen-card');
    await expect(card).toContainText('Put Boca Raton on your Home Screen');
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
    const third = await context.newPage();
    await third.goto(`${boca}/`);
    await third.waitForLoadState('networkidle');
    await expect(third.getByTestId('home-screen-card')).toHaveCount(0);
  });
});

test('phones get a row of more top stories under the lead, and every story ends with Up next', async ({
  page,
  isMobile,
}) => {
  // Harbor Point has enough stories for the row (it needs two besides the lead).
  await page.goto(`${harbor}/`);
  const row = page.getByTestId('top-stories-row');
  if (isMobile) {
    await expect(row).toBeVisible();
    expect(await row.getByRole('link').count()).toBeGreaterThanOrEqual(2);
  } else {
    await expect(row).toBeHidden();
  }
  const first = await page.locator('[data-module="lead-story"] h2 a').first().getAttribute('href');
  await page.goto(`${harbor}${first}`);
  const upNext = page.getByTestId('up-next');
  await expect(upNext).toBeVisible();
  const next = await upNext.getByRole('link').getAttribute('href');
  expect(next).toMatch(/^\/news\//);
  expect(next).not.toBe(first);
});
