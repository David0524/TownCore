import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { launchSteps, loadEnv } from '@towncore/config';
import {
  adapterFixRequests,
  adminActions,
  createDb,
  eq,
  hashToken,
  inArray,
  launchCohorts,
  launchCohortTowns,
  launches,
  launchStepRecords,
  opsDigests,
  proposals,
  sourceProposals,
  sources,
  staff,
  staffSessions,
  townCandidates,
  towns,
} from '@towncore/db';

// Agentic operations (docs/plans/agentic-ops.md) on the internal admin host: a launch cohort's one
// purchase approval at a typed total, the Proposals inbox, adapter fix requests and the daily
// digest. The worker doesn't run here: its passes are written straight into the database.

const admin = 'http://admin.test';
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browserName: _browser }, info) => {
  if (info.project.name !== 'desktop') return;
  const old = await db.select().from(townCandidates).where(eq(townCandidates.state, 'ZY'));
  if (old.length) {
    const ids = old.map((c) => c.id);
    await db.delete(launchCohortTowns).where(inArray(launchCohortTowns.candidateId, ids));
    for (const l of await db.select().from(launches).where(eq(launches.state, 'ZY')))
      await db.delete(launchStepRecords).where(eq(launchStepRecords.launchId, l.id));
    await db.delete(launches).where(eq(launches.state, 'ZY'));
    await db.delete(townCandidates).where(eq(townCandidates.state, 'ZY'));
  }
  await db.insert(townCandidates).values(
    [
      ['9800001', 'Agentville', 1],
      ['9800002', 'Botburg', 2],
    ].map(([geoid, name, rank]) => ({
      state: 'ZY',
      geoid: geoid as string,
      name: name as string,
      score: 0.5,
      rank: rank as number,
      rankedAt: new Date(),
      status: 'approved' as const,
      // As `pnpm towns:rank` saves them (the candidate table reads these figures).
      inputs: {
        figures: {
          population2025: 12000,
          growthPct: 1.5,
          households: 5000,
          medianIncome: 70000,
          businessValue: 120,
          nearestTown: null,
        },
      },
    })),
  );
});
test.afterAll(async ({ browserName: _browser }, info) => {
  if (info.project.name === 'desktop') await db.$client.end();
});

async function signIn(context: BrowserContext, role: 'admin' | 'reviewer', tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `agentic-${tag}-${Date.now()}@towncore.net`, name: `Agentic ${tag}`, role })
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

test('an admin starts a cohort and approves its domains once, at the typed total', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: cohorts are shared state');
  const me = await signIn(context, 'admin', 'cohort');
  const name = `E2E ${Date.now()}`;
  await page.goto(`${admin}/admin/launches`);
  const form = page.getByTestId('new-cohort');
  await form.getByLabel('Cohort name').fill(name);
  await form.getByLabel('Agentville, ZY (#1)').check();
  await form.getByLabel('Botburg, ZY (#2)').check();
  await form.getByLabel(/Buy domains when approved/).check();
  await form.getByRole('button', { name: 'Start cohort' }).click();
  await expect(page.getByRole('status')).toContainText(`Cohort ${name} started`);
  const card = page.locator(`[data-cohort="${name}"]`);
  await expect(card).toContainText('preparing');

  // The orchestrator's first pass: each launch's step 2 proposed names with quoted prices.
  const [cohort] = await db.select().from(launchCohorts).where(eq(launchCohorts.name, name));
  const rows = await db
    .select({ row: launchCohortTowns, cand: townCandidates })
    .from(launchCohortTowns)
    .innerJoin(townCandidates, eq(townCandidates.id, launchCohortTowns.candidateId))
    .where(eq(launchCohortTowns.cohortId, cohort!.id));
  for (const { row, cand } of rows) {
    const price = cand.name === 'Agentville' ? 11.25 : 12.5;
    const key = cand.name.toLowerCase();
    const [launch] = await db
      .insert(launches)
      .values({
        candidateId: cand.id,
        geoid: cand.geoid,
        slug: `${key}-zy`,
        name: cand.name,
        state: 'ZY',
        status: 'stopped',
      })
      .returning();
    await db.insert(launchStepRecords).values(
      launchSteps.map((step) => ({
        launchId: launch!.id,
        step,
        ...(step === 'names'
          ? {
              detail: {
                proposals: [
                  {
                    siteName: `${cand.name} Daily`,
                    domain: `${key}daily.com`,
                    blocked: [],
                    review: [],
                    quote: { available: true, price, renewalPrice: 15, premium: false },
                  },
                ],
              },
            }
          : {}),
      })),
    );
    await db
      .update(launchCohortTowns)
      .set({ launchId: launch!.id, state: 'done' })
      .where(eq(launchCohortTowns.id, row.id));
  }
  await db
    .update(launchCohorts)
    .set({ status: 'awaiting_purchase' })
    .where(eq(launchCohorts.id, cohort!.id));

  await page.goto(`${admin}/admin/launches#cohorts`);
  const purchase = card.getByTestId('cohort-purchase');
  await expect(purchase).toContainText('Total for this cohort: $23.75');
  await expect(card).toContainText('agentvilledaily.com · $11.25');
  await purchase.getByLabel('Type the total to approve').fill('23.00');
  await purchase.getByRole('button', { name: 'Approve and buy for $23.75' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    'Type the total exactly as shown ($23.75)',
  );
  await card.getByTestId('cohort-purchase').getByLabel('Type the total to approve').fill('$23.75');
  await card
    .getByTestId('cohort-purchase')
    .getByRole('button', { name: 'Approve and buy for $23.75' })
    .click();
  await expect(page.getByRole('status')).toHaveText('Approved: 2 domains for $23.75');
  await expect(card).toContainText('Domain purchase: pending');
  const actions = (await db.select().from(adminActions).where(eq(adminActions.staffId, me.id))).map(
    (a) => a.action,
  );
  expect(actions.sort()).toEqual(['cohort.create', 'cohort.purchase.approve']);
});

