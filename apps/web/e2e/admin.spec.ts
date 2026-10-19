import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  articles,
  articleUpdates,
  createDb,
  staff,
  adminActions,
  createLoginToken,
  dnsRecords,
  domainIdentities,
  eq,
  mailDomains,
  onboardingSteps,
  findOrCreateStaff,
  getTownBySlug,
  hashToken,
  records,
  skippedCandidates,
  sources,
  staffSessions,
  storyCandidates,
  type Db,
} from '@towncore/db';
import { DIRECT } from './ports';

// Staff admin (docs/plans/M3.md §8): only on the admin host, email-link sign-in, and the
// review queue's approve / edit / reject actions, plus the skip log.

const admin = 'http://admin.test';
const boca = 'http://bocatownsquare.com';
// Admin tests publish only to this fixture town, so other specs never see their stories.
const reviewTown = 'http://reviewtown.test';
const RECORD_TEXT =
  'The Review Town City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road.';

let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
});
test.afterAll(async () => {
  await db.$client.end();
});

async function editor() {
  return (await findOrCreateStaff(db, 'editor@admin.test', ['editor@admin.test']))!;
}

/** A fresh staff member per test, so the 5-links-an-hour limit never couples tests. */
async function freshStaff(tag: string) {
  const [member] = await db
    .insert(staff)
    .values({
      email: `${tag}-${Date.now()}@admin.test`,
      name: 'John',
      role: 'admin',
      placeholder: true,
    })
    .returning();
  return member!;
}

async function signIn(context: BrowserContext) {
  const member = await editor();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
}

/** A story waiting in review in the fixture town, with its source record. */
async function storyInReview(tag: string) {
  const town = (await getTownBySlug(db, 'review-town'))!;
  const [source] = await db
    .insert(sources)
    .values({
      townId: town.id,
      kind: 'city_news',
      platform: 'e2e',
      adapter: 'e2e',
      key: `e2e-${tag}`,
    })
    .onConflictDoNothing()
    .returning();
  const sourceId =
    source?.id ??
    (
      await db
        .select()
        .from(sources)
        .where(eq(sources.key, `e2e-${tag}`))
    )[0]!.id;
  const [record] = await db
    .insert(records)
    .values({
      sourceId,
      townId: town.id,
      externalId: `e2e-${tag}-${Date.now()}`,
      type: 'release',
      title: 'Council approves paving contract',
      text: RECORD_TEXT,
      contentHash: 'e2e',
    })
    .returning();
  const [article] = await db
    .insert(articles)
    .values({
      townId: town.id,
      slug: `test-review-${tag}-${Date.now()}`,
      headline: `[TEST] Council approves paving contract (${tag})`,
      dek: 'Work on Palmetto Park Road follows the vote.',
      bodyMd: RECORD_TEXT,
      beat: 'government',
      tier: 3,
      status: 'in_review',
      reviewReason: 'tier3',
      tierReasons: ['names a private person (Pat Doe)'],
      byline: 'The Review Town Courier Newsroom',
      sourceRecordIds: [record!.id],
      factcheck: {
        method: 'model+code',
        score: 1,
        decision: 'pass',
        claims: [
          {
            claim: 'The vote was 4-1',
            recordId: record!.id,
            quote: 'voted 4-1 on Tuesday',
            supported: true,
          },
        ],
      },
    })
    .returning();
  return { town, article: article!, record: record! };
}

