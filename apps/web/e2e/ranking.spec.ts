import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  and,
  articles,
  articleStatsDaily,
  createDb,
  eq,
  findOrCreateStaff,
  getTownBySlug,
  hashToken,
  pins,
  staffSessions,
  type Db,
} from '@towncore/db';

// Ranking (docs/plans/M4.md §2, §6): staff pins move a story to the top, and the cookieless
// beacon counts views, list impressions and clicks. Runs against the live fixture Feed Town.

const feed = 'http://feedtown.test';
const admin = 'http://admin.test';

let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
});
test.afterAll(async () => {
  await db.$client.end();
});

async function articleId(slug: string) {
  const town = (await getTownBySlug(db, 'feed-town'))!;
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.townId, town.id), eq(articles.slug, slug)));
  return row!.id;
}

async function stats(slug: string) {
  const id = await articleId(slug);
  const rows = await db.select().from(articleStatsDaily).where(eq(articleStatsDaily.articleId, id));
  return rows.reduce(
    (acc, r) => ({
      views: acc.views + r.views,
      impressions: acc.impressions + r.listImpressions,
      clicks: acc.clicks + r.listClicks,
    }),
    { views: 0, impressions: 0, clicks: 0 },
  );
}

/** The order of the two fixture stories on the homepage. */
const fixtureOrder = (page: import('@playwright/test').Page) =>
  page
    .locator('main a[href^="/news/fixture-"]')
    .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href')))]);

test('the beacon counts list impressions, clicks and views, with no cookies', async ({ page }) => {
  const before = await stats('fixture-council-vote');
  const impression = page.waitForRequest((r) => r.url().endsWith('/b') && r.method() === 'POST');
  await page.goto(`${feed}/`);
  await impression;
  await page.locator('main a[href="/news/fixture-council-vote"]').first().click();
  await page.waitForURL(`${feed}/news/fixture-council-vote`);
  // Other tests visit Feed Town in parallel, so check that each counter went up.
  await expect
    .poll(async () => {
      const after = await stats('fixture-council-vote');
      return (
        after.views > before.views &&
        after.impressions > before.impressions &&
        after.clicks > before.clicks
      );
    })
    .toBe(true);
  expect(await page.context().cookies()).toEqual([]);
});

test('a staff pin moves a story to the top until it is removed', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one project changes the shared fixture town');
  // Normally the newer story ranks first.
  await page.goto(`${feed}/`);
  expect((await fixtureOrder(page))[0]).toBe('/news/fixture-council-vote');

  const member = (await findOrCreateStaff(db, 'editor@admin.test', ['editor@admin.test']))!;
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);

  const parkId = await articleId('fixture-park-opens');
  await page.goto(`${admin}/admin/pins`);
  await page.getByLabel(/Published story/).selectOption(parkId);
  await page.getByLabel('For how many hours').fill('2');
  await page.getByLabel(/Reason/).fill('e2e pin');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page).toHaveURL(`${admin}/admin/pins?done=pinned`);
  await expect(page.getByTestId('active-pins')).toContainText('Fictional park reopens');

  await page.goto(`${feed}/`);
  expect((await fixtureOrder(page))[0]).toBe('/news/fixture-park-opens');

  // Unpin: the normal order returns.
  await page.goto(`${admin}/admin/pins`);
  await page
    .getByTestId('active-pins')
    .getByRole('row', { name: /Fictional park reopens/ })
    .getByRole('button', { name: 'Unpin' })
    .click();
  await expect(page).toHaveURL(`${admin}/admin/pins?done=unpinned`);
  await page.goto(`${feed}/`);
  expect((await fixtureOrder(page))[0]).toBe('/news/fixture-council-vote');
  const open = await db.select().from(pins).where(eq(pins.articleId, parkId));
  expect(open.every((p) => p.expiresAt <= new Date())).toBe(true);
});
