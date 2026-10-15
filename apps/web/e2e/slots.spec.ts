import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import { campaigns, createDb, eq, towns } from '@towncore/db';

// The slot contract (CLAUDE.md §11b): required slots render with reserved heights, never empty,
// always labeled, and filling them never shifts the page.
const boca = 'http://bocatownsquare.com';
const harbor = 'http://harborpoint.test';

async function slotBoxes(page: Page) {
  return page.locator('[data-slot]').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({
        name: el.getAttribute('data-slot'),
        fill: el.getAttribute('data-fill'),
        height: el.getBoundingClientRect().height,
        label: el.querySelector('[data-testid="slot-label"]')?.textContent ?? '',
      })),
  );
}

for (const [town, url] of [
  ['Boca', boca],
  ['Harbor Point', harbor],
] as const) {
  test(`${town}: home.top and rail.box render with reserved heights and labels`, async ({
    page,
  }) => {
    await page.goto(`${url}/`);
    const boxes = await slotBoxes(page);
    const names = boxes.map((b) => b.name);
    expect(names).toContain('home.top');
    expect(names).toContain('rail.box');
    for (const box of boxes) {
      expect(box.height, `${box.name} height`).toBeGreaterThanOrEqual(90);
      expect(box.label, `${box.name} label`).not.toBe('');
    }
  });
}

test('the newsletter CTA is among the first two modules on mobile, with no email field', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile rule');
  await page.goto(`${boca}/`);
  const visibleModules = await page
    .locator('[data-module]')
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => el.getAttribute('data-module')),
    );
  // Boca has no articles yet, so news modules are hidden; the CTA must still be near the top.
  expect(visibleModules.slice(0, 2)).toContain('newsletter-cta');
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
});

test('slots do not shift the layout (CLS)', async ({ page }) => {
  await page.goto(`${boca}/`);
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { value: number; hadRecentInput: boolean }
          >) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve(total), 1000);
      }),
  );
  expect(cls).toBeLessThan(0.1);
});

test.describe.serial('a direct-sold campaign fills its slot first', () => {
  const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
  let campaignId: string;

  test.beforeAll(async () => {
    const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
    const [row] = await db
      .insert(campaigns)
      .values({
        townId: town!.id,
        slot: 'home.top',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000),
        creative: {
          headline: 'Harbor Point Hardware: 20% off rope',
          href: 'https://example.com/hardware',
          advertiser: 'Harbor Point Hardware',
        },
      })
      .returning();
    campaignId = row!.id;
  });

  test.afterAll(async () => {
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await db.$client.end();
  });

  test('home.top shows the campaign, labeled Sponsored, with rel=sponsored', async ({ page }) => {
    await page.goto(`${harbor}/`);
    const slot = page.locator('[data-slot="home.top"]');
    await expect(slot).toHaveAttribute('data-fill', 'campaign');
    await expect(slot.getByTestId('slot-label')).toHaveText('Sponsored · Harbor Point Hardware');
    await expect(slot.getByRole('link')).toHaveAttribute('rel', 'sponsored noopener');
    // Other slots in the town still fall back to house ads.
    await expect(page.locator('[data-slot="rail.box"]')).toHaveAttribute('data-fill', 'house');
  });
});

test('slot text never overflows its reserved height', async ({ page }) => {
  for (const url of [boca, harbor]) {
    await page.goto(`${url}/`);
    const overflowing = await page.locator('[data-slot]').evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('strong, span')].some(
            (child) => child.getBoundingClientRect().bottom > box.bottom + 1,
          );
        })
        .map((el) => el.getAttribute('data-slot')),
    );
    expect(overflowing, url).toEqual([]);
  }
});
