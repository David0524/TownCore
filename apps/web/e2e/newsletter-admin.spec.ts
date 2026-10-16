import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  adminActions,
  and,
  createDb,
  eq,
  getTownBySlug,
  hashToken,
  mailDomains,
  newsletterIssues,
  newsletterTesters,
  staff,
  staffSessions,
  type Db,
} from '@towncore/db';

// Admin → Newsletter (M5): the test list, a preview and test send of the next issue, and the
// off → test → live switch that needs 3 test issues first (D-M5-2). The daily send itself is
// the worker's job and is covered by packages/email and worker tests.

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

test('test list, preview and a test send of the next issue', async ({ page, context }, info) => {
  const me = await signIn(context, `nl-${info.project.name}`, 'reviewer');
  await page.goto(`${admin}/admin/newsletter`);
  await page.getByRole('link', { name: 'The Letter Town Post' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Letter Town Post');
  await expect(page.getByTestId('next-subject')).toContainText(/^\w+day: /);
  await expect(page.frameLocator('[data-testid="next-preview"]').locator('body')).toContainText(
    'The Letter Town Post Newsroom',
  );
  await expect(page.getByText('An admin changes the mode.')).toBeVisible();

  const row = page.getByTestId('test-list').locator('li', { hasText: me.email });
  await row.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status')).toContainText('Added to the test list');
  const rows = await db
    .select()
    .from(newsletterTesters)
    .where(and(eq(newsletterTesters.domainId, domainId), eq(newsletterTesters.staffId, me.id)));
  expect(rows).toHaveLength(1);

  await page.getByRole('button', { name: 'Send a test to me' }).click();
  await expect(page.getByRole('status')).toContainText('Test sent to you');
});

test('going live needs an admin and 3 test issues', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'one project changes the shared domain');
  // Start from a clean slate so reruns behave the same.
  await db.delete(newsletterIssues).where(eq(newsletterIssues.townId, townId));
  await db
    .update(mailDomains)
    .set({ newsletterMode: 'off', newsletterApprovedAt: null, newsletterApprovedBy: null })
    .where(eq(mailDomains.id, domainId));
  await signIn(context, `nl-admin-${info.project.name}`, 'admin');
  await page.goto(`${admin}/admin/newsletter/letter-town`);
  await page.getByRole('button', { name: 'Send to the test list' }).click();
  await expect(page.getByTestId('newsletter-mode')).toContainText('Mode: test');

  await page.getByRole('button', { name: 'Go live: send to every subscriber' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Send at least 3 test issues first',
  );

  // Three test issues went out (the worker's job; recorded here directly).
  for (const date of ['2026-01-01', '2026-01-02', '2026-01-03'])
    await db
      .insert(newsletterIssues)
      .values({
        townId,
        date,
        mode: 'test',
        subject: `[Test] Issue ${date}`,
        html: '<p>Hi</p>',
        text: 'Hi',
        sentAt: new Date(),
      })
      .onConflictDoNothing();
  await page.reload();
  await expect(page.getByTestId('past-issues')).toContainText('[Test] Issue 2026-01-03');
  await page.getByRole('button', { name: 'Go live: send to every subscriber' }).click();
  await expect(page.getByTestId('newsletter-mode')).toContainText('Mode: live');
  const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
  expect(d!.newsletterApprovedAt).not.toBeNull();
  const audit = await db
    .select()
    .from(adminActions)
    .where(eq(adminActions.action, 'newsletter_mode'));
  expect(audit.map((a) => (a.detail as { to: string }).to)).toEqual(
    expect.arrayContaining(['test', 'live']),
  );

  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByTestId('newsletter-mode')).toContainText('Mode: off');
});
