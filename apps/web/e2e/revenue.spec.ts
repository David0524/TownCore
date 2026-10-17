import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  adminActions,
  and,
  businessTestimonials,
  businesses,
  createDb,
  directoryPrices,
  directoryWaitlist,
  eq,
  inArray,
  ownerSessions,
  placements,
  priceChanges,
  slotStatsDaily,
  staff,
  staffSessions,
  towns,
} from '@towncore/db';

// Growing directory revenue honestly (owner, 2026-10-17), on Harbor Point and Pine Hollow: the
// real count of open featured spots on category pages, the waitlist once they're all sold, the
// advertise page's tiers at the category's current price (set here by an admin override, which
// is audited), proof on the owner page from real counts, and testimonials that show only after
// staff approve them. Each test and project uses categories no other spec touches.

// Not ended in afterAll: with fullyParallel a worker can run this file's tests after another
// test's afterAll, and the runner ends the worker anyway.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
const harbor = 'http://harborpoint.test';
const pine = 'http://pinehollow.test';
const SOURCE = 'test-revenue';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const CATEGORIES = {
  desktop: {
    harbor: 'fitness',
    pine: 'automotive',
    owner: 'banks-and-finance',
    price: 'entertainment',
  },
  mobile: {
    harbor: 'hotels',
    pine: 'shopping',
    owner: 'personal-services',
    price: 'childcare-and-education',
  },
} as const;
const categoriesFor = (project: string) => CATEGORIES[project === 'mobile' ? 'mobile' : 'desktop'];

async function townOf(slug: string) {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  return town!;
}

async function cleanup(townId: string, category: string) {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.category, category),
        eq(businesses.dataSource, SOURCE),
      ),
    );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(placements).where(inArray(placements.businessId, ids));
    await db.delete(slotStatsDaily).where(inArray(slotStatsDaily.businessId, ids));
    await db.delete(businessTestimonials).where(inArray(businessTestimonials.businessId, ids));
  }
  await db
    .delete(directoryWaitlist)
    .where(and(eq(directoryWaitlist.townId, townId), eq(directoryWaitlist.category, category)));
  await db
    .delete(directoryPrices)
    .where(and(eq(directoryPrices.townId, townId), eq(directoryPrices.category, category)));
  await db
    .delete(priceChanges)
    .where(and(eq(priceChanges.townId, townId), eq(priceChanges.category, category)));
  if (ids.length) await db.delete(businesses).where(inArray(businesses.id, ids));
}

/** Sells all three featured spots in a category to listings of our own. */
async function sellOut(townId: string, category: string) {
  const sold = await db
    .insert(businesses)
    .values(
      [1, 2, 3].map((i) => ({
        townId,
        slug: `rev-${category}-${i}`,
        name: `Revenue ${category} ${i}`,
        category,
        dataSource: SOURCE,
        // Inventory counts placements; inactive sellers keep other specs' listing counts as-is.
        active: false,
      })),
    )
    .returning();
  await db.insert(placements).values(
    sold.map((b, i) => ({
      businessId: b.id,
      townId,
      product: 'sponsored_slot' as const,
      category,
      rank: i + 1,
      status: 'active' as const,
      startsAt: new Date(Date.now() - 86_400_000),
    })),
  );
}

async function staffPage(browser: Browser) {
  const context = await browser.newContext();
  const [member] = await db
    .insert(staff)
    .values({
      email: `revenue-${Date.now()}-${randomBytes(3).toString('hex')}@towncore.net`,
      name: 'Revenue admin',
      role: 'admin',
    })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_admin', value: token, url: 'http://admin.test/admin' }]);
  return { context, page: await context.newPage(), staffId: member!.id };
}

