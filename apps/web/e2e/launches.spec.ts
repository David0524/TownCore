import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  adminActions,
  createDb,
  eq,
  hashToken,
  staff,
  staffSessions,
  townCandidates,
} from '@towncore/db';

// Admin → Launches (M7 PR A, CLAUDE.md §10a): ranked towns wait for an admin's approval. The
// candidates are fictional (state "ZZ"), inserted as `pnpm towns:rank` would save them.
const admin = 'http://admin.test';
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });

const figures = (population2025: number) => ({
  population2025,
  growthPct: 4.2,
  households: 20000,
  medianIncome: 81000,
  businessValue: 410,
  nearestTown: { name: 'Sample Town', miles: 12 },
});

test.beforeAll(async () => {
  await db.delete(townCandidates).where(eq(townCandidates.state, 'ZZ'));
  await db.insert(townCandidates).values(
    [
      ['9900001', 'Firstville', 0.71, 1],
      ['9900002', 'Secondburg', 0.64, 2],
    ].map(([geoid, name, score, rank]) => ({
      state: 'ZZ',
      geoid: geoid as string,
      name: name as string,
      score: score as number,
      rank: rank as number,
      rankedAt: new Date(),
      inputs: { inputs: {}, figures: figures(50000), weights: {} },
    })),
  );
});
test.afterAll(async () => {
  await db.$client.end();
});

async function signIn(context: BrowserContext, role: 'admin' | 'reviewer', tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `launch-${tag}-${Date.now()}@towncore.net`, name: `Launch ${tag}`, role })
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

test('an admin approves a ranked town; a reviewer can only look', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: candidates are shared state');
  await signIn(context, 'reviewer', 'reviewer');
  await page.goto(`${admin}/admin/launches?state=ZZ`);
  const table = page.getByTestId('candidates');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.locator('tbody tr').first()).toContainText('Firstville, ZZ');
  await expect(page.getByText('Only admins can approve or reject.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Firstville' })).toHaveCount(0);

  await context.clearCookies();
  const me = await signIn(context, 'admin', 'admin');
  await page.goto(`${admin}/admin/launches?state=ZZ`);
  await page.getByLabel('Note for Firstville').fill('Strong business base, no daily paper.');
  await page.getByRole('button', { name: 'Approve Firstville' }).click();
  await expect(page.getByRole('status')).toHaveText('Firstville approved for launch');
  await expect(table.locator('tbody tr').first()).toContainText('approved');
  await expect(table.locator('tbody tr').first()).toContainText(
    'Strong business base, no daily paper.',
  );
  const [row] = await db.select().from(townCandidates).where(eq(townCandidates.geoid, '9900001'));
  expect(row).toMatchObject({ status: 'approved', decidedBy: me.id });
  const audit = await db.select().from(adminActions).where(eq(adminActions.staffId, me.id));
  expect(audit.map((a) => a.action)).toEqual(['launch.candidate.approve']);
});
