import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  businessClaims,
  businesses,
  createDb,
  eq,
  mailDomains,
  ownerLoginTokens,
  staff,
  staffSessions,
  towns,
} from '@towncore/db';
import { DIRECT } from './ports';

// Claiming a listing and the owner portal (M6 PR C) on the fictional Harbor Point: claim →
// confirm the email → staff approve → owner signs in by link → edits → the listing shows it.
// Emails go to the server log in tests (MAIL_TRANSPORT=log), so the test sets known link
// tokens directly; only their hashes are ever stored.
const harbor = 'http://harborpoint.test';
const admin = 'http://admin.test';
// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');

// Each browser project claims its own listing, so the two runs never collide. Roofers, so the
// plumbers the directory spec checks stay unclaimed while both run.
const listings: Record<string, { slug: string; name: string }> = {
  desktop: { slug: 'ferry-lane-roofing-test0006', name: 'Ferry Lane Roofing' },
  mobile: { slug: 'gull-rock-roofers-test0007', name: 'Gull Rock Roofers' },
};

let townId: string;

test.beforeAll(async () => {
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
  townId = town!.id;
  // Claim mail needs the town's mail domain to be live (sent to the log in tests).
  await db
    .insert(mailDomains)
    .values({
      name: 'harborpoint.test',
      townId,
      displayName: 'The Harbor Point Ledger',
      status: 'live',
    })
    .onConflictDoNothing();
});

async function resetListing(slug: string) {
  const [listing] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.townId, townId), eq(businesses.slug, slug)));
  await db.delete(businessClaims).where(eq(businessClaims.businessId, listing!.id));
  await db
    .update(businesses)
    .set({
      claimedAt: null,
      claimedByEmail: null,
      phone: null,
      website: null,
      hours: null,
      description: null,
      serviceArea: null,
      pendingName: null,
    })
    .where(eq(businesses.id, listing!.id));
  return listing!;
}

async function signInStaff(context: BrowserContext, tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Staff ${tag}`, role: 'admin' })
    .returning();
  const token = newToken();
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
}

test('claim, confirm, approve, sign in and edit a listing', async ({ page, browser }, info) => {
  const { slug, name } = listings[info.project.name]!;
  const listing = await resetListing(slug);
  const email = `owner-${info.project.name}@${slug}.test`;

  // 1. The claim form, from the listing page.
  await page.goto(`${harbor}/directory/roofers/${slug}`);
  await page.getByTestId('claim').click();
  expect(new URL(page.url()).pathname).toBe(`/directory/claim/${slug}`);
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Pat Owner');
  await page.getByRole('textbox', { name: 'Your role at the business' }).fill('Owner');
  await page.getByRole('textbox', { name: 'Business email' }).fill(email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send me a confirmation link' }).click();
  await expect(page.getByTestId('claim-message')).toContainText('Check your inbox');

  // 2. The link in the email: a GET shows a button; pressing it confirms.
  const [claim] = await db
    .select()
    .from(businessClaims)
    .where(eq(businessClaims.businessId, listing.id));
  expect(claim).toMatchObject({ email, status: 'unverified', claimantName: 'Pat Owner' });
  const verify = newToken();
  await db
    .update(businessClaims)
    .set({ verifyTokenHash: hash(verify) })
    .where(eq(businessClaims.id, claim!.id));
  await page.goto(`${harbor}/directory/claim/verify?t=${verify}`);
  await page.getByRole('button', { name: 'Confirm my claim' }).click();
  await expect(page.getByTestId('claim-result')).toContainText('your email address is confirmed');
  // The listing is not the claimant's until staff approve it.
  await page.goto(`${harbor}/directory/roofers/${slug}`);
  await expect(page.getByTestId('claim')).toBeVisible();

  // 3. Staff approve it in Admin → Directory.
  const staffContext = await browser.newContext();
  await signInStaff(staffContext, `claims-${info.project.name}`);
  const adminPage = await staffContext.newPage();
  await adminPage.goto(`${admin}/admin/directory`);
  const row = adminPage.getByTestId('claims-waiting').getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText(email);
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByRole('status')).toHaveText('Claim approved');
  await staffContext.close();

  // 4. The owner signs in with an emailed link (single use).
  const signin = newToken();
  await db.insert(ownerLoginTokens).values({
    townId,
    email,
    tokenHash: hash(signin),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  await page.goto(`${harbor}/owner/signin?t=${signin}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const main = page.getByRole('main');
  await expect(main).toContainText(`Signed in as ${email}`);
  await main.getByRole('link', { name: new RegExp(name) }).click();

  // 5. Edits: a bad phone is explained; good details show on the listing at once.
  await main.getByRole('textbox', { name: 'Phone' }).fill('12');
  await main.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('owner-errors')).toContainText('10-digit US phone number');
  await main.getByRole('textbox', { name: 'Phone' }).fill('207 555 0199');
  await main.getByRole('textbox', { name: 'Website' }).fill('example.com');
  await main.getByRole('textbox', { name: 'About the business' }).fill('Family-run since 1990.');
  await main.getByRole('textbox', { name: 'Business name' }).fill(`${name} & Sons`);
  await main.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('owner-saved')).toContainText('once our staff check it');

  await page.goto(`${harbor}/directory/roofers/${slug}`);
  await expect(main.getByRole('link', { name: `Call ${name}` })).toHaveAttribute(
    'href',
    'tel:2075550199',
  );
  await expect(page.getByTestId('listing-description')).toHaveText('Family-run since 1990.');
  // The new name waits for staff; the page still shows the licensed name.
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(page.getByTestId('manage')).toBeVisible();

  // The sign-in link can't be used twice.
  await page.context().clearCookies();
  await page.goto(`${harbor}/owner/signin?t=${signin}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('owner-message')).toContainText('expired or was already used');

  await resetListing(slug);
});

test('asking for a sign-in link answers the same for any address', async ({ page }) => {
  await page.goto(`${harbor}/owner`);
  await page.getByRole('textbox', { name: 'Email' }).fill('nobody@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByTestId('owner-message')).toContainText(
    'If that address manages a listing here',
  );
  // Owner pages need a session.
  await page.goto(`${harbor}/owner/cove-plumbing-test0003`);
  expect(new URL(page.url()).pathname).toBe('/owner');
});

test('a claim posted from another site is refused', async ({ request }) => {
  const response = await request.post(`${DIRECT}/directory/claim/cove-plumbing-test0003/submit`, {
    headers: { host: 'harborpoint.test', origin: 'https://evil.example' },
    form: { name: 'X', role: 'Owner', email: 'x@example.com', attest: 'yes' },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toContain('s=unavailable');
});
