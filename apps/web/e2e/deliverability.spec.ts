import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  createDb,
  dmarcReports,
  dnsRecords,
  eq,
  hashToken,
  mailDomains,
  staff,
  staffSessions,
  type Db,
} from '@towncore/db';

// Inbox-placement test and DMARC policy step-up (owner, 2026-10-19), in Admin → Mail.

const admin = 'http://admin.test';
const DAY = 86_400_000;
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
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Ops ${tag}`, role: 'admin' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
}

async function addDomain(tag: string) {
  const name = `${tag}-${Date.now()}.test`;
  const [d] = await db
    .insert(mailDomains)
    .values({ name, displayName: 'Placement Ledger', status: 'live', bulkStatus: 'warming' })
    .returning();
  return d!;
}

test('send a placement test to the seeds, then record where each copy landed', async ({
  page,
  context,
}, info) => {
  await signIn(context, `placement-${info.project.name}`);
  const domain = await addDomain(`placement-${info.project.name}`);
  try {
    await page.goto(`${admin}/admin/mail/domains/${domain.name}`);
    const section = page.getByTestId('placement');
    await expect(section).toContainText('seed inboxes');
    await section.getByRole('button', { name: 'Send placement test' }).click();
    await expect(page.getByRole('status').first()).toContainText('Placement test sent');

    const results = page.getByTestId('placement-results');
    await expect(results.locator('tr[data-seed]')).toHaveCount(2);
    await expect(section).toContainText('0 of 2 in the inbox, 2 not checked yet');

    await results
      .locator('tr[data-seed="seed-one@example.com"]')
      .getByRole('button', { name: 'Inbox' })
      .click();
    await expect(page.getByRole('status').first()).toContainText('Recorded.');
    await page
      .getByTestId('placement-results')
      .locator('tr[data-seed="seed-two@example.com"]')
      .getByRole('button', { name: 'Spam' })
      .click();
    await expect(page.getByTestId('placement')).toContainText('1 of 2 in the inbox, 1 in spam');

    // Once a day: a second press is refused.
    await page.getByRole('button', { name: 'Send placement test' }).click();
    await expect(page.getByRole('alert').first()).toContainText('last 24 hours');
  } finally {
    await db.delete(mailDomains).where(eq(mailDomains.id, domain.id));
  }
});

test('Mail health says when a DMARC record is ready for a stricter policy', async ({
  page,
  context,
}, info) => {
  await signIn(context, `dmarc-${info.project.name}`);
  const domain = await addDomain(`dmarc-${info.project.name}`);
  const value = 'v=DMARC1; p=none; rua=mailto:dmarc@towncore.net; fo=1';
  await db.insert(dnsRecords).values({
    domainId: domain.id,
    purpose: 'dmarc',
    type: 'TXT',
    name: '_dmarc',
    value,
    vercelRecordId: 'rec_e2e',
    status: 'created',
    createdAt: new Date(Date.now() - 60 * DAY),
  });
  await db.insert(dmarcReports).values(
    Array.from({ length: 20 }, (_, i) => ({
      orgName: 'google.com',
      reportId: `${domain.name}-${i}`,
      domain: domain.name,
      policy: 'none',
      beginAt: new Date(Date.now() - (i + 2) * DAY),
      endAt: new Date(Date.now() - (i + 1) * DAY),
      messages: 40,
      dkimPass: 40,
      spfPass: 40,
      dmarcPass: 40,
      sources: [],
      receivedAt: new Date(),
    })),
  );
  try {
    await page.goto(`${admin}/admin/mail/health`);
    const row = page.getByTestId('dmarc-policy').locator(`tr[data-governs="${domain.name}"]`);
    await expect(row).toContainText('none');
    await expect(row).toContainText('Ready for quarantine');
    await expect(row).toContainText('800 messages');
    // No Vercel token in tests: the change is refused and nothing moves.
    await row.getByRole('button', { name: 'Move to quarantine' }).click();
    await expect(page.getByRole('alert').first()).toContainText('VERCEL_DNS_TOKEN');
    const [rec] = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, domain.id));
    expect(rec!.value).toBe(value);
  } finally {
    await db.delete(dmarcReports).where(eq(dmarcReports.domain, domain.name));
    await db.delete(mailDomains).where(eq(mailDomains.id, domain.id));
  }
});
