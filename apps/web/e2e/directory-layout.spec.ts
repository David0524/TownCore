import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import { and, campaigns, createDb, eq, inArray, towns } from '@towncore/db';

// The directory's layout on every family (owner, 2026-10-17: "way too many place holders before
// you get to real businesses", "Move the newsletter to either the right side or as a bottom
// bar", "none of the business categories should be in alphabetical order", "The businesses can
// fit three wide on desktop"). Boca is coastal-modern, Harbor Point heritage, Pine Hollow
// community; each has the fixture listings from scripts/test-directory.ts.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });

const sites = [
  { slug: 'boca-raton', host: 'http://bocatownsquare.com' },
  { slug: 'harbor-point', host: 'http://harborpoint.test' },
  { slug: 'pine-hollow', host: 'http://pinehollow.test' },
] as const;

/**
 * Fixture kinds whose ranked order (rank-categories.ts) holds however many listings other specs
 * add to the town at the same time: not A–Z, not config order. (Plumbers and restaurants swap
 * places once some kind has a dozen listings, since size is scaled against the biggest kind.)
 */
const RANKED = ['Restaurants', 'Beauty and wellness', 'Roofers', 'Pets'];

async function allBarNames(page: Page) {
  const names = await page
    .getByTestId('category-bar')
    .locator('li a > span:nth-child(2)')
    .allTextContents();
  return names.map((n) => n.trim());
}

// Other specs add listings in kinds of their own; compare the fixture kinds only.
const barNames = async (page: Page) => (await allBarNames(page)).filter((n) => RANKED.includes(n));

for (const { slug, host } of sites) {
  test.describe(`${slug} directory`, () => {
    test('kinds are ranked, never A–Z, and the directory opens on the top one', async ({
      page,
    }) => {
      await page.goto(`${host}/directory`);
      const names = await barNames(page);
      expect(names).toEqual(RANKED);
      expect(names).not.toEqual([...names].sort());
      // It opens on the first kind in the bar.
      const [top] = await allBarNames(page);
      await expect(page.getByTestId('category-bar').locator('[aria-current="page"]')).toContainText(
        top!,
      );
      await page.goto(`${host}/directory/pets`);
      expect(await barNames(page)).toEqual(RANKED);
      // The add-your-business form offers kinds in the same order.
      await page.goto(`${host}/directory/add`);
      const options = (
        await page
          .getByRole('combobox', { name: 'Kind of business' })
          .locator('option')
          .allTextContents()
      ).filter((o) => RANKED.includes(o));
      expect(options).toEqual(RANKED);
    });

    test('real listings come first: within the first screen, after one compact strip', async ({
      page,
      isMobile,
    }) => {
      if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
      for (const path of ['/directory', '/directory/roofers']) {
        await page.goto(`${host}${path}`);
        const first = page.getByTestId('place-card').first();
        const box = (await first.boundingBox())!;
        const viewport = page.viewportSize()!;
        // Desktop: within the first screen. Phones: right after the header, bar and strip.
        expect(box.y, path).toBeLessThan(isMobile ? viewport.height * 1.1 : viewport.height);
        // Nothing but the strip sits between the kinds bar and the listings: the owner panel,
        // quote form and other house ads come after them; the newsletter sits beside the heading.
        for (const sel of [
          '[data-testid="owner-bar"]',
          '[data-slot="directory.quote-request"]',
          '[data-testid="directory-newsletter"]',
          '[data-slot="directory.category.exclusive"]',
          '[data-slot="rail.box"]',
        ]) {
          for (const el of await page.locator(sel).all()) {
            const b = await el.boundingBox();
            const beside = b && !isMobile && b.x > box.x + box.width;
            if (b && !beside) expect(b.y, `${path} ${sel}`).toBeGreaterThan(box.y);
          }
        }
      }
    });

    test('the newsletter is beside the heading on desktop and after the listings on phones', async ({
      page,
      isMobile,
    }) => {
      if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${host}/directory/plumbers`);
      const signup = page.getByTestId('directory-newsletter');
      await expect(signup).toBeVisible();
      const box = (await signup.boundingBox())!;
      const cards = page.locator('section[aria-labelledby="organic"] [data-testid="place-card"]');
      const last = (await cards.last().boundingBox())!;
      if (isMobile) {
        // A plain block at the bottom of the page, never a bar over the content.
        expect(box.y).toBeGreaterThan(last.y + last.height);
        expect(await signup.evaluate((el) => getComputedStyle(el).position)).toBe('static');
      } else {
        // Beside the heading, above the listings; the listings then run under it, across the
        // whole page (owner, 2026-10-17: use the right side of the screen).
        const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
        expect(box.x).toBeGreaterThan(heading.x + heading.width);
        const first = (await cards.first().boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(first.y);
        const third = (await cards.nth(2).boundingBox())!;
        expect(third.x + third.width).toBeGreaterThan(box.x + box.width - 4);
      }
      // Never sticky or fixed (§11b: no large sticky units): it scrolls with the page.
      const positions = await signup.evaluate((el) => {
        const out: string[] = [];
        for (let node: Element | null = el; node; node = node.parentElement)
          out.push(getComputedStyle(node).position);
        return out;
      });
      expect(positions.filter((p) => p === 'sticky' || p === 'fixed')).toEqual([]);
    });

    test('listings fill three columns at 1440px and two on a tablet', async ({
      page,
      isMobile,
    }) => {
      test.skip(isMobile, 'phones show a list of rows');
      const columns = async () =>
        (
          await page
            .locator('section[aria-labelledby="organic"] ul')
            .evaluate((el) => getComputedStyle(el).gridTemplateColumns)
        ).split(' ').length;
      for (const path of ['/directory', '/directory/plumbers']) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${host}${path}`);
        expect(await columns(), path).toBe(3);
        // Full-size cards: the three share the page width, no rail beside them.
        const widths = await page
          .locator('section[aria-labelledby="organic"] [data-testid="place-card"]')
          .evaluateAll((els) => els.slice(0, 3).map((el) => el.getBoundingClientRect().width));
        for (const w of widths) expect(w, path).toBeGreaterThan(330);
        const tops = await page
          .locator('section[aria-labelledby="organic"] [data-testid="place-card"]')
          .evaluateAll((els) => els.slice(0, 3).map((el) => el.getBoundingClientRect().top));
        expect(new Set(tops).size, path).toBe(1);
        await page.setViewportSize({ width: 800, height: 900 });
        expect(await columns(), path).toBe(2);
      }
    });

    test('unsold featured spots are one compact strip carrying both slots', async ({ page }) => {
      await page.goto(`${host}/directory/pets`);
      const strip = page.getByTestId('featured-strip');
      await expect(strip).toHaveCount(1);
      await expect(strip).toHaveAttribute('data-slot', 'directory.topspot');
      await expect(strip).toHaveAttribute('data-fill', 'house');
      await expect(strip.locator('[data-slot="directory.category.top"]')).toHaveAttribute(
        'data-fill',
        'house',
      );
      await expect(strip).toContainText('3 featured spots open');
      await expect(strip).toContainText('#1 $19/mo');
      await expect(strip).toContainText('#3 $7/mo');
      await expect(strip.getByRole('link')).toHaveAttribute('href', '/advertise?category=pets');
      // No full-size house cards for the featured spots.
      await expect(page.locator('[data-slot="directory.topspot"][data-format="card"]')).toHaveCount(
        0,
      );
      await expect(page.getByTestId('sponsored-cards')).toHaveCount(0);
      // Reserved height: the strip is exactly its size, whatever it says.
      const height = await strip.evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(70);
      expect(height).toBeLessThanOrEqual(100);
    });
  });
}

