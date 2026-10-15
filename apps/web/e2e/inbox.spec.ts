import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { requireEnv } from '@towncore/config';
import {
  adminActions,
  asc,
  attachments,
  contacts,
  createDb,
  eq,
  hashToken,
  mailDomains,
  messages,
  notes,
  staff,
  staffSessions,
  teams,
  threads,
  type Db,
} from '@towncore/db';

// Shared inbox (docs/plans/MAIL.md, Mail-3): filters and search, per-person unread, the
// sandboxed message frame with remote images blocked, audited actions, notes, keyboard.

const admin = 'http://admin.test';

let db: Db;
test.beforeAll(() => {
  db = createDb(requireEnv('DATABASE_URL'), { max: 2 });
});
test.afterAll(async () => {
  await db.$client.end();
});

/** A fresh staff member and session per test, so unread state never couples tests. */
async function signIn(context: BrowserContext, tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Inbox ${tag}`, role: 'admin' })
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

/** One conversation on its own test domain, with an HTML message, a remote image and a file. */
async function conversation(tag: string) {
  const name = `${tag}-${Date.now()}.inbox.test`;
  const [domain] = await db
    .insert(mailDomains)
    .values({
      name,
      displayName: `Inbox ${tag} Times`,
      isTest: true,
      status: 'live',
      inboundEnabled: true,
    })
    .returning();
  const [sales] = await db.select().from(teams).where(eq(teams.name, 'Sales'));
  const [contact] = await db
    .insert(contacts)
    .values({ email: `reader-${tag}-${Date.now()}@example.com`, name: 'Pat Reader' })
    .returning();
  const subject = `Rates question ${tag} ${Date.now()}`;
  const [thread] = await db
    .insert(threads)
    .values({
      domainId: domain!.id,
      teamId: sales!.id,
      contactId: contact!.id,
      townAddress: `sales@${name}`,
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
      fromAddress: contact!.email,
      fromName: 'Pat Reader',
      toAddresses: [`sales@${name}`],
      envelopeRecipient: `sales@${name}`,
      subject,
      textBody: 'How much is a sponsored slot?',
      htmlBodySanitized:
        '<p>How much is a <b>sponsored slot</b>?</p><img src="https://tracker.example.com/p.gif" width="1" height="1">',
      sesMessageId: `ses-${tag}-${Date.now()}`,
      spamVerdict: 'PASS',
      sentAt: new Date(),
    })
    .returning();
  await db.insert(attachments).values({
    messageId: message!.id,
    position: 0,
    filename: 'rate-card.pdf',
    contentType: 'application/pdf',
    size: 2048,
    s3Key: `attachments/${message!.id}/0-rate-card.pdf`,
  });
  return { domain: domain!, thread: thread!, message: message!, subject, contact: contact! };
}

test.describe('inbox', () => {
  test('lists, filters and searches conversations, unread until opened', async ({
    page,
    context,
  }, info) => {
    const me = await signIn(context, `list-${info.project.name}`);
    const c = await conversation(`list-${info.project.name}`);

    await page.goto(`${admin}/admin/mail/inbox`);
    await expect(page.getByTestId('nav-inbox')).toHaveText(/Inbox \(\d+\)/);
    const row = page.getByTestId('inbox').locator('li', { hasText: c.subject });
    await expect(row).toContainText('Pat Reader');
    await expect(row).toContainText(`sales@${c.domain.name} · Sales · Unassigned · open`);
    await expect(row.getByLabel('Unread')).toBeVisible();

    // Search by contact, then by town.
    await page.getByRole('searchbox', { name: 'Search' }).fill(c.contact.email);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByTestId('inbox').locator('li')).toHaveCount(1);
    await page.goto(`${admin}/admin/mail/inbox?q=${encodeURIComponent(c.domain.name)}&status=spam`);
    await expect(page.getByTestId('inbox').locator('li')).toHaveCount(0);

    // Opening it marks it read for me only.
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}`);
    await page.goto(`${admin}/admin/mail/inbox?q=${encodeURIComponent(c.domain.name)}`);
    await expect(
      page.getByTestId('inbox').locator('li', { hasText: c.subject }).getByLabel('Unread'),
    ).toHaveCount(0);
    expect(me.id).toBeTruthy();
  });

  test('shows the message in a sandboxed frame with remote images blocked until asked', async ({
    page,
    context,
  }, info) => {
    await signIn(context, `view-${info.project.name}`);
    const c = await conversation(`view-${info.project.name}`);
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}`);

    const frame = page.locator('iframe').first();
    await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    const blocked = (await frame.getAttribute('srcdoc'))!;
    expect(blocked).toMatch(/img-src data: http:\/\/admin\.test;/);
    expect(blocked).not.toContain('https: http:');
    await expect(page.frameLocator('iframe').first().getByText('sponsored slot')).toBeVisible();
    await expect(page.getByTestId('attachments')).toContainText('rate-card.pdf');

    await page.getByRole('link', { name: 'Load remote images' }).click();
    await expect(page.getByRole('link', { name: 'Load remote images' })).toHaveCount(0);
    expect(await page.locator('iframe').first().getAttribute('srcdoc')).toContain(
      'img-src data: http://admin.test https: http:',
    );
  });

  test('assign, status, team, spam and notes work and are audited', async ({
    page,
    context,
  }, info) => {
    const me = await signIn(context, `act-${info.project.name}`);
    const c = await conversation(`act-${info.project.name}`);
    await page.goto(`${admin}/admin/mail/inbox/${c.thread.id}`);

    const meta = page.getByTestId('thread-meta');
    // Each action redirects back here; let the page settle before touching the next form.
    const settled = async (text: string) => {
      await expect(meta).toContainText(text);
      await page.waitForLoadState('networkidle');
    };
    await page.getByRole('button', { name: 'Assign to me' }).click();
    await settled(me.name);
    await page.getByLabel('Status').selectOption('pending');
    await page.getByRole('button', { name: 'Set status' }).click();
    await settled('pending');
    await page.getByLabel('Team').selectOption({ label: 'Editorial' });
    await page.getByRole('button', { name: 'Move' }).click();
    await settled('Editorial');
    await page.getByRole('button', { name: 'Mark spam' }).click();
    await settled('spam');
    await page.getByRole('button', { name: 'Not spam' }).click();
    await settled('open');
    await page.getByLabel('Add a note').fill('Sent them the rate card by phone.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByTestId('notes')).toContainText('Sent them the rate card by phone.');

    const log = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, c.thread.id))
      .orderBy(asc(adminActions.createdAt));
    expect(log.map((l) => l.action)).toEqual([
      'thread_assign',
      'thread_status',
      'thread_move_team',
      'thread_mark_spam',
      'thread_not_spam',
      'thread_note',
    ]);
    expect(await db.select().from(notes).where(eq(notes.threadId, c.thread.id))).toHaveLength(1);
  });

  test('keyboard: / searches, j moves, Enter opens, u goes back', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard shortcuts are a desktop feature');
    await signIn(context, `keys-${info.project.name}`);
    const c = await conversation(`keys-${info.project.name}`);
    await page.goto(`${admin}/admin/mail/inbox`);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();
    await page.keyboard.type(c.domain.name);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inbox').locator('li')).toHaveCount(1);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${admin}/admin/mail/inbox/${c.thread.id}`);
    await page.keyboard.press('u');
    await expect(page).toHaveURL(`${admin}/admin/mail/inbox`);
  });

  test('attachments: staff only, inline images need a signature', async ({
    page,
    context,
    request,
  }, info) => {
    const c = await conversation(`files-${info.project.name}`);
    const [file] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, c.message.id));
    // Signed out: sent to sign-in.
    await page.goto(`${admin}/admin/mail/attachments/${file!.id}`);
    await expect(page).toHaveURL(`${admin}/admin/login`);
    // Signed in, but no AWS credentials in tests: a clear 503, never the file.
    await signIn(context, `files-${info.project.name}`);
    const response = await page.goto(`${admin}/admin/mail/attachments/${file!.id}`);
    expect(response?.status()).toBe(503);
    const inline = await request.get(
      `http://127.0.0.1:3100/admin/mail/attachments/${file!.id}/inline`,
      {
        headers: { host: 'admin.test' },
      },
    );
    expect(inline.status()).toBe(403);
  });
});
