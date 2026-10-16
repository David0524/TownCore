import { expect, test } from '@playwright/test';

const boca = 'http://bocatownsquare.com';

test.describe('multi-tenant routing', () => {
  for (const host of ['bocatownsquare.com', 'www.bocatownsquare.com']) {
    test(`${host} renders Boca Town Square`, async ({ page, isMobile }) => {
      const response = await page.goto(`http://${host}/`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle('Boca Town Square');
      // Phones show the wordmark in the iOS navigation bar instead of the town's header.
      await expect(
        isMobile
          ? page.getByTestId('phone-masthead')
          : page.getByRole('banner').getByRole('link', { name: 'Boca Town Square' }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Boca Town Square: local news for Boca Raton, FL',
      );
    });
  }

  test('an unknown host gets a 404, never a default town', async ({ page }) => {
    const response = await page.goto('http://unknown-town.example/');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.getByText('Boca Town Square')).toHaveCount(0);
  });
});

test.describe('sites look independent (Rule 1)', () => {
  for (const path of ['/', '/beat/government', '/does-not-exist']) {
    test(`${path} never mentions the publisher or a network`, async ({ page }) => {
      await page.goto(`${boca}${path}`);
      const html = await page.content();
      expect(html).not.toMatch(/towncore/i);
      expect(html).not.toMatch(/part of the .* network/i);
    });
  }

  test('there is no network page', async ({ page }) => {
    const response = await page.goto(`${boca}/network`);
    expect(response?.status()).toBe(404);
  });

  test('the footer shows the site’s own contact address', async ({ page }) => {
    await page.goto(`${boca}/`);
    await expect(page.getByTestId('contact-email')).toHaveAttribute(
      'href',
      'mailto:news@bocatownsquare.com',
    );
  });
});

test('a draft town is not indexable', async ({ page }) => {
  await page.goto(`${boca}/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('the Boca theme is applied (palette, type pairing, corners)', async ({ page, isMobile }) => {
  await page.goto(`${boca}/`);
  const styles = await page.evaluate(() => {
    const css = (el: Element | null) => (el ? getComputedStyle(el) : null);
    return {
      background: css(document.body)?.backgroundColor,
      text: css(document.body)?.color,
      bodyFont: css(document.body)?.fontFamily,
      h1: css(document.querySelector('h1'))?.color,
      h1Font: css(document.querySelector('h1'))?.fontFamily,
      radius: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
      wordmark: getComputedStyle(document.documentElement).getPropertyValue('--font-wordmark'),
      chart: getComputedStyle(document.documentElement).getPropertyValue('--font-chart'),
    };
  });
  if (isMobile) {
    // Phones: iOS label black and system fonts (docs/plans/M4b.md revision 5).
    expect(styles).toMatchObject({
      background: 'rgb(255, 255, 255)',
      text: 'rgb(0, 0, 0)',
      radius: '10px',
    });
    expect(styles.bodyFont).toContain('-apple-system');
    // Headlines in San Francisco (owner, 2026-10-16); the wordmark keeps the town's face.
    expect(styles.h1Font).toContain('-apple-system');
    expect(styles.h1Font).not.toContain('New York');
    expect(styles.wordmark).toContain('Outfit');
    expect(styles.chart).toContain('Space Grotesk');
    return;
  }
  expect(styles).toMatchObject({
    background: 'rgb(255, 255, 255)', // palette.background #FFFFFF
    text: 'rgb(17, 20, 24)', // palette.ink #111418
    h1: 'rgb(17, 20, 24)',
    radius: '6px', // corners: soft
  });
  // Boca's type set: Outfit display, Geist text; charts in their own face.
  expect(styles.h1Font).toContain('Outfit');
  expect(styles.wordmark).toContain('Outfit');
  expect(styles.chart).toContain('Space Grotesk');
  expect(styles.bodyFont).toContain('Geist');
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${boca}/`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
