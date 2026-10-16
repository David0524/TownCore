import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import { campaigns, createDb, eq, towns } from '@towncore/db';

// The directory (M6 PR B, docs/plans/M6.md §2) on the fictional fixture towns: 5 plumbers
// (one claimed), 2 roofers and 1 restaurant, seeded by scripts/test-directory.ts.
const harbor = 'http://harborpoint.test';
const feed = 'http://feedtown.test';
const plumbers = `${harbor}/directory/plumbers`;
const unclaimed = `${plumbers}/cove-plumbing-test0003`;
const claimed = `${plumbers}/anchor-plumbing-co-test0001`;

async function robots(page: Page) {
  const meta = page.locator('meta[name="robots"]');
  return (await meta.count()) ? meta.getAttribute('content') : null;
}

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b) as Record<string, unknown>);
}

test('the directory home lists categories with counts', async ({ page }) => {
  await page.goto(`${harbor}/directory`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Places', level: 1 })).toBeVisible();
  await expect(main.getByRole('link', { name: /Plumbers\s*5 listed/ })).toHaveAttribute(
    'href',
    '/directory/plumbers',
  );
  await expect(main.getByRole('link', { name: /Roofers\s*2 listed/ })).toBeVisible();
  await expect(main.getByRole('link', { name: /Restaurants\s*1 listed/ })).toBeVisible();
});

test('search finds a business by name and is not indexed', async ({ page }) => {
  await page.goto(`${harbor}/directory?q=cove`);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /Cove Plumbing/ })).toHaveAttribute(
    'href',
    '/directory/plumbers/cove-plumbing-test0003',
  );
  expect(await robots(page)).toContain('noindex');
  await page.goto(`${harbor}/directory?q=zzzz`);
  await expect(page.getByTestId('directory-no-results')).toBeVisible();
});

test('a category page has its slots, then organic listings with the claimed one first', async ({
  page,
}) => {
  await page.goto(plumbers);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Plumbers in Harbor Point' })).toBeVisible();
  for (const name of [
    'directory.category.exclusive',
    'directory.topspot',
    'directory.category.top',
    'directory.quote-request',
  ]) {
    const slot = page.locator(`[data-slot="${name}"]`);
    await expect(slot, name).toHaveAttribute('data-fill', 'house');
    await expect(slot.getByTestId('slot-label'), name).toHaveText('From The Harbor Point Ledger');
  }
  await expect(page.locator('[data-slot="directory.topspot"]')).toContainText(
    'Top spot open: Plumbers. Claim it',
  );
  await expect(page.locator('[data-slot="directory.category.exclusive"]')).toContainText(
    "Become Harbor Point's featured plumber",
  );
  const names = await page
    .locator('#organic ~ ul a, section[aria-labelledby="organic"] li a')
    .allTextContents();
  expect(names[0]).toContain('Anchor Plumbing Co');
  expect(names).toHaveLength(5);
  // Unclaimed street addresses never appear (D-M6-2).
  expect(await page.content()).not.toContain('Private Home Rd');
});

test('a category with fewer than 5 listings is noindex; a fuller one is indexable', async ({
  page,
}) => {
  // Feed Town is the live fixture town, so its layout doesn't noindex everything.
  await page.goto(`${feed}/directory/roofers`);
  expect(await robots(page)).toContain('noindex');
  await page.goto(`${feed}/directory/plumbers`);
  expect(await robots(page)).toBeNull();
});

test('an unclaimed listing shows the license, no street or phone, and a claim button', async ({
  page,
}) => {
  await page.goto(unclaimed);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Cove Plumbing', level: 1 })).toBeVisible();
  await expect(page.getByTestId('license-verified')).toBeVisible();
  await expect(page.getByTestId('listing-place')).toHaveText('Harbor Point area · 04000');
  await expect(main).toContainText('TEST0003, active through');
  await expect(page.getByTestId('claim')).toBeVisible();
  await expect(page.locator('[data-slot="directory.business.cta"]')).toBeVisible();
  await expect(main.getByRole('link', { name: /^Call / })).toHaveCount(0);
  expect(await page.content()).not.toContain('Private Home Rd');
  expect(await robots(page)).toContain('noindex');
  const business = (await jsonLd(page)).find((d) => d['@type'] === 'Plumber')!;
  expect(business).toMatchObject({ name: 'Cove Plumbing' });
  expect(business.address).not.toHaveProperty('streetAddress');
  expect(business).not.toHaveProperty('telephone');
});

