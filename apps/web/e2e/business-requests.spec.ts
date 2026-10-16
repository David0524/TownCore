import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  businessRequests,
  businesses,
  createDb,
  eq,
  inArray,
  staff,
  staffSessions,
} from '@towncore/db';

// "Claim your listing" and "Add your business" (owner, 2026-10-16): find a listing by name to
// claim it; a missing business asks to be added, and appears only once staff press Add.
const harbor = 'http://harborpoint.test';
// Feed Town, so a new listing never changes the Harbor Point counts other specs check.
const feed = 'http://feedtown.test';
const admin = 'http://admin.test';
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

test.afterAll(async () => {
  await db.$client.end();
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
}

test('claim your listing finds a business by name', async ({ page }) => {
  await page.goto(`${harbor}/directory/claim`);
  await page.getByRole('searchbox', { name: 'Business name' }).fill('plumbing');
  await page.getByRole('button', { name: 'Find it' }).click();
  const results = page.getByTestId('claim-results');
  const cove = results.getByRole('listitem').filter({ hasText: 'Cove Plumbing' });
  await expect(cove.getByRole('link', { name: 'Claim' })).toHaveAttribute(
    'href',
    '/directory/claim/cove-plumbing-test0003',
  );
  await page.getByRole('searchbox', { name: 'Business name' }).fill('zzz nothing');
  await page.getByRole('button', { name: 'Find it' }).click();
  await expect(page.getByTestId('claim-none')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add your business' }).first()).toHaveAttribute(
    'href',
    '/directory/add',
  );
});

test('add your business: sent, reviewed by staff, then listed', async ({ page, browser }, info) => {
  const name = `Tidepool Pet Grooming ${info.project.name} ${Date.now()}`;
  await page.goto(`${feed}/directory/add`);
  const form = page.getByTestId('add-form');
  await form.getByRole('textbox', { name: 'Business name' }).fill(name);
  await form.getByRole('combobox', { name: 'Kind of business' }).selectOption('pets');
  await form.getByRole('textbox', { name: /Street address/ }).fill('12 Harbor Street');
  await form.getByRole('textbox', { name: 'ZIP code' }).fill('33432');
  await form.getByRole('textbox', { name: /Business phone/ }).fill('561-555-0142');
  await form.getByRole('textbox', { name: 'Your name' }).fill('Robin Groomer');
  await form.getByRole('textbox', { name: /Your email/ }).fill('robin@tidepool.test');
  await form.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByTestId('add-message')).toContainText('An editor checks');

  // Nothing is listed until staff decide.
  const [request] = await db.select().from(businessRequests).where(eq(businessRequests.name, name));
  expect(request).toMatchObject({ status: 'pending', phone: '(561) 555-0142', zip: '33432' });
  await page.goto(`${feed}/directory/pets?q=${encodeURIComponent('Tidepool')}`);
  await expect(page.getByRole('link', { name })).toHaveCount(0);

  const staffContext = await browser.newContext();
  await signInStaff(staffContext, `requests-${info.project.name}`);
  const adminPage = await staffContext.newPage();
  await adminPage.goto(`${admin}/admin/directory`);
  const row = adminPage
    .getByTestId('requests-waiting')
    .getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('robin@tidepool.test');
  await row.getByRole('button', { name: 'Add to Places' }).click();
  await expect(adminPage.getByRole('status')).toHaveText('Business added to Places');
  await staffContext.close();

  await page.goto(`${feed}/directory/pets?q=${encodeURIComponent(name)}`);
  const card = page.getByTestId('place-card').filter({ hasText: name });
  await expect(card).toContainText('12 Harbor Street');
  await expect(card.getByRole('link', { name: `Call ${name}` })).toHaveAttribute(
    'href',
    'tel:5615550142',
  );

  // Leave Feed Town's directory as it was.
  const [added] = await db
    .select({ businessId: businessRequests.businessId })
    .from(businessRequests)
    .where(eq(businessRequests.name, name));
  await db.delete(businessRequests).where(eq(businessRequests.name, name));
  await db.delete(businesses).where(inArray(businesses.id, [added!.businessId!]));
});