test.describe('admin host', () => {
  test('/admin does not exist on a town site', async ({ page }) => {
    const response = await page.goto(`${boca}/admin/review`);
    expect(response?.status()).toBe(404);
  });

  test('admin pages need sign-in and are never indexed', async ({ page }) => {
    await page.goto(`${admin}/admin/review`);
    await expect(page).toHaveURL(`${admin}/admin/login`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByText('TownCore admin')).toBeVisible();
  });

  test('asking for a link gives the same answer for any address', async ({ page }, info) => {
    const member = await freshStaff(`ask-${info.project.name}`);
    for (const email of ['stranger@example.com', member.email]) {
      await page.goto(`${admin}/admin/login`);
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
      await expect(page.getByRole('status')).toContainText('If that address belongs to staff');
    }
  });

  test('a sign-in link works once', async ({ page }, info) => {
    const token = await createLoginToken(db, (await freshStaff(`link-${info.project.name}`)).id);
    await page.goto(`${admin}/admin/auth?token=${token}`);
    await expect(page).toHaveURL(`${admin}/admin/review`);
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
    await page.context().clearCookies();
    await page.goto(`${admin}/admin/auth?token=${token}`);
    await expect(page).toHaveURL(`${admin}/admin/login?error=link`);
  });
});

test.describe('review queue', () => {
  test('edit re-checks names and numbers; approve publishes as "Reviewed by an editor"', async ({
    page,
    context,
  }, info) => {
    await signIn(context);
    const { article } = await storyInReview(`approve-${info.project.name}`);
    await page.goto(`${admin}/admin/review`);
    await page.locator(`a[href="/admin/review/${article.id}"]`).click();
    await expect(page.getByTestId('claims')).toContainText('✓ Supported');

    // An edit that adds a number no record has is flagged.
    await page.getByText('Edit the story').click();
    await page.getByLabel('Body (Markdown)').fill(`${RECORD_TEXT} It will take 90 days.`);
    await page.getByRole('button', { name: 'Save edits and re-check' }).click();
    await expect(page.getByTestId('recheck')).toContainText('the number 90');

    await page
      .getByRole('button', { name: /Approve and publish as “Reviewed by an editor”/ })
      .click();
    await expect(page).toHaveURL(`${admin}/admin/review?done=approved`);

    const [published] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(published).toMatchObject({
      status: 'published',
      byline: 'The Review Town Courier Newsroom. Reviewed by an editor',
    });
    await page.goto(`${reviewTown}/news/${article.slug}`);
    await expect(page.getByText('Reviewed by an editor')).toBeVisible();
    await expect(page.getByText('It will take 90 days.')).toBeVisible();
  });

  test('reject needs a reason and takes the story out of the queue', async ({
    page,
    context,
  }, info) => {
    await signIn(context);
    const { article } = await storyInReview(`reject-${info.project.name}`);
    await page.goto(`${admin}/admin/review/${article.id}`);
    await page.getByLabel(/Reject: reason/).fill('Names a private person without need.');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page).toHaveURL(`${admin}/admin/review?done=rejected`);
    const [row] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(row).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Names a private person without need.',
    });
  });

  test('the skip log can queue a candidate for the writer', async ({ page, context }, info) => {
    await signIn(context);
    const town = (await getTownBySlug(db, 'review-town'))!;
    const [candidate] = await db
      .insert(storyCandidates)
      .values({
        townId: town.id,
        key: `e2e-skip-${info.project.name}-${Date.now()}`,
        title: `[TEST] Library hours change (${info.project.name})`,
        beat: 'community',
        recordIds: [],
        proposedTier: 1,
        status: 'skipped',
        newsworthiness: 31,
      })
      .returning();
    await db
      .insert(skippedCandidates)
      .values({ candidateId: candidate!.id, reason: 'below_threshold', detail: 'Score 31 < 40.' });

    await page.goto(`${admin}/admin/skipped`);
    const row = page.getByRole('row', {
      name: new RegExp(`Library hours change \\(${info.project.name}\\)`),
    });
    await expect(row).toContainText('below threshold');
    await row.getByRole('button', { name: 'Write it anyway' }).click();
    await expect(page).toHaveURL(`${admin}/admin/skipped?done=queued`);
    const [after] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.id, candidate!.id));
    expect(after?.status).toBe('accepted');
  });
});

