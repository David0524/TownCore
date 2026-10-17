import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  and,
  createDb,
  eq,
  getTownBySlug,
  hashToken,
  mailDomains,
  referralStatsDaily,
  sql,
  staff,
  staffSessions,
  subscribers,
  type Db,
} from '@towncore/db';

// Audience (owner, 2026-10-17): sign-ups counted by prompt placement, the email offer on a
// reader's second story (sessionStorage only: no cookie, nothing sent), views counted by
// referral class, and the numbers on Admin → Health. On both fictional families, so nothing is
// Boca-only (§14). Sending goes to the server log (Rule 10).

const TOWNS = [
  { slug: 'harbor-point', host: 'harborpoint.test', prefix: 'harbor' },
  { slug: 'pine-hollow', host: 'pinehollow.test', prefix: 'pine' },
] as const;

let db: Db;
const ids = new Map<string, string>();

test.beforeAll(async () => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
  for (const t of TOWNS) {
    const town = await getTownBySlug(db, t.slug);
    ids.set(t.slug, town!.id);
    // The towns take sign-ups once a mail domain can send bulk mail.
    await db
      .insert(mailDomains)
      .values({
        name: t.host,
        townId: town!.id,
        displayName: town!.siteName,
        isTest: true,
        status: 'live',
        bulkStatus: 'warming',
        bulkDailyCap: 50,
      })
      .onConflictDoNothing();
  }
});
test.afterAll(async () => {
  await db.$client.end();
});

const subscriber = async (townId: string, email: string) =>
  (
    await db
      .select()
      .from(subscribers)
      .where(and(eq(subscribers.townId, townId), sql`lower(${subscribers.email}) = ${email}`))
  )[0];

for (const t of TOWNS) {
  test(`${t.slug}: the email offer shows on the second story, and sign-ups record their prompt`, async ({
    page,
  }, info) => {
    const site = `http://${t.host}`;
    const townId = ids.get(t.slug)!;
    await page.setExtraHTTPHeaders({
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    });

    // First story: no offer; the end-of-story box is the "article" prompt.
    await page.goto(`${site}/news/test-${t.prefix}-government`);
    const offer = page.getByTestId('second-article-offer');
    await expect(offer).toBeHidden();
    const end = page.locator('article [data-module="newsletter-cta"]');
    await expect(end.locator('input[name="placement"]')).toHaveValue('article');

    // Second story: the offer appears, from this tab's sessionStorage alone.
    await page.goto(`${site}/news/test-${t.prefix}-schools`);
    await expect(offer).toBeVisible();
    await expect(offer.getByRole('heading')).toHaveText('Get stories like this every morning');
    expect(
      await page.evaluate(() => ({
        cookies: document.cookie,
        read: JSON.parse(sessionStorage.getItem('tc-read') ?? '[]').length,
      })),
    ).toEqual({ cookies: '', read: 2 });
    // Going back to the first story doesn't offer it twice.
    await page.goto(`${site}/news/test-${t.prefix}-government`);
    await expect(offer).toBeHidden();
    await page.goBack();
    await expect(offer).toBeVisible();

    const email = `offer-${t.prefix}-${info.project.name}-${Date.now()}@example.com`;
    await offer.getByLabel('Email address').fill(email);
    await offer.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByRole('status')).toContainText('Check your inbox');
    expect(await subscriber(townId, email)).toMatchObject({
      status: 'pending',
      source: 'signup_form:second-article',
    });
  });

  test(`${t.slug}: a story view counts its referral class, not the referrer`, async ({ page }) => {
    const townId = ids.get(t.slug)!;
    const count = async () =>
      (
        await db
          .select({ n: sql<number>`coalesce(sum(${referralStatsDaily.views}), 0)::int` })
          .from(referralStatsDaily)
          .where(
            and(eq(referralStatsDaily.townId, townId), eq(referralStatsDaily.source, 'newsletter')),
          )
      )[0]!.n;
    const before = await count();
    const sent: string[] = [];
    await page.route('**/b', async (route) => {
      sent.push(route.request().postDataBuffer()?.toString('utf8') ?? '');
      await route.continue();
    });
    await page.goto(`http://${t.host}/news/test-${t.prefix}-schools?ref=newsletter`);
    await expect.poll(count).toBeGreaterThan(before);
    // The beacon carries the class only: no referrer, no address.
    const views = sent.filter(Boolean).map((b) => JSON.parse(b) as { k: string });
    expect(views.find((b) => b.k === 'view')).toEqual({
      k: 'view',
      s: [`test-${t.prefix}-schools`],
      r: 'newsletter',
    });
  });
}

test('Admin → Health shows the funnel per town, cohort and platform, and the experiments', async ({
  page,
  context,
}) => {
  const [member] = await db
    .insert(staff)
    .values({
      email: `audience-${Date.now()}-${Math.random().toString(36).slice(2)}@towncore.net`,
      name: 'Growth admin',
      role: 'admin',
    })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: 'http://admin.test/admin' }]);

  await page.goto('http://admin.test/admin/health');
  const audience = page.getByTestId('audience');
  await expect(audience.getByRole('heading', { name: 'Audience and revenue' })).toBeVisible();
  const towns = page.getByTestId('audience-towns');
  for (const header of [
    'Subscribers per 1,000 households',
    'Sign-ups by prompt',
    'Story views by source',
    'Claim rate',
    'Trial to paid',
    'Revenue a month per town',
  ])
    await expect(towns.getByRole('columnheader', { name: header })).toBeVisible();
  for (const name of ['The Harbor Point Ledger', 'Pine Hollow Daily'])
    await expect(towns.locator(`[data-town="${name}"]`)).toContainText(/cohort|not live/);
  await expect(page.getByTestId('audience-cohorts')).toBeVisible();
  await expect(page.getByTestId('audience-platforms')).toBeVisible();
  await expect(page.getByTestId('audience-states')).toBeVisible();
  await expect(audience).toContainText('Return visits aren’t counted');

  const experiments = page.getByTestId('experiments');
  for (const key of [
    'signup-prompt',
    'second-article-offer',
    'module-order',
    'house-ad-copy',
    'proof-report-wording',
  ]) {
    const row = experiments.locator(`[data-experiment="${key}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: /Start|Roll out winner/ })).toBeVisible();
  }
});
