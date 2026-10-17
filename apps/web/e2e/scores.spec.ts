import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import { createDb, staff, staffSessions } from '@towncore/db';

// Reader scores (owner, 2026-10-17): a reader sends a final score from the Sports tab; nothing
// shows until staff approve it; then it's a result marked as sent by a reader.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const pine = 'http://pinehollow.test';
const admin = 'http://admin.test';

async function staffPage(browser: Browser) {
  const [member] = await db
    .insert(staff)
    .values({ email: `scores-${Date.now()}@towncore.net`, name: 'Score editor', role: 'reviewer' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
  return { context, page: await context.newPage(), id: member!.id };
}

test('a reader sends a score; it shows on the Sports tab only after approval', async ({
  page,
  browser,
}, info) => {
  const home = `Pine Hollow ${info.project.name} ${Date.now() % 100000}`;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${Date.now() % 250}` });
  await page.goto(`${pine}/sports`);
  const form = page.getByTestId('score-form');
  await form.getByLabel('Sport').selectOption('Boys Soccer');
  await form.getByLabel('Home team').fill(home);
  await form.getByLabel('Home score').fill('3');
  await form.getByLabel('Visiting team').fill('Maple Ridge');
  await form.getByLabel('Visiting score').fill('1');
  await form.getByLabel('Date played').fill(yesterday);
  await form.getByLabel('Your name').fill('Sam Reader');
  await form.getByLabel('Your email (never shown)').fill(`sam-${info.project.name}@reader.test`);
  await form.getByRole('button', { name: 'Send score' }).click();
  await expect(page.getByTestId('score-message')).toContainText('An editor checks every score');
  await expect(page.getByText(`${home} 3, Maple Ridge 1`)).toHaveCount(0);

  const { context, page: adminPage } = await staffPage(browser);
  await adminPage.goto(`${admin}/admin/scores`);
  const card = adminPage.getByTestId('pending-score').filter({ hasText: home });
  await expect(card).toContainText('Boys Soccer');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByRole('status')).toHaveText('Score approved.');
  await context.close();

  await page.goto(`${pine}/sports`);
  const results = page.getByTestId('sports-results');
  await expect(results).toContainText(`${home} 3, Maple Ridge 1`);
  await expect(results).toContainText('Score sent by a reader');
});

test('a score from the future or with a missing team is refused', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${Date.now() % 250}` });
  await page.goto(`${pine}/sports`);
  const form = page.getByTestId('score-form');
  await form.getByLabel('Sport').selectOption('Football');
  await form.getByLabel('Home team').fill('Pine Hollow');
  await form.getByLabel('Home score').fill('7');
  await form.getByLabel('Visiting team').fill('Pine Hollow');
  await form.getByLabel('Visiting score').fill('0');
  await form.getByLabel('Date played').fill(new Date().toISOString().slice(0, 10));
  await form.getByLabel('Your name').fill('Sam');
  await form.getByLabel('Your email (never shown)').fill(`x-${info.project.name}@reader.test`);
  await form.getByRole('button', { name: 'Send score' }).click();
  await expect(page.getByTestId('score-message')).toHaveText(
    'Enter both teams, and two different ones.',
  );
});