test('a claimed listing shows its address, phone and a call button', async ({ page }) => {
  await page.goto(claimed);
  const main = page.getByRole('main');
  await expect(page.getByTestId('listing-place')).toHaveText(
    '12 Wharf St, Harbor Point area, 04000',
  );
  await expect(main.getByRole('link', { name: 'Call Anchor Plumbing Co' })).toHaveAttribute(
    'href',
    'tel:2075550142',
  );
  await expect(page.getByTestId('claim')).toHaveCount(0);
  const business = (await jsonLd(page)).find((d) => d['@type'] === 'Plumber')!;
  expect(business).toMatchObject({
    telephone: '(207) 555-0142',
    address: { streetAddress: '12 Wharf St', addressLocality: 'Harbor Point' },
  });
});

test('a listing under the wrong category redirects to its own', async ({ page }) => {
  await page.goto(`${harbor}/directory/roofers/cove-plumbing-test0003`);
  expect(new URL(page.url()).pathname).toBe('/directory/plumbers/cove-plumbing-test0003');
  const missing = await page.goto(`${harbor}/directory/plumbers/no-such-business`);
  expect(missing?.status()).toBe(404);
  const noCategory = await page.goto(`${harbor}/directory/astronauts`);
  expect(noCategory?.status()).toBe(404);
});

test('Places is the selected tab on directory pages', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone chrome');
  await page.goto(unclaimed);
  await expect(page.getByTestId('tab-bar').getByRole('link', { name: 'Places' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Back goes to the category, and from there to Places; Places itself has none.
  const bar = page.getByTestId('phone-bar');
  await expect(bar.getByRole('link', { name: 'Back' })).toHaveAttribute(
    'href',
    '/directory/plumbers',
  );
  await page.goto(plumbers);
  await expect(bar.getByRole('link', { name: 'Places' })).toHaveAttribute('href', '/directory');
  await page.goto(`${harbor}/directory`);
  await expect(bar.getByRole('link', { name: 'Places' })).toHaveCount(0);
});

test('directory slots keep their reserved heights and never overflow (ad standards)', async ({
  page,
}) => {
  for (const url of [`${harbor}/directory`, plumbers, unclaimed]) {
    await page.goto(url);
    const problems = await page.locator('[data-slot][data-format]').evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .flatMap((el) => {
          const box = el.getBoundingClientRect();
          const name = el.getAttribute('data-slot');
          const out: string[] = [];
          if (box.height < 90) out.push(`${name} is ${box.height}px`);
          if (!el.querySelector('[data-testid="slot-label"]')?.textContent)
            out.push(`${name} unlabeled`);
          if (
            [...el.querySelectorAll('strong, span')].some(
              (child) => child.getBoundingClientRect().bottom > box.bottom + 1,
            )
          )
            out.push(`${name} overflows`);
          return out;
        }),
    );
    expect(problems, url).toEqual([]);
  }
});

test.describe.serial('a category campaign fills that category only', () => {
  const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
  let campaignId: string;

  test.beforeAll(async () => {
    const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
    const [row] = await db
      .insert(campaigns)
      .values({
        townId: town!.id,
        slot: 'directory.topspot',
        category: 'plumbers',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000),
        creative: {
          headline: 'Bayside Pipe and Drain: same-day repairs',
          href: 'https://example.com/bayside',
          advertiser: 'Bayside Pipe and Drain',
        },
      })
      .returning();
    campaignId = row!.id;
  });

  test.afterAll(async () => {
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await db.$client.end();
  });

  test('the plumbers Top spot is sold; the roofers one is still open', async ({ page }) => {
    await page.goto(plumbers);
    const top = page.locator('[data-slot="directory.topspot"]');
    await expect(top).toHaveAttribute('data-fill', 'campaign');
    await expect(top.getByTestId('slot-label')).toHaveText('Sponsored · Bayside Pipe and Drain');
    await page.goto(`${harbor}/directory/roofers`);
    await expect(page.locator('[data-slot="directory.topspot"]')).toHaveAttribute(
      'data-fill',
      'house',
    );
    // A category campaign never leaks onto pages without that category.
    await page.goto(`${harbor}/`);
    await expect(page.locator('[data-slot="home.top"]')).toHaveAttribute('data-fill', 'house');
  });
});
