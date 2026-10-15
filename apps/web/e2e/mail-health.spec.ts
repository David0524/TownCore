import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import { createDb, eq, hashToken, mailAlerts, staff, staffSessions, type Db } from '@towncore/db';

// Admin → Mail health (Mail-6): one page answers "is anything on fire?".

const admin = 'http://admin.test';
let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
});
test.afterAll(async () => {
  await db.$client.end();
});

async function signIn(context: BrowserContext, tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Ops ${tag}`, role: 'reviewer' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
}

test('open alerts come first; the account, domains and pipeline follow', async ({
  page,
  context,
}, info) => {
  await signIn(context, `health-${info.project.name}`);
  const key = `e2e:${info.project.name}:${Date.now()}`;
  await db.insert(mailAlerts).values({
    key,
    severity: 'critical',
    message: `Bulk mail paused for e2e-${info.project.name}.test: complaint rate 0.9%`,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  });
  try {
    await page.goto(`${admin}/admin/mail/health`);
    await expect(page.getByRole('heading', { name: 'Is anything on fire?' })).toBeVisible();
    const fire = page.getByTestId('fire');
    await expect(fire).toContainText(`CRITICAL Bulk mail paused for e2e-${info.project.name}.test`);
    await expect(page.getByTestId('account')).toContainText('SES reviews at 5.0%');
    await expect(page.getByTestId('pipeline')).toContainText('Mail events waiting:');
    await expect(page.getByRole('heading', { name: 'DMARC reports (last 30 days)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mail health' })).toBeVisible();
  } finally {
    await db.update(mailAlerts).set({ resolvedAt: new Date() }).where(eq(mailAlerts.key, key));
  }
});
