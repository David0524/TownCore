import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  and,
  createDb,
  eq,
  hashToken,
  pageStatsDaily,
  siteChecks,
  staff,
  staffSessions,
  sql,
  towns,
  type Db,
} from '@towncore/db';

// Admin → Analytics (owner, 2026-10-17): the cookieless page and time-on-page beacon, the site's
// health endpoint, and the dashboard's light, age and numbers.

const admin = 'http://admin.test';
const boca = 'http://bocatownsquare.com';
let db: Db;
let bocaId: string;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
  const [town] = await db.select({ id: towns.id }).from(towns).where(eq(towns.slug, 'boca-raton'));
  bocaId = town!.id;
});
test.afterAll(async () => {
  await db.delete(siteChecks).where(eq(siteChecks.townId, bocaId));
  await db.$client.end();
});

const homeStats = async () => {
  const [row] = await db
    .select({
      views: sql<number>`coalesce(sum(${pageStatsDaily.views}), 0)::int`,
      samples: sql<number>`coalesce(sum(${pageStatsDaily.engagedSamples}), 0)::int`,
    })
    .from(pageStatsDaily)
    .where(and(eq(pageStatsDaily.townId, bocaId), eq(pageStatsDaily.kind, 'home')));
  return row!;
};

test('town pages report a view and the time they stayed visible, and nothing else', async ({
  page,
}) => {
  const before = await homeStats();
  await page.goto(`${boca}/`);
  await expect.poll(async () => (await homeStats()).views).toBeGreaterThan(before.views);
  // Leaving the page reports the seconds it was visible. Posted from the page itself: test
  // hostnames resolve to the local server only inside the browser.
  const post = (body: string) =>
    page.evaluate((b) => fetch('/b', { method: 'POST', body: b }).then((r) => r.status), body);
  expect(await post(JSON.stringify({ k: 'time', p: 'home', t: 42 }))).toBe(204);
  await expect.poll(async () => (await homeStats()).samples).toBeGreaterThan(before.samples);
  // Unknown kinds and missing times are refused.
  expect(await post('{"k":"page","p":"x"}')).toBe(400);
  expect(await post('{"k":"time","p":"home"}')).toBe(400);
});

test('the health endpoint names the town it serves', async ({ page }) => {
  const res = await page.goto(`${boca}/api/health`);
  expect(res!.status()).toBe(200);
  expect(res!.headers()['cache-control']).toContain('no-store');
  expect(await res!.json()).toMatchObject({ ok: true, town: 'boca-raton' });
});

test('staff see every site with its light, age and numbers, and one site in depth', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'Admin pages are desktop tools.');
  const [member] = await db
    .insert(staff)
    .values({
      email: `analytics-${Date.now()}-${Math.random().toString(36).slice(2)}@towncore.net`,
      name: 'Numbers viewer',
      role: 'reviewer',
    })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);

  await db.delete(siteChecks).where(eq(siteChecks.townId, bocaId));
  await page.goto(`${admin}/admin/analytics`);
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  const tiles = page.getByTestId('analytics-tiles');
  for (const label of [
    'Up right now',
    'Avg time on page',
    'Newsletter subscribers',
    'Advertisers',
    'Monthly revenue',
  ])
    await expect(tiles).toContainText(label);
  const row = page.getByTestId('analytics-sites').locator('[data-site="boca-raton"]');
  await expect(row).toContainText('Not checked');
  await expect(row).toContainText(/Draft|Live|Set up today/);

  // Two failed checks in a row: down, with the reason on hover.
  await db.insert(siteChecks).values([
    {
      townId: bocaId,
      url: 'https://bocatownsquare.com/api/health',
      ok: false,
      statusCode: 502,
      ms: 120,
      error: 'HTTP 502',
      checkedAt: new Date(Date.now() - 6 * 60_000),
    },
    {
      townId: bocaId,
      url: 'https://bocatownsquare.com/api/health',
      ok: false,
      statusCode: 502,
      ms: 110,
      error: 'HTTP 502',
      checkedAt: new Date(Date.now() - 60_000),
    },
  ]);
  await page.reload();
  await expect(row).toContainText('Down');
  await expect(row.locator('[data-light="down"]')).toHaveAttribute('title', /2 failed checks/);

  await row.getByRole('link', { name: 'Boca Town Square' }).click();
  await expect(page.getByRole('heading', { name: 'Boca Town Square', level: 1 })).toBeVisible();
  await expect(page.getByTestId('site-status')).toContainText('Down');
  await expect(page.getByTestId('site-checks')).toContainText('Failed: HTTP 502');
  for (const heading of ['Readers', 'Newsletter', 'Advertisers and money', 'Recent checks'])
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  await expect(page.getByRole('figure').first()).toContainText('Page views');

  // A good answer: up again.
  await db.insert(siteChecks).values({
    townId: bocaId,
    url: 'https://bocatownsquare.com/api/health',
    ok: true,
    statusCode: 200,
    ms: 90,
    checkedAt: new Date(),
  });
  await page.reload();
  await expect(page.getByTestId('site-status')).toContainText('Up');

  // Check now: a draft without a preview address isn't checked, and the page says why.
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toContainText('Nothing to check');
});
