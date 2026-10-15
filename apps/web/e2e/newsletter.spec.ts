import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  and,
  createDb,
  eq,
  getTownBySlug,
  mailDomains,
  sql,
  subscribers,
  suppressions,
  type Db,
} from '@towncore/db';
// Only the token module: the package entry pulls in modules the test runner can't load.
import { confirmToken, unsubscribeToken } from '../../../packages/mail/src/bulk/tokens';
import { E2E_MAIL_TOKEN_SECRET } from './newsletter-secret';

// Newsletter signup on a town site (Mail-5): double opt-in, confirm by button, unsubscribe from
// the footer page and by RFC 8058 one-click POST. Sending goes to the server log (Rule 10).

const site = 'http://lettertown.test';
// API requests don't go through the browser's host mapping: hit the server with the Host header.
const direct = 'http://127.0.0.1:3100';
const host = { host: 'lettertown.test' };
let db: Db;
let townId: string;

test.beforeAll(async () => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
  const town = await getTownBySlug(db, 'letter-town');
  townId = town!.id;
  await db
    .insert(mailDomains)
    .values({
      name: 'lettertown.test',
      townId,
      displayName: 'The Letter Town Post',
      isTest: true,
      status: 'live',
      bulkStatus: 'warming',
      bulkDailyCap: 50,
    })
    .onConflictDoNothing();
});
test.afterAll(async () => {
  await db.$client.end();
});

const subscriber = async (email: string) =>
  (
    await db
      .select()
      .from(subscribers)
      .where(and(eq(subscribers.townId, townId), sql`lower(${subscribers.email}) = ${email}`))
  )[0];

test('sign up, confirm by button, unsubscribe from the footer page', async ({ page }, info) => {
  const email = `reader-${info.project.name}-${Date.now()}@example.com`;
  await page.goto(`${site}/`);
  const cta = page.locator('[data-module="newsletter-cta"]').first();
  await cta.getByLabel('Email address').fill(email);
  await cta.getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByRole('status')).toContainText('Check your inbox');
  const pending = await subscriber(email);
  expect(pending).toMatchObject({ status: 'pending', consentSource: 'https://lettertown.test/' });
  expect(pending!.confirmSentAt).not.toBeNull();

  // Opening the link confirms nothing; the button does.
  const token = confirmToken(E2E_MAIL_TOKEN_SECRET, pending!.id, new Date(Date.now() + 3_600_000));
  await page.goto(`${site}/newsletter/confirm?t=${encodeURIComponent(token)}`);
  expect((await subscriber(email))!.status).toBe('pending');
  await page.getByRole('button', { name: 'Confirm my subscription' }).click();
  await expect(page.getByRole('status')).toContainText('You’re subscribed');
  expect((await subscriber(email))!.status).toBe('active');

  await page.goto(`${site}/u/${unsubscribeToken(E2E_MAIL_TOKEN_SECRET, pending!.id)}`);
  await expect(page.getByRole('main')).toContainText(email);
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('status')).toContainText(`${email} is unsubscribed`);
  expect((await subscriber(email))!.status).toBe('unsubscribed');
  const [supp] = await db.select().from(suppressions).where(eq(suppressions.email, email));
  expect(supp).toMatchObject({ reason: 'unsubscribe', scope: 'domain' });
  await expect(page.getByRole('button', { name: 'Subscribe again' })).toBeVisible();
});

test('one-click unsubscribe (RFC 8058) works with a bare POST and no login', async ({
  request,
}, info) => {
  const email = `oneclick-${info.project.name}-${Date.now()}@example.com`;
  const [sub] = await db
    .insert(subscribers)
    .values({ townId, email, status: 'active', confirmedAt: new Date() })
    .returning();
  const token = unsubscribeToken(E2E_MAIL_TOKEN_SECRET, sub!.id);
  const res = await request.post(`${direct}/api/newsletter/unsubscribe/${token}`, {
    headers: host,
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Unsubscribed from The Letter Town Post');
  expect((await subscriber(email))!.status).toBe('unsubscribed');
  const bad = await request.post(`${direct}/api/newsletter/unsubscribe/${token.slice(0, -2)}xx`, {
    headers: host,
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(bad.status()).toBe(404);
});

test('the honeypot drops bots and a bad address is explained', async ({ request, page }, info) => {
  const bot = `bot-${info.project.name}-${Date.now()}@example.com`;
  const res = await request.post(`${direct}/newsletter/subscribe`, {
    headers: host,
    form: { email: bot, website: 'http://spam.example', source: '/' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toBe('/newsletter?s=ok#signup');
  expect(await subscriber(bot)).toBeUndefined();

  await page.goto(`${site}/newsletter`);
  await page.getByLabel('Email address').fill('not-an-address@');
  await page.evaluate(() =>
    document.querySelector('form[data-testid="newsletter-form"]')?.setAttribute('novalidate', ''),
  );
  await page.getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('doesn’t look right');
});

test('a town without bulk mail keeps "launching soon" and no email field', async ({ page }) => {
  await page.goto('http://bocatownsquare.com/');
  const cta = page.locator('[data-module="newsletter-cta"]').first();
  await expect(cta).toContainText('launching soon');
  await expect(cta.getByLabel('Email address')).toHaveCount(0);
});