test('Proposals: one click approves a source; a routing change is recorded, not applied', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: proposals are shared state');
  await signIn(context, 'admin', 'proposals');
  const [boca] = await db.select().from(towns).where(eq(towns.slug, 'boca-raton'));
  const url = `https://e2e-${Date.now()}.example.gov/news.rss`;
  await db.insert(sourceProposals).values({
    townId: boca!.id,
    type: 'source',
    key: `city_news:feed:${url}`,
    kind: 'city_news',
    url,
    platform: 'feed',
    config: { kind: 'city_news', platform: 'feed', url, options: { format: 'rss' } },
    label: 'News feed: E2E releases',
    origin: 'discover (City: releases)',
    detail: 'News feed: E2E releases',
    estimatePerDay: 0.6,
    estimateBasis: 'feed city news sources in 1 town(s), last 30 days',
  });
  const key = `routing:anthropic:writer-thinking:${Date.now()}`;
  await db.insert(proposals).values({
    kind: 'routing',
    key,
    title: 'Routing: switch to "writer-thinking" (anthropic)',
    summary: 'Live evals: better fact-check pass rate.',
    detail: { diff: ['taskRoutes.write.thinking: "off" → "adaptive"'] },
  });

  await page.goto(`${admin}/admin/proposals`);
  const routing = page.locator(`[data-proposal="${key}"]`);
  await expect(routing.getByTestId('routing-diff')).toContainText(
    'taskRoutes.write.thinking: "off" → "adaptive"',
  );
  const row = page.locator(`[data-source="${url}"]`);
  await expect(row).toContainText('+0.6 items a day');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status')).toContainText('Run pnpm sources:export');
  const [added] = await db.select().from(sources).where(eq(sources.url, url));
  expect(added).toMatchObject({ townId: boca!.id, platform: 'feed' });

  await page.locator(`[data-proposal="${key}"]`).getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByRole('status')).toContainText('Rejected: Routing');
  const [decided] = await db.select().from(proposals).where(eq(proposals.key, key));
  expect(decided!.status).toBe('rejected');
});

test('Fixes and Digest show what the agents prepared', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: shared rows');
  await signIn(context, 'reviewer', 'fixes');
  const platform = `e2eplat${Date.now()}`;
  const [parent] = await db
    .insert(adapterFixRequests)
    .values({
      scope: 'platform',
      platform,
      failure: 'http_gone',
      httpStatus: 404,
      error: 'GET x failed: HTTP 404',
      diagnosis: `Platform pattern: the same http gone failure on ${platform} in 2 towns.`,
      fixture: {
        recordedAt: new Date().toISOString(),
        exchanges: [{ url: 'https://x.example/feed', status: 404, headers: {} }],
      },
    })
    .returning();
  await page.goto(`${admin}/admin/fixes`);
  const fix = page.getByTestId('platform-fixes').locator(`[data-fix="${platform}"]`);
  await expect(fix).toContainText('http gone (HTTP 404)');
  await expect(fix).toContainText('404 https://x.example/feed');
  await fix.getByLabel('Pull request URL').fill('https://github.com/David0524/TownCore/pull/999');
  await fix.getByRole('button', { name: 'Fixed' }).click();
  await expect(page.getByRole('status')).toHaveText('Marked fixed');
  const [done] = await db
    .select()
    .from(adapterFixRequests)
    .where(eq(adapterFixRequests.id, parent!.id));
  expect(done).toMatchObject({
    status: 'fixed',
    prUrl: 'https://github.com/David0524/TownCore/pull/999',
  });

  const date = '1999-01-01';
  await db.delete(opsDigests).where(eq(opsDigests.date, date));
  await db.insert(opsDigests).values({
    date,
    text: 'TownCore daily digest',
    items: [
      {
        section: 'Sources',
        severity: 'warning',
        text: '2 broken source(s); 1 open fix request(s), 1 platform pattern(s).',
        action: 'Fix requests are picked up by a Claude Code session.',
        link: '/admin/fixes',
      },
    ],
  });
  await page.goto(`${admin}/admin/digest?date=${date}`);
  await expect(page.getByTestId('digest-date')).toContainText(date);
  const digest = page.getByTestId('digest');
  await expect(digest.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(digest).toContainText('Warning: 2 broken source(s)');
  await digest.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(`${admin}/admin/fixes`);
  await db.delete(opsDigests).where(eq(opsDigests.date, date));

  await page.goto(`${admin}/admin/health`);
  await expect(
    page.getByTestId('story-coverage').getByRole('columnheader', { name: 'Discovery' }),
  ).toBeVisible();
});