test.describe('update notes', () => {
  test('approving a pending update adds a dated note to the published story', async ({
    page,
    context,
  }, info) => {
    await signIn(context);
    const { article, record } = await storyInReview(`update-${info.project.name}`);
    await db
      .update(articles)
      .set({ status: 'published', publishedAt: new Date(), reviewReason: null })
      .where(eq(articles.id, article.id));
    const note = `Work now starts Nov. 9 (${info.project.name}).`;
    await db.insert(articleUpdates).values({
      articleId: article.id,
      noteMd: note,
      recordIds: [record.id],
      tier: 3,
      status: 'in_review',
      reviewReason: 'tier3',
    });

    await page.goto(`${admin}/admin/review`);
    const card = page.getByTestId('update-queue').locator('div', { hasText: note }).first();
    await card.getByRole('button', { name: 'Add update to the story' }).click();
    await expect(page).toHaveURL(`${admin}/admin/review?done=approved`);
    await page.goto(`${reviewTown}/news/${article.slug}`);
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByRole('main')).toContainText(/Update, \w+\.? \d+, \d{4}:/);
  });
});

test.describe('mail webhook', () => {
  test('exists only on the admin host and refuses unsigned messages', async ({ request }) => {
    const forged = {
      Type: 'Notification',
      MessageId: 'forged',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:x',
      Message: '{}',
      Timestamp: '2026-10-15T00:00:00Z',
      SignatureVersion: '2',
      Signature: 'AAAA',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/x.pem',
    };
    // API requests don't use the browser's host mapping; send the Host header to the local server.
    const post = (host: string, data: unknown) =>
      request.post(`${DIRECT}/api/mail/sns`, {
        headers: { host: new URL(host).host },
        data,
      });
    expect((await post(admin, 'not json')).status()).toBe(400);
    expect((await post(admin, forged)).status()).toBe(403);
    expect((await post(boca, forged)).status()).toBe(404);
  });
});

test.describe('mail domains', () => {
  test('lists domains, shows identities, records and steps, and queues a re-check', async ({
    page,
    context,
  }, info) => {
    await signIn(context);
    const name = `e2e-${info.project.name}-${Date.now()}.test`;
    const [domain] = await db
      .insert(mailDomains)
      .values({ name, displayName: 'E2E Times', isTest: true, status: 'onboarding' })
      .returning();
    await db.insert(domainIdentities).values({
      domainId: domain!.id,
      kind: 'root',
      identityName: name,
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
      mailFromDomain: `mail.${name}`,
      mailFromStatus: 'PENDING',
    });
    await db.insert(dnsRecords).values({
      domainId: domain!.id,
      purpose: 'inbound_mx',
      type: 'MX',
      name: '',
      value: 'inbound-smtp.us-east-1.amazonaws.com',
      priority: 10,
      status: 'created',
    });
    await db
      .insert(onboardingSteps)
      .values({ domainId: domain!.id, step: 'verify', status: 'waiting', attempts: 2 });

    await page.goto(`${admin}/admin/mail/domains`);
    await expect(page.getByTestId('mail-domains')).toContainText(name);
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByTestId('mail-identities')).toContainText(`mail.${name} (PENDING)`);
    await expect(page.getByTestId('mail-records')).toContainText(
      '10 inbound-smtp.us-east-1.amazonaws.com',
    );
    await expect(page.getByTestId('mail-steps')).toContainText('waiting');

    await page.getByRole('button', { name: 'Re-check SES status' }).click();
    await expect(page.getByRole('status')).toContainText('Re-check requested');
    const [row] = await db.select().from(mailDomains).where(eq(mailDomains.id, domain!.id));
    expect(row!.recheckRequestedAt).not.toBeNull();
    const audit = await db.select().from(adminActions).where(eq(adminActions.targetId, domain!.id));
    expect(audit.map((a) => [a.action, a.targetType])).toEqual([
      ['mail_domain_recheck', 'mail_domain'],
    ]);
  });
});
