import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import { launchSteps } from '@towncore/config';
import {
  adminActions,
  createDb,
  eq,
  hashToken,
  launchStepRecords,
  launches,
  mailDomains,
  staff,
  staffSessions,
  townCandidates,
  towns,
} from '@towncore/db';

// Admin → Launches (M7 PR A, CLAUDE.md §10a): ranked towns wait for an admin's approval. The
// candidates are fictional (state "ZZ"), inserted as `pnpm towns:rank` would save them.
const admin = 'http://admin.test';
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
// One group per project: the fixtures are set up once, and the client is closed after both tests.
test.describe.configure({ mode: 'serial' });

const figures = (population2025: number) => ({
  population2025,
  growthPct: 4.2,
  households: 20000,
  medianIncome: 81000,
  businessValue: 410,
  nearestTown: { name: 'Sample Town', miles: 12 },
});

test.beforeAll(async ({ browserName: _browser }, info) => {
  // Both tests run on desktop only; another project's setup would delete their fixtures mid-run.
  if (info.project.name !== 'desktop') return;
  for (const run of await db.select().from(launches).where(eq(launches.state, 'ZZ')))
    await db.delete(launchStepRecords).where(eq(launchStepRecords.launchId, run.id));
  await db.delete(launches).where(eq(launches.state, 'ZZ'));
  await db.delete(mailDomains).where(eq(mailDomains.name, 'testcove.test'));
  await db.delete(towns).where(eq(towns.slug, 'testcove-zz'));
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
// Workers are shared across projects: only the desktop project, which owns the fixtures, closes
// the client (the other project's hooks would end it before the desktop tests run).
test.afterAll(async ({ browserName: _browser }, info) => {
  if (info.project.name === 'desktop') await db.$client.end();
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

test('a ready launch goes live only when every check passes; an admin can pause it', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: the launch is shared state');
  // A fictional finished launch (M7 PR F), as `pnpm launch` leaves it: a draft town, every step
  // done, a passing report and a bought domain. Its mail domain isn't live yet.
  const [candidate] = await db
    .select()
    .from(townCandidates)
    .where(eq(townCandidates.geoid, '9900002'));
  const [town] = await db
    .insert(towns)
    .values({
      slug: 'testcove-zz',
      name: 'Testcove',
      state: 'ZZ',
      censusId: '9900002',
      county: 'Sample',
      timezone: 'America/New_York',
      domain: 'testcove.test',
      siteName: 'Testcove Square',
      tier: 'small',
      readinessScore: 3.4,
      config: { slug: 'testcove-zz', sources: [] },
    })
    .returning();
  const [run] = await db
    .insert(launches)
    .values({
      candidateId: candidate!.id,
      geoid: '9900002',
      slug: 'testcove-zz',
      name: 'Testcove',
      state: 'ZZ',
      status: 'ready',
      dryRun: false,
    })
    .returning();
  const detail = (step: string) =>
    step === 'names'
      ? {
          picked: { siteName: 'Testcove Square', domain: 'testcove.test' },
          purchase: { orderId: 'ord_1', status: 'completed', price: 11.25 },
        }
      : step === 'mail'
        ? {
            domain: 'testcove.test',
            state: 'not started',
            detail: 'needs VERCEL_DNS_TOKEN and AWS credentials',
            startBy: '2026-11-10',
          }
        : step === 'report'
          ? {
              passed: true,
              report: 'docs/launches/testcove-zz/launch-report.md',
              checks: [{ name: 'Readiness (Rule 7)', status: 'pass', detail: '3.4 a day' }],
              manual: [],
              aiCostUsd: 0,
            }
          : {};
  await db.insert(launchStepRecords).values(
    launchSteps.map((step) => ({
      launchId: run!.id,
      step,
      status: 'done' as const,
      detail: detail(step),
    })),
  );

  // A reviewer sees the run but can't take it live.
  await signIn(context, 'reviewer', 'golive-reviewer');
  await page.goto(`${admin}/admin/launches`);
  const row = page.locator('[data-launch="testcove-zz"]');
  await expect(row).toContainText('ready');
  await expect(row).toContainText('All checks pass');
  await expect(row.getByRole('button')).toHaveCount(0);

  // An admin sees what still blocks it: the mail domain (Rule 10).
  await context.clearCookies();
  const me = await signIn(context, 'admin', 'golive-admin');
  await page.goto(`${admin}/admin/launches`);
  await expect(row.getByTestId('go-live-blockers')).toContainText(
    'The mail domain testcove.test is not onboarded, not live',
  );
  await expect(row.getByRole('button', { name: /Approve launch/ })).toHaveCount(0);
  // Step 2b's record shows until the mail domain exists (warm-up starts at purchase).
  await expect(row.getByTestId('mail-warmup')).toContainText('not started');
  await expect(row.getByTestId('mail-warmup')).toContainText('Onboard by 2026-11-10');

  await db.insert(mailDomains).values({
    name: 'testcove.test',
    townId: town!.id,
    displayName: 'Testcove Square',
    isTest: true,
    status: 'live',
    bulkStatus: 'warming',
    warmupDay: 3,
    bulkDailyCap: 50,
  });
  await page.reload();
  await expect(row.getByTestId('mail-warmup')).toContainText('Warming: day 3, 50 a day');
  await row.getByRole('button', { name: 'Approve launch: take Testcove Square live' }).click();
  await expect(page.getByRole('status')).toHaveText('Testcove Square is live');
  const [live] = await db.select().from(towns).where(eq(towns.slug, 'testcove-zz'));
  expect(live!.status).toBe('live');
  const [approved] = await db.select().from(launches).where(eq(launches.id, run!.id));
  expect(approved!.status).toBe('approved');
  const [cand] = await db.select().from(townCandidates).where(eq(townCandidates.id, candidate!.id));
  expect(cand!.status).toBe('live');

  await row.getByRole('button', { name: 'Pause Testcove Square' }).click();
  await expect(page.getByRole('status')).toHaveText('Testcove Square paused');
  const [paused] = await db.select().from(towns).where(eq(towns.slug, 'testcove-zz'));
  expect(paused!.status).toBe('paused');
  const audit = await db.select().from(adminActions).where(eq(adminActions.staffId, me.id));
  expect(audit.map((a) => a.action)).toEqual(['launch.approve', 'town.pause']);
});
