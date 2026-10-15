import { expect, test } from '@playwright/test';

const boca = 'http://bocatownsquare.com';

test.describe('multi-tenant routing', () => {
  for (const host of ['bocatownsquare.com', 'www.bocatownsquare.com']) {
    test(`${host} renders Boca Town Square`, async ({ page }) => {
      const response = await page.goto(`http://${host}/`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle('Boca Town Square');
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Boca Town Square' }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boca Town Square');
    });
  }

  test('an unknown host gets a 404, never a default town', async ({ page }) => {
    const response = await page.goto('http://unknown-town.example/');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.getByText('Boca Town Square')).toHaveCount(0);
  });
});

test.describe('network disclosure (rule 1)', () => {
  for (const path of ['/', '/network']) {
    test(`${path} shows the network badge linking to the network About page`, async ({ page }) => {
      await page.goto(`${boca}${path}`);
      const badge = page.getByTestId('network-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('Part of the TownCore Local network');
      await expect(badge).toHaveAttribute('href', '/network');
    });
  }

  test('network About names the company and contact email', async ({ page }) => {
    await page.goto(`${boca}/network`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'About the TownCore Local network',
    );
    await expect(page.getByRole('main')).toContainText('operated by TownCore');
    await expect(
      page.getByRole('main').getByRole('link', { name: 'info@towncore.net' }),
    ).toHaveAttribute('href', 'mailto:info@towncore.net');
  });
});

test('a draft town is not indexable', async ({ page }) => {
  await page.goto(`${boca}/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('the Boca theme is applied (palette, type pairing, corners)', async ({ page }) => {
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
    };
  });
  expect(styles).toMatchObject({
    background: 'rgb(255, 255, 255)', // palette.background #FFFFFF
    text: 'rgb(14, 74, 107)', // palette.ink #0E4A6B
    h1: 'rgb(14, 74, 107)',
    radius: '6px', // corners: soft
  });
  expect(styles.h1Font).toContain('Newsreader');
  expect(styles.bodyFont).toContain('Public Sans');
});

test('the network badge keeps the locked network style, not the town theme', async ({ page }) => {
  await page.goto(`${boca}/`);
  const badge = await page.getByTestId('network-badge').evaluate((el) => {
    const css = getComputedStyle(el);
    return { background: css.backgroundColor, color: css.color };
  });
  expect(badge).toEqual({ background: 'rgb(22, 35, 58)', color: 'rgb(246, 241, 231)' }); // --net-navy / --net-paper
});

test('the network About content uses the network brand', async ({ page }) => {
  await page.goto(`${boca}/network`);
  const panel = await page
    .getByTestId('network-panel')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panel).toBe('rgb(246, 241, 231)'); // --net-paper
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${boca}/`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