async function ownerSession(context: BrowserContext, townId: string, host: string, email: string) {
  const token = randomBytes(24).toString('base64url');
  await db.insert(ownerSessions).values({
    townId,
    email,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_owner', value: token, url: `${host}/` }]);
}

test('category pages count the open featured spots, then offer the waitlist when all are sold', async ({
  page,
}, info) => {
  const cats = categoriesFor(info.project.name);
  for (const [slug, host, category] of [
    ['harbor-point', harbor, cats.harbor],
    ['pine-hollow', pine, cats.pine],
  ] as const) {
    const town = await townOf(slug);
    await cleanup(town.id, category);
    await page.goto(`${host}/directory/${category}`);
    const spots = page.getByTestId('spots-open');
    await expect(spots).toContainText('3 of 3 featured spots open in');
    // Harbor Point and Pine Hollow set $19/$12/$7: the cheapest open spot.
    await expect(spots.getByRole('link', { name: 'From $7 a month' })).toBeVisible();
    await expect(page.getByTestId('waitlist-form')).toHaveCount(0);

    await sellOut(town.id, category);
    await page.goto(`${host}/directory/${category}`);
    await expect(page.getByTestId('spots-open')).toContainText('All 3 featured spots in');
    const form = page.getByTestId('waitlist-form');
    await form.getByLabel('Get notified when a spot opens').fill(`waiting@${slug}.test`);
    await form.getByRole('checkbox').dispatchEvent('click');
    await expect(form.getByRole('checkbox')).toBeChecked();
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(page.getByTestId('waitlist-status')).toContainText('You’re on the waitlist');
    const [entry] = await db
      .select()
      .from(directoryWaitlist)
      .where(and(eq(directoryWaitlist.townId, town.id), eq(directoryWaitlist.category, category)));
    expect(entry).toMatchObject({
      email: `waiting@${slug}.test`,
      source: 'category',
      status: 'waiting',
    });

    // The advertise page says the same, with its own waitlist.
    await page.goto(`${host}/advertise?category=${category}`);
    await expect(page.getByTestId('advertise-category')).toContainText('all taken right now');
    await expect(page.getByTestId('waitlist-form')).toBeVisible();
    // The sponsored labels stay in the locked style everywhere.
    await page.goto(`${host}/directory/${category}`);
    for (const label of await page
      .locator('[data-fill="campaign"] [data-testid="slot-label"]')
      .all())
      await expect(label).toContainText('Sponsored');
    await cleanup(town.id, category);
  }
});

test('an admin override sets a category price; the advertise page and its house ads show it', async ({
  page,
  browser,
}, info) => {
  const category = categoriesFor(info.project.name).price;
  const town = await townOf('harbor-point');
  await cleanup(town.id, category);

  // Without a category, the tiers show the town's list prices beside the premium option.
  await page.goto(`${harbor}/advertise`);
  await expect(page.getByTestId('tier-1')).toContainText('$19');
  await expect(page.getByTestId('tier-3')).toContainText('$7');
  await expect(page.getByTestId('tier-premium')).toContainText('Category sponsor');
  await expect(page.getByTestId('cancel-anytime')).toHaveAttribute('href', '/owner');
  // Fewer than 5 advertisers and 250 readers in tests: no proof line rather than a thin one.
  await expect(page.getByTestId('advertise-proof')).toHaveCount(0);

  const admin = await staffPage(browser);
  await admin.page.goto(`http://admin.test/admin/directory/pricing?town=${town.id}`);
  const form = admin.page.getByTestId('price-override');
  await form.getByRole('combobox', { name: 'Category', exact: true }).selectOption(category);
  await form.getByRole('combobox', { name: 'Offer', exact: true }).selectOption('sponsored_slot:1');
  await form.getByLabel('Dollars a month').fill('23');
  await form.getByLabel('Why').fill('e2e: demand test');
  await form.getByRole('button', { name: 'Set price for new bookings' }).click();
  await expect(admin.page.getByRole('status')).toHaveText('Price set for new bookings');
  await expect(admin.page.getByTestId('price-history')).toContainText('$19 → $23');
  const [audit] = await db
    .select()
    .from(adminActions)
    .where(
      and(
        eq(adminActions.action, 'directory.price.override'),
        eq(adminActions.staffId, admin.staffId),
      ),
    );
  expect(audit?.detail).toMatchObject({ category, oldCents: 1900, newCents: 2300 });
  await admin.context.close();

  await page.goto(`${harbor}/advertise?category=${category}`);
  await expect(page.getByTestId('tier-1')).toContainText('$23');
  await expect(page.getByTestId('tier-2')).toContainText('$12');
  // The category's Top spot house ad sells #1 at its current price.
  await page.goto(`${harbor}/directory/${category}`);
  const topspot = page.locator('[data-slot="directory.topspot"]');
  await expect(topspot).toHaveAttribute('data-fill', 'house');
  await expect(topspot).toContainText('$23 a month');
  // Other categories keep the list price.
  await page.goto(`${harbor}/advertise`);
  await expect(page.getByTestId('tier-1')).toContainText('$19');
  await cleanup(town.id, category);
});

test('the owner page shows real proof, the waitlist when sold out, and testimonials after review', async ({
  page,
  context,
  browser,
}, info) => {
  const category = categoriesFor(info.project.name).owner;
  const town = await townOf('pine-hollow');
  await cleanup(town.id, category);
  const email = `owner-${info.project.name}@revenue.test`;
  const [listing] = await db
    .insert(businesses)
    .values({
      townId: town.id,
      slug: `rev-owner-${info.project.name}`,
      name: `Revenue Owner ${info.project.name}`,
      category,
      dataSource: SOURCE,
      active: true,
      claimedAt: new Date(Date.now() - 60 * 86_400_000),
      claimedByEmail: email,
    })
    .returning();
  await ownerSession(context, town.id, pine, email);

  await page.goto(`${pine}/owner/${listing!.slug}`);
  await expect(page.getByTestId('owner-proof-line')).toContainText('Not enough data yet');
  // Real views: the personal line appears.
  await db.insert(slotStatsDaily).values({
    townId: town.id,
    day: new Date().toISOString().slice(0, 10),
    slot: 'directory.business.cta',
    businessId: listing!.id,
    impressions: 214,
  });
  await page.reload();
  await expect(page.getByTestId('owner-proof-line')).toHaveText(
    'Your listing was seen 214 times in the last 30 days.',
  );
  await expect(page.getByTestId('owner-cancel')).toContainText('Cancel anytime');

  // Every spot sold: the owner joins the waitlist in one click.
  await sellOut(town.id, category);
  await page.reload();
  const waitlist = page.getByTestId('owner-waitlist');
  await waitlist.getByRole('button', { name: 'Email me when a spot opens' }).click();
  await expect(page.getByTestId('owner-payment')).toContainText('You’re on the waitlist');
  await expect(page.getByTestId('owner-waitlist')).toContainText('You’re on the waitlist');
  const [entry] = await db
    .select()
    .from(directoryWaitlist)
    .where(and(eq(directoryWaitlist.townId, town.id), eq(directoryWaitlist.category, category)));
  expect(entry).toMatchObject({ businessId: listing!.id, source: 'owner' });

  // An advertiser writes a testimonial; it shows on /advertise only once staff approve it.
  await db.insert(placements).values({
    businessId: listing!.id,
    townId: town.id,
    product: 'enhanced',
    status: 'active',
    startsAt: new Date(),
  });
  await page.reload();
  const quote = `Readers found us through the directory every week (${info.project.name}).`;
  const section = page.getByTestId('owner-testimonial');
  await section.getByRole('textbox').fill(quote);
  // The phone's sticky bar can sit over the box; a click event checks it all the same.
  await section.getByRole('checkbox').dispatchEvent('click');
  await expect(section.getByRole('checkbox')).toBeChecked();
  await section.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByTestId('owner-payment')).toContainText('Our staff check it');
  await page.goto(`${pine}/advertise`);
  await expect(page.getByText(quote)).toHaveCount(0);

  const admin = await staffPage(browser);
  await admin.page.goto('http://admin.test/admin/directory');
  await admin.page
    .getByTestId('testimonials-waiting')
    .getByRole('row', { name: new RegExp(info.project.name) })
    .getByRole('button', { name: 'Approve testimonial' })
    .click();
  await expect(admin.page.getByRole('status')).toHaveText('Testimonial approved');
  await admin.context.close();
  await page.goto(`${pine}/advertise`);
  await expect(page.getByTestId('testimonials')).toContainText(quote);
  await cleanup(town.id, category);
});
