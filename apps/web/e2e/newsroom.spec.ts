import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  adminActions,
  and,
  contacts,
  createDb,
  eq,
  hashToken,
  mailDomains,
  messages,
  records,
  sources,
  staff,
  staffSessions,
  teams,
  threads,
  towns,
  type Db,
} from '@towncore/db';

// Press releases from the newsroom inbox: staff send an agency's emailed release to the town's
// newsroom from the conversation, confirming it comes from the organization itself (Rule 3), and
// it becomes a primary-source record the story finder handles like any other.

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
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Desk ${tag}`, role: 'reviewer' })
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

/** A release emailed to news@ on a test domain, of Review Town or of no town. */
async function release(tag: string, ofTown: boolean) {
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'review-town'));
  const name = `${tag}-${Date.now()}.newsroom.test`;
  const [domain] = await db
    .insert(mailDomains)
    .values({
      name,
      townId: ofTown ? town!.id : null,
      displayName: 'Review Town Times',
      isTest: true,
      status: 'live',
      inboundEnabled: true,
    })
    .returning();
  const [editorial] = await db.select().from(teams).limit(1);
  const [contact] = await db
    .insert(contacts)
    .values({ email: `pio-${tag}-${Date.now()}@reviewtown.gov`, name: 'Public Information' })
    .returning();
  const subject = `Fwd: Harbor Road closes for repairs ${tag} ${Date.now()}`;
  const [thread] = await db
    .insert(threads)
    .values({
      domainId: domain!.id,
      teamId: editorial!.id,
      contactId: contact!.id,
      townAddress: `news@${name}`,
      subject,
      normalizedSubject: subject.toLowerCase(),
      lastMessageAt: new Date(),
    })
    .returning();
  const [message] = await db
    .insert(messages)
    .values({
      threadId: thread!.id,
      direction: 'inbound',
      rfcMessageId: `<release-${tag}-${Date.now()}@reviewtown.gov>`,
      fromAddress: contact!.email,
      fromName: 'Public Information',
      toAddresses: [`news@${name}`],
      envelopeRecipient: `news@${name}`,
      subject,
      textBody:
        'FOR IMMEDIATE RELEASE\n\nThe Town of Review Town will close Harbor Road between Pier and Mill streets on Oct. 22 from 7 a.m. to 5 p.m. for drainage repairs, the Public Works Department said.',
      sentAt: new Date(),
    })
    .returning();
  return { town: town!, thread: thread!, message: message! };
}

test('staff send an emailed release to the newsroom, once, confirming its source', async ({
  page,
  context,
}, info) => {
  const me = await signIn(context, `newsroom-${info.project.name}`);
  const r = await release(`send-${info.project.name}`, true);
  await page.goto(`${admin}/admin/mail/inbox/${r.thread.id}`);
  const panel = page.getByTestId('newsroom');
  await expect(panel.getByRole('heading', { name: 'Send to newsroom' })).toBeVisible();
  const confirm = panel.getByLabel(
    'This release comes from the organization itself, not a news outlet',
  );
  await expect(confirm).not.toBeChecked();
  // Another outlet is never a choice (Rule 3).
  const options = await panel.locator('select[name="kind"]').locator('option').allTextContents();
  expect(options.join(' ')).not.toMatch(/outlet/i);
  await panel.locator('select[name="kind"]').selectOption({ label: 'Police' });
  // The confirmation is required: the form doesn't submit without it.
  await panel.getByRole('button', { name: 'Send to newsroom' }).click();
  await expect(page.getByTestId('newsroom-notice')).toHaveCount(0);
  await confirm.check();
  await panel.getByRole('button', { name: 'Send to newsroom' }).click();
  await expect(page.getByTestId('newsroom-notice')).toHaveText(/Sent to the newsroom/);
  await expect(page.getByTestId('newsroom-sent')).toContainText('In the newsroom');
  await expect(page.getByTestId('newsroom-sent')).toContainText('Police');
  // Nothing left to send in this conversation.
  await expect(panel.getByRole('button', { name: 'Send to newsroom' })).toHaveCount(0);

  const [record] = await db
    .select({ record: records, source: sources })
    .from(records)
    .innerJoin(sources, eq(sources.id, records.sourceId))
    .where(eq(records.externalId, `message:${r.message.rfcMessageId}`));
  expect(record!.record).toMatchObject({
    townId: r.town.id,
    type: 'release',
    url: null,
  });
  expect(record!.record.title).toMatch(/^Harbor Road closes for repairs/);
  expect(record!.record.text).toContain('drainage repairs');
  expect(record!.source).toMatchObject({ platform: 'inbox', kind: 'police' });
  const audit = await db
    .select()
    .from(adminActions)
    .where(and(eq(adminActions.action, 'newsroom.send'), eq(adminActions.staffId, me.id)));
  expect(audit).toHaveLength(1);
});

test('a conversation on an address that is no town’s has no newsroom', async ({
  page,
  context,
}, info) => {
  await signIn(context, `no-town-${info.project.name}`);
  const r = await release(`none-${info.project.name}`, false);
  await page.goto(`${admin}/admin/mail/inbox/${r.thread.id}`);
  await expect(page.getByTestId('message')).toHaveCount(1);
  await expect(page.getByTestId('newsroom')).toHaveCount(0);
});
