import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import { createDb, hashToken, staff, staffSessions, type Db } from '@towncore/db';

// Admin dark mode (owner, 2026-10-18: "add a dark mode like Resend"): System follows the
// computer, the switch changes the page at once and the choice survives a reload.

const admin = 'http://admin.test';
let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
});
test.afterAll(async () => {
  await db.$client.end();
});

test('the theme switch turns the admin dark and remembers it', async ({ page, context }, info) => {
  const [member] = await db
    .insert(staff)
    .values({
      email: `theme-${info.project.name}-${Date.now()}@towncore.net`,
      name: 'Theme',
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

  const shell = page.locator('[data-admin-theme]');
  const background = () => shell.evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${admin}/admin/mail/inbox`);
  await expect(shell).toHaveAttribute('data-admin-theme', 'system');
  const light = await background();

  // System follows the computer.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).not.toBe(light);
  await page.emulateMedia({ colorScheme: 'light' });

  const group = page.getByRole('group', { name: 'Theme' });
  await group.getByRole('button', { name: 'Dark' }).click();
  await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(shell).toHaveAttribute('data-admin-theme', 'dark');
  const dark = await background();
  expect(dark).not.toBe(light);

  await page.reload();
  await expect(shell).toHaveAttribute('data-admin-theme', 'dark');
  expect(await background()).toBe(dark);

  await group.getByRole('button', { name: 'Light' }).click();
  await expect(shell).toHaveAttribute('data-admin-theme', 'light');
  expect(await background()).toBe(light);
});
