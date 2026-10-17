import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import { createDb, hashToken, staff, staffSessions, type Db } from '@towncore/db';

// Admin → Health (M8, CLAUDE.md §12): every town's operations at a glance, open alerts first.
// Read-only: Mail health's spec owns the alert rows.

const admin = 'http://admin.test';
let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
});
test.afterAll(async () => {
  await db.$client.end();
});

test('staff see every town with its numbers, and the open alerts', async ({ page, context }) => {
  const [member] = await db
    .insert(staff)
    .values({
      email: `health-${Date.now()}-${Math.random().toString(36).slice(2)}@towncore.net`,
      name: 'Ops viewer',
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

  await page.goto(`${admin}/admin/health`);
  await expect(page.getByRole('heading', { name: 'Health', level: 1 })).toBeVisible();
  await expect(page.getByTestId('open-alerts')).toBeVisible();
  const table = page.getByTestId('town-health');
  for (const header of [
    'Items a day',
    'Fact-check pass',
    'Review queue',
    'Sources',
    'AI per story',
    'Paying businesses',
  ])
    await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
  const boca = table.locator('[data-town="Boca Town Square"]');
  await expect(boca).toBeVisible();
  await expect(boca).toContainText('of $5.00');
  // Stories against the Rule 7 target, with the sources to build next.
  const coverage = page.getByTestId('story-coverage');
  for (const header of ['A day', 'Target', 'Gap', 'Sources to build next'])
    await expect(coverage.getByRole('columnheader', { name: header })).toBeVisible();
  await expect(coverage.locator('[data-town="Boca Town Square"]')).toContainText('10');
  await expect(page.getByRole('link', { name: 'Health', exact: true })).toBeVisible();
});