test.describe.serial('paid featured spots render in full, labeled, in rank order', () => {
  // Each project on its own town, so the two never share a category's campaigns.
  const target = (project: string) => (project === 'mobile' ? sites[2] : sites[0]);
  let ids: string[] = [];

  test.afterAll(async () => {
    if (ids.length) await db.delete(campaigns).where(inArray(campaigns.id, ids));
  });

  test('#1 and #2 sold: both in full before the listings, #3 in the strip', async ({
    page,
  }, info) => {
    const { slug, host } = target(info.project.name);
    const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
    const category = 'beauty-and-wellness';
    await db
      .delete(campaigns)
      .where(and(eq(campaigns.townId, town!.id), eq(campaigns.category, category)));
    const rows = await db
      .insert(campaigns)
      .values(
        (
          [
            ['directory.topspot', 'Kelp and Comb Salon'],
            ['directory.category.top', 'Lantern Day Spa'],
          ] as const
        ).map(([slot, advertiser]) => ({
          townId: town!.id,
          slot,
          category,
          status: 'active' as const,
          startsAt: new Date(Date.now() - 60_000),
          creative: {
            headline: `${advertiser}: open late`,
            href: 'https://example.com',
            advertiser,
          },
        })),
      )
      .returning();
    ids = rows.map((r) => r.id);

    await page.goto(`${host}/directory/${category}`);
    const top = page.locator('[data-slot="directory.topspot"][data-fill="campaign"]');
    const card = page.getByTestId('sponsored-cards').locator('[data-fill="campaign"]');
    await expect(top.getByTestId('slot-label')).toHaveText('Sponsored · Kelp and Comb Salon');
    await expect(card.getByTestId('slot-label')).toHaveText('Sponsored · Lantern Day Spa');
    await expect(top.locator('a')).toHaveClass(/paid/);
    // In rank order, before the strip and the first listing.
    const y = async (sel: ReturnType<Page['locator']>) => (await sel.boundingBox())!.y;
    const first = page
      .locator('section[aria-labelledby="organic"] [data-testid="place-card"]')
      .first();
    expect(await y(top)).toBeLessThan(await y(card));
    expect(await y(card)).toBeLessThan(await y(first));
    // Both slots are sold, so no strip; the organic order is unchanged (Rule 6).
    await expect(page.getByTestId('featured-strip')).toHaveCount(0);
    await expect(
      page.locator('section[aria-labelledby="organic"] [data-testid="place-card"]'),
    ).toHaveCount(3);

    // Only #1 sold: the #2 and #3 slot is the strip.
    await db.delete(campaigns).where(eq(campaigns.id, ids[1]!));
    await page.goto(`${host}/directory/${category}`);
    const strip = page.getByTestId('featured-strip');
    await expect(strip).toHaveAttribute('data-slot', 'directory.category.top');
    await expect(top).toHaveCount(1);
    expect(await y(top)).toBeLessThan(await y(strip));
  });
});
