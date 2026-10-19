import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  businesses,
  createDb,
  eq,
  ownerLoginTokens,
  photoSubmissions,
  staff,
  staffSessions,
  towns,
} from '@towncore/db';
import { DIRECT } from './ports';

// Photos people send us (M9, CLAUDE.md §11c) on the fictional Pine Hollow: a reader sends one
// with the license grant, nothing shows until staff approve it with alt text, and the served
// photo carries no location data. An owner adds a photo to their listing the same way.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');
const pine = 'http://pinehollow.test';
// Node-side requests can't use the browser's host mapping: go direct with the Host header.
const direct = DIRECT;
const photoUrl = (host: string, id: string) =>
  [`${direct}/photos/${id}.jpg`, { headers: { Host: host } }] as const;
const admin = 'http://admin.test';
const photoFile = fileURLToPath(new URL('./fixtures/reader-photo.jpg', import.meta.url));

let townId: string;
test.beforeAll(async () => {
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'pine-hollow'));
  townId = town!.id;
});
async function staffPage(browser: Browser, tag: string) {
  const [member] = await db
    .insert(staff)
    .values({ email: `${tag}-${Date.now()}@towncore.net`, name: `Photo ${tag}`, role: 'reviewer' })
    .returning();
  const token = newToken();
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
  return { context, page: await context.newPage() };
}

async function approve(browser: Browser, tag: string, caption: string, alt: string) {
  const { context, page } = await staffPage(browser, tag);
  await page.goto(`${admin}/admin/photos`);
  const card = page.getByTestId('pending-photo').filter({ hasText: caption });
  await expect(card.locator('img')).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Write alt text from what the photo shows')).toBeVisible();
  const again = page.getByTestId('pending-photo').filter({ hasText: caption });
  await again.getByRole('textbox', { name: 'Alt text (what the photo shows)' }).fill(alt);
  await again.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status')).toHaveText('Photo approved.');
  await context.close();
}

test('a reader sends a photo; it shows only after approval, stripped of location', async ({
  page,
  browser,
  request,
}, info) => {
  const caption = `Sunset over the pond ${info.project.name} ${Date.now()}`;
  // Each run comes from its own address, so the hourly limit never trips across runs.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${Date.now() % 250}` });
  await page.goto(`${pine}/about`);
  await page.getByRole('link', { name: 'Send it to us' }).click();
  expect(new URL(page.url()).pathname).toBe('/photos');
  await expect(page.getByTestId('photo-license')).toContainText(
    'non-exclusive, royalty-free license',
  );
  await page.getByLabel('Photo (JPEG, PNG or WebP, up to 12 MB)').setInputFiles(photoFile);
  await page.getByLabel('What it shows').fill(caption);
  await page.getByLabel('When (optional)').fill('Oct. 15, evening');
  await page.getByLabel('Credit line to print').fill('Photo: Sam Reader');
  await page.getByLabel('Your name').fill('Sam Reader');
  await page.getByLabel('Your email (never shown)').fill(`sam-${info.project.name}@reader.test`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send photo' }).click();
  await expect(page.getByTestId('photo-message')).toContainText('An editor looks at every photo');

  const [row] = await db
    .select()
    .from(photoSubmissions)
    .where(and(eq(photoSubmissions.townId, townId), eq(photoSubmissions.caption, caption)));
  expect(row).toMatchObject({ status: 'pending', licenseVersion: 'reader-v1', kind: 'reader' });
  expect((await request.get(...photoUrl('pinehollow.test', row!.id))).status()).toBe(404);

  await approve(
    browser,
    `reader-${info.project.name}`,
    caption,
    'An orange sun setting over a pond.',
  );
  const served = await request.get(...photoUrl('pinehollow.test', row!.id));
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/jpeg');
  // Re-encoded without EXIF: no GPS from the original file.
  expect((await served.body()).includes(Buffer.from('Exif'))).toBe(false);
  // Another town's domain doesn't serve it.
  expect((await request.get(...photoUrl('harborpoint.test', row!.id))).status()).toBe(404);
});

test('an owner adds a photo to their listing; it shows once approved', async ({
  page,
  browser,
}, info) => {
  const slug = `pond-bakery-photo-${info.project.name}`;
  const email = `owner-${info.project.name}@pondbakery.test`;
  await db.delete(businesses).where(and(eq(businesses.townId, townId), eq(businesses.slug, slug)));
  await db.insert(businesses).values({
    townId,
    slug,
    name: `Pond Bakery ${info.project.name}`,
    category: 'restaurants',
    licenseVerified: true,
    dataSource: 'test',
    active: true,
    claimedAt: new Date(),
    claimedByEmail: email,
  });
  const signin = newToken();
  await db.insert(ownerLoginTokens).values({
    townId,
    email,
    tokenHash: hash(signin),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  await page.goto(`${pine}/owner/signin?t=${signin}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto(`${pine}/owner/${slug}`);
  const section = page.getByTestId('owner-photos');
  await expect(section.getByTestId('business-license')).toContainText(
    'The business owns this photo',
  );
  const caption = `Our front counter ${info.project.name}`;
  await section.getByLabel('Photo (JPEG, PNG or WebP, up to 12 MB)').setInputFiles(photoFile);
  await section.getByLabel('What it shows').fill(caption);
  // On phones the label's text sits over the small box; the box itself is what's checked.
  await section.getByRole('checkbox').check({ force: true });
  await section.getByRole('button', { name: 'Send photo' }).click();
  await expect(page.getByTestId('owner-payment')).toContainText('once our staff check it');
  await expect(page.getByTestId('owner-photos')).toContainText('Waiting for review.');

  await approve(
    browser,
    `owner-${info.project.name}`,
    caption,
    'A bakery counter with bread on shelves.',
  );
  await page.goto(`${pine}/directory/restaurants/${slug}`);
  const photos = page.getByTestId('listing-photos');
  await expect(
    photos.getByRole('img', { name: 'A bakery counter with bread on shelves.' }),
  ).toBeVisible();
  await expect(photos).toContainText(`Photo: Pond Bakery ${info.project.name}`);
});
