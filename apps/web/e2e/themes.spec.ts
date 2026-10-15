import { expect, test, type Page } from '@playwright/test';

// CLAUDE.md §11a / M1: a second town with a different look AND layout proves nothing is
// hardcoded, while locked components stay identical.
const towns = {
  boca: {
    url: 'http://bocatownsquare.com',
    name: 'Boca Town Square',
    parts: ['header:slim-left', 'nav:beat-tabs', 'grid:main-right-rail', 'footer:three-column'],
  },
  harbor: {
    url: 'http://harborpoint.test',
    name: 'The Harbor Point Ledger',
    parts: ['header:nameplate-double-rule', 'nav:text-nav', 'grid:single-column', 'footer:minimal'],
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

test('the two towns differ in look and layout', async ({ page, isMobile }) => {
  await page.goto(`${towns.boca.url}/`);
  const boca = await look(page);
  await page.goto(`${towns.harbor.url}/`);
  const harbor = await look(page);

  expect(harbor.accent).not.toBe(boca.accent);
  // Phones share Apple-native fonts, ink and shapes on every town; they differ by tint.
  if (!isMobile) {
    expect(harbor.ink).not.toBe(boca.ink);
    expect(harbor.radius).not.toBe(boca.radius);
    expect(harbor.headlineFont).not.toBe(boca.headlineFont);
    expect(harbor.bodyFont).not.toBe(boca.bodyFont);
  }
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

test('the heritage section row links to each section', async ({ page, isMobile }) => {
  test.skip(isMobile, 'phones navigate with the tab bar');
  await page.goto(`${towns.harbor.url}/`);
  const nav = page.locator('[data-part="nav:text-nav"]');
  await nav.getByRole('link', { name: 'Schools' }).click();
  await expect(page).toHaveURL(`${towns.harbor.url}/beat/schools`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schools');
});

test('heritage puts the lead in the center column between Today and the briefs', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'columns are a desktop layout');
  await page.goto(`${towns.harbor.url}/`);
  await expect(page.locator('[data-family="heritage"]')).toHaveCount(1);
  const band = page.locator('[data-band="three-column"]');
  const columns = band.locator(':scope > [data-band-col]');
  await expect(columns).toHaveCount(3);
  await expect(columns.nth(1).locator('[data-module="lead-story"]')).toHaveCount(1);
  await expect(columns.nth(2).locator('[data-module="briefs"]')).toHaveCount(1);
  const [left, center, right] = await columns.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().x),
  );
  expect(left! < center! && center! < right!).toBe(true);
  // Square corners, the town's tagline under the nameplate, and the red Subscribe button.
  await expect(page.getByText('News off the dock, every morning.')).toBeVisible();
  const subscribe = page.getByRole('link', { name: 'Subscribe free' });
  expect(await subscribe.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(179, 38, 30)',
  );
});

test('three families render, with the locked elements identical', async ({ page, isMobile }) => {
  const pine = 'http://pinehollow.test';
  await page.goto(`${pine}/`);
  await expect(page.locator('[data-family="community"]')).toHaveCount(1);
  if (!isMobile) {
    for (const part of ['header:tinted-bar', 'grid:main-right-rail', 'footer:community']) {
      await expect(page.locator(`[data-part="${part}"]`), part).toHaveCount(1);
    }
    // The tinted bar is the brand color; the sign-up button is the warm secondary.
    const bar = page.locator('[data-part="header:tinted-bar"] > div').first();
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(35, 75, 53)',
    );
  }
  await expect(page.locator('[data-module="briefing-column"]')).toContainText(
    'Today in Pine Hollow',
  );

  // Locked across families: the sponsored-unit label style and the category dot colors.
  const locked = async (url: string) => {
    await page.goto(`${url}/`);
    return page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        sand: root.getPropertyValue('--sand').trim(),
        alert: root.getPropertyValue('--alert').trim(),
        news: root.getPropertyValue('--cat-news').trim(),
        business: root.getPropertyValue('--cat-business').trim(),
        family: document.querySelector('[data-family]')?.getAttribute('data-family'),
      };
    });
  };
  const looks = [];
  for (const url of [towns.boca.url, towns.harbor.url, pine]) looks.push(await locked(url));
  expect(new Set(looks.map((l) => l.family))).toEqual(
    new Set(['coastal-modern', 'heritage', 'community']),
  );
  for (const look of looks.slice(1)) {
    expect({ ...look, family: '' }).toEqual({ ...looks[0], family: '' });
  }
});
