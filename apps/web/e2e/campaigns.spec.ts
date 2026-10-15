import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  adminActions,
  createDb,
  emailCampaigns,
  eq,
  getTownBySlug,
  hashToken,
  mailDomains,
  staff,
  staffSessions,
  subscribers,
  type Db,
} from '@towncore/db';

// Newsletter admin (Mail-5): campaigns need an admin's approval; subscribers can be searched,
// exported and unsubscribed; the daily newsletter needs a standing approval per domain.
// Sending uses MAIL_TRANSPORT=log, so nothing leaves the machine.

const admin = 'http://admin.test';
let db: Db;
let townId: string;
let domainId: string;

test.beforeAll(async () => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
  townId = (await getTownBySlug(db, 'letter-town'))!.id;
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
  domainId = (
    await db.select().from(mailDomains).where(eq(mailDomains.name, 'lettertown.test'))
  )[0]!.id;
});
test.afterAll(async () => {
  await db.$client.end();
});

async function signIn(context: BrowserContext, tag: string, role: 'admin' | 'reviewer') {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Staff ${tag}`, role })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
  return member!;
}

test('a reviewer drafts, an admin approves; preview and test send work', async ({
  page,
  context,
  browser,
}, info) => {
  const subject = `Street fair ${info.project.name} ${Date.now()}`;
  await signIn(context, `writer-${info.project.name}`, 'reviewer');
  await page.goto(`${admin}/admin/mail/campaigns`);
  await page.getByLabel('Town').selectOption(domainId);
  await page.getByLabel('Subject').first().fill(subject);
  await page.getByLabel('Message').first().fill('**Saturday** on Main Street in {{town_name}}.');
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
  await expect(page.getByTestId('campaign-meta')).toContainText('draft');
  await expect(page.getByText('An admin approves the send.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve send' })).toHaveCount(0);
  const frame = page.frameLocator('[data-testid="campaign-preview"]');
  await expect(frame.locator('strong')).toHaveText('Saturday');
  await expect(frame.locator('body')).toContainText('in Letter Town.');
  await page.getByRole('button', { name: 'Send a test to me' }).click();
  await expect(page.getByRole('status')).toContainText('Test sent to you');

  const adminContext = await browser.newContext({ baseURL: admin, ...info.project.use });
  await signIn(adminContext, `approver-${info.project.name}`, 'admin');
  const adminPage = await adminContext.newPage();
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.subject, subject));
  await adminPage.goto(`${admin}/admin/mail/campaigns/${c!.id}`);
  await adminPage.getByRole('button', { name: 'Approve send' }).click();
  await expect(adminPage.getByRole('status')).toContainText('Approved and scheduled');
  await expect(adminPage.getByTestId('campaign-meta')).toContainText(/scheduled|sending|sent/);
  await adminPage
    .getByRole('button', { name: /Pause|Cancel campaign/ })
    .first()
    .click();
  const audit = await db.select().from(adminActions).where(eq(adminActions.targetId, c!.id));
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining(['campaign_create', 'campaign_test_send', 'campaign_approve']),
  );
  await adminContext.close();
});

test('subscribers: search, export and manual unsubscribe', async ({ page, context }, info) => {
  await signIn(context, `subs-${info.project.name}`, 'reviewer');
  const email = `listed-${info.project.name}-${Date.now()}@example.com`;
  await db.insert(subscribers).values({
    townId,
    email,
    status: 'active',
    confirmedAt: new Date(),
    consentSource: 'https://lettertown.test/',
  });
  await page.goto(
    `${admin}/admin/mail/subscribers?town=letter-town&q=${encodeURIComponent(email)}`,
  );
  const table = page.getByTestId('subscribers');
  await expect(table).toContainText(email);
  await expect(table).toContainText('https://lettertown.test/');

  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
  const text = await page.evaluate(async (url) => (await fetch(url!)).text(), href);
  expect(text.split('\r\n')[0]).toBe(
    'email,status,source,consent_source,consent_ip,consent_at,confirmed_at,unsubscribed_at',
  );
  expect(text).toContain(`"${email}","active"`);

  await table.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('status')).toContainText(`Unsubscribed ${email}`);
  const [row] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  expect(row!.status).toBe('unsubscribed');
});

test('the daily newsletter approval is an admin switch on the domain page', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one project changes the shared domain');
  await signIn(context, `approve-${info.project.name}`, 'admin');
  await page.goto(`${admin}/admin/mail/domains/lettertown.test`);
  await expect(page.getByTestId('bulk-status')).toContainText('warming · cap 50 a day');
  await page.getByRole('button', { name: 'Approve the daily newsletter' }).click();
  await expect(page.getByText(/Daily newsletter: approved/)).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw the daily newsletter approval' }).click();
  await expect(page.getByText(/Daily newsletter: not approved/)).toBeVisible();
});
