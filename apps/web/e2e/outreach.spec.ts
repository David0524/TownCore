import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  articles,
  businesses,
  createDb,
  eq,
  hashToken,
  mailDomains,
  outreachDrafts,
  staff,
  staffSessions,
  towns,
} from '@towncore/db';

// Outreach drafts (M6 PR F, CLAUDE.md §11): a story names a listed business, the system drafts
// an email, and nothing goes out until staff add an address and press Send in Admin → Directory.
// Drafting itself (matching, quiet period, wording) is covered by packages/directory tests; here
// the draft row is inserted as the worker would write it. Mail goes to the server log in tests.
const admin = 'http://admin.test';
// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const NAME = 'Dockside Water Works';

test('staff review an outreach draft, add an address and send it', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: drafts are shared state');
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
  const townId = town!.id;
  await db
    .insert(mailDomains)
    .values({
      name: 'harborpoint.test',
      townId,
      displayName: 'The Harbor Point Ledger',
      status: 'live',
    })
    .onConflictDoNothing();
  const [listing] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.townId, townId), eq(businesses.name, NAME)));
  await db.delete(outreachDrafts).where(eq(outreachDrafts.businessId, listing!.id));
  const [story] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.townId, townId), eq(articles.slug, 'test-harbor-business')));
  await db.insert(outreachDrafts).values({
    townId,
    businessId: listing!.id,
    articleId: story!.id,
    subject: `${NAME} in The Harbor Point Ledger`,
    body: `The Harbor Point Ledger mentioned ${NAME} in a story.\n\nYou can claim the listing for free.`,
  });

  const [member] = await db
    .insert(staff)
    .values({
      email: `outreach-${Date.now()}@towncore.net`,
      name: 'Outreach Tester',
      role: 'admin',
    })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);

  await page.goto(`${admin}/admin/mail/inbox`);
  await page.getByTestId('outreach-link').click();
  const draft = page.getByTestId('outreach-drafts').locator('form', { hasText: NAME });
  await expect(draft.getByLabel('Subject')).toHaveValue(`${NAME} in The Harbor Point Ledger`);
  await expect(draft.getByLabel('Message')).toHaveValue(/claim the listing for free/);
  // Unclaimed: no address until staff find one on the business's own website.
  await expect(draft.getByLabel('To')).toHaveValue('');
  await draft.getByLabel('To').fill('office@docksidewater.test');
  await draft.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(/\/admin\/mail\/inbox\/[0-9a-f-]+\?sent=1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `${NAME} in The Harbor Point Ledger`,
  );
  // "No thanks": staff block the address from the conversation.
  await page.getByRole('button', { name: "Don't email office@docksidewater.test again" }).click();
  await expect(page.getByTestId('contact-suppressed')).toHaveText('Not emailed: manual');
  const [row] = await db
    .select()
    .from(outreachDrafts)
    .where(eq(outreachDrafts.businessId, listing!.id));
  expect(row).toMatchObject({ status: 'sent', toEmail: 'office@docksidewater.test' });
});
