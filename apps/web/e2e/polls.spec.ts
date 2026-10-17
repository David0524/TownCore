import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  adminActions,
  and,
  articles,
  createDb,
  eq,
  facebookPosts,
  polls,
  staff,
  staffSessions,
  towns,
} from '@towncore/db';

// Quick polls and the Facebook queue (owner, 2026-10-17; docs/plans/facebook.md), on two towns
// with different families: Harbor Point (heritage, main column) and Pine Hollow (community, rail).
const admin = 'http://admin.test';
// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const TOWNS = [
  {
    slug: 'harbor-point',
    url: 'http://harborpoint.test',
    pollId: '0f0f0000-0000-4000-8000-00000000a001',
    question: 'Should the harbor walk stay open until 10 p.m. in summer?',
  },
  {
    slug: 'pine-hollow',
    url: 'http://pinehollow.test',
    pollId: '0f0f0000-0000-4000-8000-00000000a002',
    question: 'Should the farmers market add a Wednesday evening?',
  },
];

test.beforeAll(async () => {
  await db
    .insert(staff)
    .values({ email: 'polls-e2e@towncore.net', name: 'Poll Editor', role: 'admin' })
    .onConflictDoNothing();
  const [editor] = await db.select().from(staff).where(eq(staff.email, 'polls-e2e@towncore.net'));
  for (const t of TOWNS) {
    const [town] = await db.select().from(towns).where(eq(towns.slug, t.slug));
    await db
      .insert(polls)
      .values({
        id: t.pollId,
        townId: town!.id,
        question: t.question,
        options: ['Yes', 'No', 'Not sure'],
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000),
        status: 'approved',
        createdBy: editor!.id,
        approvedBy: editor!.id,
        approvedAt: new Date(),
      })
      .onConflictDoNothing();
  }
});

async function signInStaff(context: BrowserContext, tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Staff ${tag}`, role: 'admin' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
  return member!;
}

for (const t of TOWNS) {
  test(`${t.slug}: readers vote once and then see the results`, async ({ page }) => {
    await page.goto(t.url);
    const poll = page.locator('[data-module="quick-poll"]');
    await expect(poll).toHaveCount(1);
    await expect(poll.getByRole('heading', { name: t.question })).toBeVisible();
    // No results before voting.
    await expect(poll.getByTestId('poll-results')).toHaveCount(0);
    await poll.getByRole('radio', { name: 'Yes' }).check();
    await poll.getByRole('button', { name: 'Vote' }).click();
    const results = poll.getByTestId('poll-results');
    await expect(results).toBeVisible();
    await expect(results).toContainText('your answer');
    await expect(results).toContainText(/\d+ votes?\. A reader poll/);

    // The browser remembers the vote: a reload shows the results, not the question's form.
    await page.reload();
    await expect(
      page.locator('[data-module="quick-poll"]').getByTestId('poll-results'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vote' })).toHaveCount(0);
  });
}

test('a poll for another town never shows on this one', async ({ page }) => {
  await page.goto('http://lettertown.test');
  await expect(page.locator('[data-module="quick-poll"]')).toHaveCount(0);
});

test('Admin → Polls saves a draft that shows only once approved', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'admin flow runs once');
  await signInStaff(page.context(), 'polls');
  const question = `Should Letter Town paint the post office mural ${Date.now()}?`;
  await page.goto(`${admin}/admin/polls`);
  await page.getByLabel('Site').selectOption({ label: 'The Letter Town Post' });
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Answer 1').fill('Yes');
  await page.getByLabel('Answer 2').fill('No');
  // Starts in two days, so Letter Town's homepage stays without a poll for the other specs.
  const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('First day').fill(later);
  await page.getByLabel('Last day').fill(later);
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('status')).toContainText('Poll created');
  const row = page.getByTestId('polls').getByRole('row').filter({ hasText: question });
  await expect(row).toContainText('Waiting for approval');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status')).toContainText('Poll approved');
  await expect(
    page.getByTestId('polls').getByRole('row').filter({ hasText: question }),
  ).toContainText('Approved, starts later');
  const [saved] = await db.select().from(polls).where(eq(polls.question, question));
  const audit = await db.select().from(adminActions).where(eq(adminActions.targetId, saved!.id));
  expect(audit.map((a) => a.action).sort()).toEqual(['poll.approve', 'poll.create']);
});

test('Admin → Facebook lists the batch by cohort and marks a post, audited', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'admin flow runs once');
  await signInStaff(page.context(), 'facebook');
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
  const [story] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.townId, town!.id), eq(articles.status, 'published')))
    .limit(1);
  const message = `${story!.headline}\n\n${story!.dek ?? ''}`.trim();
  await db.delete(facebookPosts).where(eq(facebookPosts.articleId, story!.id));
  const [post] = await db
    .insert(facebookPosts)
    .values({
      townId: town!.id,
      articleId: story!.id,
      kind: 'daily',
      day: new Date().toISOString().slice(0, 10),
      message,
      link: `https://harborpoint.test/news/${story!.slug}?ref=facebook`,
    })
    .returning();

  await page.goto(`${admin}/admin/facebook`);
  await expect(page.getByTestId('autopost')).toHaveText('off');
  const card = page.getByTestId('facebook-post').filter({ hasText: story!.headline });
  await expect(card).toContainText('The Harbor Point Ledger · Top story');
  await expect(card).toContainText('no Facebook page yet');
  await expect(card.getByRole('link', { name: /\?ref=facebook$/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Copy post' })).toBeVisible();
  // No page token: no Post button, only marking by hand.
  await expect(card.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('facebook-missing')).toContainText('The Harbor Point Ledger');
  await card.getByRole('button', { name: 'Mark as posted' }).click();
  await expect(page.getByRole('status')).toContainText('Marked as posted.');
  const [after] = await db.select().from(facebookPosts).where(eq(facebookPosts.id, post!.id));
  expect(after).toMatchObject({ status: 'posted', method: 'manual' });
  const audit = await db.select().from(adminActions).where(eq(adminActions.targetId, post!.id));
  expect(audit.map((a) => a.action)).toEqual(['facebook.mark_posted']);
});
