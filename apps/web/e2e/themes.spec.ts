import { expect, test, type Page } from '@playwright/test';

// CLAUDE.md §11a / M1: a second town with a different look AND layout proves nothing is
// hardcoded, while locked components stay identical.
const towns = {
  boca: {
    url: 'http://bocatownsquare.com',
    name: 'Boca Town Square',
    parts: [
      'header:stacked-dateline',
      'nav:beat-tabs',
      'grid:main-right-rail',
      'footer:three-column',
    ],
  },
  harbor: {
    url: 'http://harborpoint.test',
    name: 'The Harbor Point Ledger',
    parts: [
      'header:left-logo-inline-nav',
      'nav:hamburger-only',
      'grid:single-column',
      'footer:minimal',
    ],
  },
};

async function look(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      ink: root.getPropertyValue('--ink').trim(),
      accent: root.getPropertyValue('--accent').trim(),
      radius: root.getPropertyValue('--radius').trim(),
      headlineFont: root.getPropertyValue('--font-headline').trim(),
      bodyFont: root.getPropertyValue('--font-body').trim(),
      parts: [...document.querySelectorAll('[data-part]')].map((el) =>
        el.getAttribute('data-part'),
      ),
    };
  });
}

test('Harbor Point renders its own name and layout parts', async ({ page }) => {
  await page.goto(`${towns.harbor.url}/`);
  await expect(page).toHaveTitle(towns.harbor.name);
  for (const part of towns.harbor.parts) {
    await expect(page.locator(`[data-part="${part}"]`), part).toHaveCount(1);
  }
  await expect(page.getByTestId('masthead').locator('svg')).toHaveAttribute(
    'aria-label',
    towns.harbor.name,
  );
});

test('the two towns differ in look and layout', async ({ page }) => {
  await page.goto(`${towns.boca.url}/`);
  const boca = await look(page);
  await page.goto(`${towns.harbor.url}/`);
  const harbor = await look(page);

  expect(harbor.ink).not.toBe(boca.ink);
  expect(harbor.accent).not.toBe(boca.accent);
  expect(harbor.radius).not.toBe(boca.radius);
  expect(harbor.headlineFont).not.toBe(boca.headlineFont);
  expect(harbor.bodyFont).not.toBe(boca.bodyFont);
  expect(boca.parts).toEqual(towns.boca.parts);
  expect(harbor.parts).toEqual(towns.harbor.parts);
});

test('neither town mentions the publisher or links to the other', async ({ page }) => {
  for (const town of Object.values(towns)) {
    await page.goto(`${town.url}/`);
    const html = await page.content();
    expect(html).not.toMatch(/towncore/i);
    const other = town === towns.boca ? 'harborpoint' : 'bocatownsquare';
    expect(html).not.toContain(other);
  }
});

test('the hamburger menu opens and links work', async ({ page }) => {
  await page.goto(`${towns.harbor.url}/`);
  const nav = page.locator('[data-part="nav:hamburger-only"]');
  await nav.getByText('Menu').click();
  await nav.getByRole('link', { name: 'Schools' }).click();
  await expect(page).toHaveURL(`${towns.harbor.url}/beat/schools`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schools');
});
