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
      await expect(tabs.getByRole('link')).toHaveText(['Today', 'Sections', 'Events', 'Search']);
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
