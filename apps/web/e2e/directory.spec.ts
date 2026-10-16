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

test('the directory home shows every kind and opens on one, listed', async ({ page }) => {
  await page.goto(`${harbor}/directory`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Places', level: 1 })).toBeVisible();
  // It opens on restaurants, marked in the bar, with the restaurants listed below.
  const bar = page.getByTestId('category-bar');
  await expect(bar.locator('[aria-current="page"]')).toContainText('Restaurants');
  await expect(page.getByTestId('directory-opening').getByTestId('place-card')).not.toHaveCount(0);
  // Picking another kind keeps the bar, now marking that kind.
  await bar.getByRole('link', { name: /Plumbers/ }).click();
  await expect(page).toHaveURL(/\/directory\/plumbers$/);
  await expect(page.getByTestId('category-bar').locator('[aria-current="page"]')).toContainText(
    'Plumbers',
  );
  await page.goto(`${harbor}/directory`);
  await expect(main.getByRole('link', { name: /Plumbers\s*5 places/ })).toHaveAttribute(
    'href',
    '/directory/plumbers',
  );
  await expect(main.getByRole('link', { name: /Roofers\s*2 places/ })).toBeVisible();
  await expect(main.getByRole('link', { name: /Restaurants\s*1 place\b/ })).toBeVisible();
});

test('the advertising page sells featured spots at the town’s prices', async ({ page }) => {
  await page.goto(`${harbor}/advertise?category=plumbers`);
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { name: 'Get your business featured', level: 1 }),
  ).toBeVisible();
  const spots = page.getByTestId('featured-spots').getByRole('listitem');
  await expect(spots).toHaveCount(3);
  await expect(spots.nth(0)).toContainText('#1');
  await expect(spots.nth(0)).toContainText('$19 a month');
  await expect(spots.nth(1)).toContainText('$12 a month');
  await expect(spots.nth(2)).toContainText('$7 a month');
  await expect(main).toContainText('Your first 30 days are free.');
  await expect(page.getByTestId('advertise-category')).toContainText('#1, #2, #3 open');
  // House ads on the category page lead here.
  await page.goto(plumbers);
  await expect(page.locator('[data-slot="directory.topspot"] a')).toHaveAttribute(
    'href',
    '/advertise?category=plumbers',
  );
  await expect(page.locator('[data-slot="directory.topspot"]')).toContainText(
    '$19 a month, first 30 days free',
  );
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
  await expect(page.locator('[data-slot="directory.topspot"]')).toContainText('#1 spot open');
  await expect(page.locator('[data-slot="directory.category.exclusive"]')).toContainText(
    'Is yours listed? Claim it free',
  );
  const names = await page
    .locator('section[aria-labelledby="organic"] [data-testid="place-card"] h3 a')
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

test('directory pages do not shift, and keep ads at or below 30% of a phone page (ad standards)', async ({
  page,
  isMobile,
}) => {
  // Short lists on phones: 5 plumbers, 2 roofers, a one-result and a no-result search.
  for (const url of [
    `${harbor}/directory`,
    plumbers,
    `${harbor}/directory/roofers`,
    `${plumbers}?q=anchor`,
    `${plumbers}?q=nothing-matches`,
    unclaimed,
    claimed,
  ]) {
    await page.goto(url);
    const { density, cls } = await page.evaluate(
      () =>
        new Promise<{ density: number; cls: number }>((resolve) => {
          let cls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<
              PerformanceEntry & { value: number; hadRecentInput: boolean }
            >) {
              if (!entry.hadRecentInput) cls += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => {
            // A listing's own call and quote buttons (directory.business.cta) are its contact
            // details on its own page, not an ad unit.
            const slotHeight = [...document.querySelectorAll('[data-slot]')]
              .filter((el) => (el as HTMLElement).offsetParent !== null)
              .filter((el) => el.getAttribute('data-slot') !== 'directory.business.cta')
              .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
            resolve({ density: slotHeight / document.documentElement.scrollHeight, cls });
          }, 1000);
        }),
    );
    expect(cls, url).toBeLessThan(0.1);
    // The density rule is for phones (Coalition for Better Ads); desktop has a rail. On a short
    // list, unsold house ads in the rail box, quote slot and sponsored cards step aside on phones.
    if (isMobile) expect(density, url).toBeLessThanOrEqual(0.3);
  }
  await page.goto(plumbers);
  for (const name of ['rail.box', 'directory.quote-request', 'directory.category.top'])
    await (isMobile
      ? expect(page.locator(`[data-slot="${name}"]`), name).toBeHidden()
      : expect(page.locator(`[data-slot="${name}"]`), name).toBeVisible());
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

test.describe('directory on the homepage and articles', () => {
  test('homepage modules: featured, find a pro, new places to eat', async ({ page }) => {
    await page.goto(`${harbor}/`);
    const featured = page.locator('[data-module="directory-featured"]');
    await expect(featured.locator('[data-slot="home.directory"]')).toBeVisible();
    // Only claimed listings are featured; unclaimed ones are one click away.
    await expect(featured.getByRole('link', { name: 'Anchor Plumbing Co' })).toHaveAttribute(
      'href',
      '/directory/plumbers/anchor-plumbing-co-test0001',
    );
    await expect(
      featured.getByRole('link', { name: 'Browse 8 licensed businesses' }),
    ).toBeVisible();

    const pro = page.locator('[data-module="find-a-pro"]');
    await expect(pro.getByRole('link', { name: /Plumbers\s*5/ })).toHaveAttribute(
      'href',
      '/directory/plumbers',
    );
    await expect(pro.getByRole('link', { name: /Restaurants/ })).toHaveCount(0);
    await expect(pro.locator('[data-slot="directory.topspot"]')).toContainText('#1 spot open');

    const eat = page.locator('[data-module="new-now-open"]');
    await expect(eat.getByRole('listitem')).toHaveCount(2);
    await expect(eat.getByRole('link', { name: 'Harbor Light Chowder House' })).toHaveAttribute(
      'href',
      '/directory/restaurants/harbor-light-chowder-house-test0008',
    );
    // Not yet in the directory: shown without a link.
    await expect(eat).toContainText('Lobster Pot Takeout');
    await expect(eat.getByRole('link', { name: 'Lobster Pot Takeout' })).toHaveCount(0);
    await expect(eat.locator('[data-slot="dining.featured"]')).toContainText(
      'Your restaurant here',
    );
  });

  test('a development story lists licensed contractors after the sponsor slot', async ({
    page,
  }) => {
    await page.goto(`${harbor}/news/test-site-plan`);
    const related = page.getByTestId('related-businesses');
    await expect(related.getByRole('heading')).toHaveText(/Licensed roofers in Harbor Point/);
    await expect(related.getByRole('link', { name: 'Ferry Lane Roofing' })).toBeVisible();
    await expect(page.locator('[data-slot="article.related-businesses"]')).toBeVisible();
  });

  test('a business story lists restaurants', async ({ page }) => {
    await page.goto(`${harbor}/news/test-harbor-business`);
    await expect(
      page
        .getByTestId('related-businesses')
        .getByRole('link', { name: 'Harbor Light Chowder House' }),
    ).toBeVisible();
  });
});
