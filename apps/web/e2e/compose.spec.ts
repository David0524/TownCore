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
  staff,
  staffSessions,
  suppressions,
  teams,
  threads,
  type Db,
} from '@towncore/db';

// Replies and new messages (docs/plans/MAIL.md, Mail-4). The test server uses
// MAIL_TRANSPORT=log, so nothing leaves the machine; messages are marked "logged".

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
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Writer ${tag}`, role: 'admin' })
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

async function conversation(tag: string) {
  const name = `${tag}-${Date.now()}.compose.test`;
  const [domain] = await db
    .insert(mailDomains)
    .values({
      name,
      displayName: `${tag} Times`,
      isTest: true,
      status: 'live',
      inboundEnabled: true,
    })
    .returning();
  const [sales] = await db.select().from(teams).where(eq(teams.name, 'Sales'));
  const [contact] = await db
    .insert(contacts)
    .values({ email: `pat-${tag}-${Date.now()}@example.com`, name: 'Pat' })
    .returning();
  const [thread] = await db
    .insert(threads)
    .values({
      domainId: domain!.id,
      teamId: sales!.id,
      contactId: contact!.id,
      townAddress: `sales@${name}`,
      subject: 'Rates',
      normalizedSubject: 'rates',
      lastMessageAt: new Date(),
    })
    .returning();
  await db.insert(messages).values({
    threadId: thread!.id,
    direction: 'inbound',
    rfcMessageId: `in-${tag}-${Date.now()}@example.com`,
    fromAddress: contact!.email,
    toAddresses: [`sales@${name}`],
    ccAddresses: [`lee-${tag}@example.org`, `news@${name}`],
    envelopeRecipient: `sales@${name}`,
    subject: 'Rates',
    textBody: 'How much is a slot?',
    sentAt: new Date(),
  });
  return { domain: domain!, thread: thread!, contact: contact! };
}

test.describe('replies', () => {
  test('reply from the town address; the message is stored, logged and audited', async ({
    page,
    context,
  }, info) => {
    const me = await signIn(context, `reply-${info.project.name}`);
    const c = await conversation(`reply-${info.project.name}`);
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}`);

    await expect(
      page.getByRole('heading', { name: `Reply from sales@${c.domain.name}` }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveValue(
      c.contact.email,
    );
    await expect(page.getByRole('textbox', { name: 'Cc', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(
      'Re: Rates',
    );
    await expect(page.getByTestId('composer')).toContainText(me.name);
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('A sponsored slot is $199 a month.');
    await page.getByRole('button', { name: 'Send reply' }).click();

    await expect(page.getByRole('status')).toContainText(`Sent from sales@${c.domain.name}`);
    await expect(page.getByTestId('delivery-status')).toHaveText('logged');
    const [out] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, c.thread.id), eq(messages.direction, 'outbound')));
    expect(out).toMatchObject({
      fromAddress: `sales@${c.domain.name}`,
      toAddresses: [c.contact.email],
      deliveryStatus: 'logged',
      sentByStaffId: me.id,
    });
    expect(out!.textBody).toContain('A sponsored slot is $199 a month.');
    expect(out!.inReplyTo).toMatch(/^in-reply-/);
    const audit = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, c.thread.id));
    expect(audit.map((a) => a.action)).toEqual(['mail_send']);
  });

  test('reply all copies the other people but none of our own addresses', async ({
    page,
    context,
  }, info) => {
    await signIn(context, `all-${info.project.name}`);
    const c = await conversation(`all-${info.project.name}`);
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}?reply=all`);
    await expect(page.getByRole('textbox', { name: 'Cc', exact: true })).toHaveValue(
      `lee-all-${info.project.name}@example.org`,
    );
  });

  test('a suppressed recipient needs a confirmation, and the draft is kept', async ({
    page,
    context,
  }, info) => {
    await signIn(context, `supp-${info.project.name}`);
    const c = await conversation(`supp-${info.project.name}`);
    await db
      .insert(suppressions)
      .values({ email: c.contact.email, scope: 'global', reason: 'hard_bounce' });
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}`);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Trying again.');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByTestId('composer').getByRole('alert')).toContainText(
      `Suppressed: ${c.contact.email} (hard bounce)`,
    );
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Trying again.',
    );
    await page.getByLabel(/Send anyway to/).check();
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('status')).toContainText('Sent from');
  });
});

test('a new message starts a conversation from a role address', async ({ page, context }, info) => {
  await signIn(context, `new-${info.project.name}`);
  const c = await conversation(`new-${info.project.name}`);
  await page.goto(`${admin}/admin/mail/compose`);
  await page.getByLabel('Town').selectOption(c.domain.id);
  await page.getByLabel('From address').selectOption('advertise');
  await page
    .getByRole('textbox', { name: 'To', exact: true })
    .fill(`owner-${info.project.name}@shop.example`);
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Your free listing');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Your shop is listed in our directory.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toContainText(`Sent from advertise@${c.domain.name}`);
  await expect(page.getByRole('heading', { name: 'Your free listing' })).toBeVisible();
  await expect(page.getByTestId('thread-meta')).toContainText('Sales');
});
