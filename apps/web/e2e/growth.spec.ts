import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  adminActions,
  and,
  businessFollowups,
  businesses,
  campaigns,
  createDb,
  eq,
  inArray,
  leads,
  mailDomains,
  ownerSessions,
  placements,
  staff,
  staffSessions,
  stripePrices,
  towns,
} from '@towncore/db';
import { E2E_MAIL_TOKEN_SECRET, E2E_STRIPE_WEBHOOK_SECRET } from './newsletter-secret';
import { DIRECT, FAKE_STRIPE } from './ports';

// Traffic and self-serve revenue (owner, 2026-10-17), in Stripe test mode against the local fake
// Stripe (e2e/fake-stripe.mjs): a featured spot with the first month free from a house ad,
// Enhanced with its trial from the owner portal, a booked morning-email week and category month
// whose card runs only after staff approve it, the proof report's "what a featured spot would
// add", the follow-ups' standing approval, and the owners' unsubscribe link. Each project works
// on its own listings in categories no other spec uses, on Harbor Point and Pine Hollow.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const harbor = 'http://harborpoint.test';
const pine = 'http://pinehollow.test';
const app = DIRECT;
const fakeStripe = FAKE_STRIPE;
const SOURCE = 'test-growth';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const sign = (payload: string) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', E2E_STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
};
const ownerToken = (businessId: string) =>
  `${businessId}~${createHmac('sha256', E2E_MAIL_TOKEN_SECRET).update(`owner-mail\n${businessId}`).digest('base64url')}`;

/** Categories nobody else touches, per project, so inventory never clashes. */
const CATEGORIES = {
  desktop: { harbor: 'electricians', pine: 'hvac', report: 'pool-and-spa' },
  mobile: { harbor: 'solar', pine: 'roofers', report: 'alarm-systems' },
} as const;
const categoriesFor = (project: string) => CATEGORIES[project === 'mobile' ? 'mobile' : 'desktop'];

async function townId(slug: string) {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  return town!.id;
}

/** A claimed listing of our own, and an owner session for its town. */
async function ownListing(
  context: BrowserContext,
  input: { town: string; host: string; category: string; slug: string; name: string },
) {
  const id = await townId(input.town);
  const email = `owner@${input.slug}.test`;
  await cleanup([input.slug]);
  const [listing] = await db
    .insert(businesses)
    .values({
      townId: id,
      slug: input.slug,
      name: input.name,
      category: input.category,
      licenseVerified: true,
      dataSource: SOURCE,
      active: true,
      claimedAt: new Date(Date.now() - 40 * 86_400_000),
      claimedByEmail: email,
    })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(ownerSessions).values({
    townId: id,
    email,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_owner', value: token, url: `${input.host}/` }]);
  return { townId: id, listing: listing!, email };
}

async function cleanup(slugs: string[]) {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.dataSource, SOURCE), inArray(businesses.slug, slugs)));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  const held = await db
    .select({ id: placements.id })
    .from(placements)
    .where(inArray(placements.businessId, ids));
  if (held.length)
    await db.delete(campaigns).where(
      inArray(
        campaigns.placementId,
        held.map((p) => p.id),
      ),
    );
  await db.delete(placements).where(inArray(placements.businessId, ids));
  await db.delete(leads).where(inArray(leads.businessId, ids));
  await db.delete(businessFollowups).where(inArray(businessFollowups.businessId, ids));
  await db.delete(businesses).where(inArray(businesses.id, ids));
}

type FakeSession = {
  id: string;
  params: Record<string, unknown> & { metadata: Record<string, string> };
};
async function lastSession(email: string): Promise<FakeSession> {
  const all = (await (await fetch(`${fakeStripe}/__sessions`)).json()) as FakeSession[];
  const mine = all.filter((s) => s.params.customer_email === email);
  return mine.at(-1)!;
}

async function postEvent(
  request: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    id: `evt_growth_${randomBytes(6).toString('hex')}`,
    object: 'event',
    type,
    livemode: false,
    data: { object },
  });
  // Node's fetch can't set Host; Playwright's request can (the webhook lives on the admin host).
  const response = await request.post(`${app}/api/stripe/webhook`, {
    headers: {
      host: 'admin.test',
      'content-type': 'application/json',
      'stripe-signature': sign(payload),
    },
    data: payload,
  });
  expect(await response.json()).toEqual({ received: true, result: 'processed' });
}

async function staffPage(browser: Browser, role: 'admin' | 'reviewer') {
  const context = await browser.newContext();
  const [member] = await db
    .insert(staff)
    .values({ email: `growth-${role}-${Date.now()}@towncore.net`, name: `Growth ${role}`, role })
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

test('from a house ad: a featured spot with the first month free, then Enhanced with its trial', async ({
  page,
  context,
  request,
}, info) => {
  const category = categoriesFor(info.project.name).harbor;
  const slug = `growth-spark-${info.project.name}`;
  const {
    townId: harborId,
    listing,
    email,
  } = await ownListing(context, {
    town: 'harbor-point',
    host: harbor,
    category,
    slug,
    name: `Spark Works ${info.project.name}`,
  });
  for (const [product, rank, cents] of [
    ['enhanced', null, 1900],
    ['sponsored_slot', 1, 1900],
    ['sponsored_slot', 2, 1200],
    ['sponsored_slot', 3, 700],
  ] as const)
    await db
      .insert(stripePrices)
      .values({
        townId: harborId,
        product,
        rank,
        stripeProductId: `prod_e2e_${product}_${rank ?? 0}`,
        stripePriceId: `price_e2e_${product}_${rank ?? 0}`,
        unitAmountCents: cents,
      })
      .onConflictDoNothing();

  // The category's Top spot house ad leads to the offer, then to the owner page.
  await page.goto(`${harbor}/directory/${category}`);
  const topspot = page.locator('[data-slot="directory.topspot"]');
  await expect(topspot).toHaveAttribute('data-fill', 'house');
  await topspot.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/advertise\\?category=${category}$`));
  await expect(page.getByTestId('advertise-category')).toContainText('#1, #2, #3 open');
  await expect(page.getByTestId('advertise-bookings')).toContainText('$89 a month');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: listing.name }).click();
  await expect(page).toHaveURL(`${harbor}/owner/${slug}`);

  // Spot #1, first 30 days free: Checkout (the fake Stripe) gets the trial and spot #1's price.
  await page.getByRole('button', { name: 'Get spot #1 free for 30 days' }).click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  const spot = await lastSession(email);
  expect(spot.params).toMatchObject({
    mode: 'subscription',
    line_items: [{ price: 'price_e2e_sponsored_slot_1', quantity: '1' }],
    subscription_data: { trial_period_days: '30' },
  });
  const placementId = spot.params.metadata.placement_id!;
  // Stripe confirms; the webhook turns the spot on and records when the trial ends.
  await postEvent(request, 'checkout.session.completed', {
    id: spot.id,
    object: 'checkout.session',
    mode: 'subscription',
    client_reference_id: placementId,
    metadata: { placement_id: placementId },
    subscription: `sub_${spot.id}`,
    customer: `cus_${spot.id}`,
  });
  const trialEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
  await postEvent(request, 'customer.subscription.updated', {
    id: `sub_${spot.id}`,
    object: 'subscription',
    status: 'trialing',
    customer: `cus_${spot.id}`,
    metadata: { placement_id: placementId },
    trial_end: trialEnd,
    cancel_at_period_end: false,
    items: { data: [] },
  });
  const [on] = await db.select().from(placements).where(eq(placements.id, placementId));
  expect(on).toMatchObject({ status: 'active', rank: 1 });
  expect(on!.trialEndsAt!.getTime()).toBe(trialEnd * 1000);

  // Back on the portal: the spot is active, and Enhanced comes with its own free month.
  await page.goto(`${harbor}/owner/${slug}`);
  await expect(page.getByTestId('placement-sponsored_slot')).toContainText('Active');
  await page.getByRole('button', { name: 'Buy enhanced listing free for 30 days' }).click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  expect((await lastSession(email)).params).toMatchObject({
    mode: 'subscription',
    line_items: [{ price: 'price_e2e_enhanced_0' }],
    subscription_data: { trial_period_days: '30' },
  });
  await cleanup([slug]);
});

test('Pine Hollow: book a morning-email week and a category month; the card runs once approved', async ({
  page,
  context,
  browser,
  request,
}, info) => {
  const category = categoriesFor(info.project.name).pine;
  const slug = `growth-heat-${info.project.name}`;
  const { listing, email } = await ownListing(context, {
    town: 'pine-hollow',
    host: pine,
    category,
    slug,
    name: `Pine Heat ${info.project.name}`,
  });
  await page.goto(`${pine}/owner/${slug}`);
  const week = page.getByTestId('booking-newsletter');
  await expect(week).toContainText('Newsletter sponsorship · $45 a week');
  await expect(page.getByTestId('booking-exclusive')).toContainText(
    'Category sponsorship · $75 a month',
  );
  // Only open weeks are offered; each project books a different one.
  const select = week.getByRole('combobox', { name: 'Week' });
  const options = await select
    .locator('option')
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(options.length).toBeGreaterThan(1);
  const period = options[info.project.name === 'mobile' ? 1 : 0]!;
  await select.selectOption(period);
  await week.getByRole('button', { name: 'Book a week for $45' }).click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  const booking = await lastSession(email);
  expect(booking.params).toMatchObject({
    mode: 'payment',
    line_items: [{ quantity: '1', price_data: { currency: 'usd', unit_amount: '4500' } }],
    metadata: { product: 'newsletter', period },
  });
  const placementId = booking.params.metadata.placement_id!;
  await postEvent(request, 'checkout.session.completed', {
    id: booking.id,
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    client_reference_id: placementId,
    metadata: { placement_id: placementId },
    customer: `cus_${booking.id}`,
  });

  // The owner writes the card for that week; it waits for staff.
  await page.goto(`${pine}/owner/${slug}`);
  const booked = page.getByTestId('booking-newsletter').getByTestId('booking');
  await expect(booked).toContainText('Booked. Write your card below');
  await booked.getByRole('textbox', { name: 'Headline' }).fill('Furnace tune-ups this week');
  await booked.getByRole('button', { name: 'Send card for review' }).click();
  await expect(page.getByTestId('owner-payment')).toContainText('waiting for review');
  // The week is gone from the choices.
  await expect(
    page.getByTestId('booking-newsletter').locator(`option[value="${period}"]`),
  ).toHaveCount(0);

  // Staff approve it: it runs in the newsletter's top slot for that week only.
  const admin = await staffPage(browser, 'admin');
  await admin.page.goto('http://admin.test/admin/directory');
  await admin.page
    .getByTestId('cards-waiting')
    .getByRole('row', { name: /Furnace tune-ups this week/ })
    .getByRole('button', { name: 'Approve card' })
    .click();
  await expect(admin.page.getByRole('status')).toHaveText('Card approved and live');
  await admin.context.close();
  const [card] = await db.select().from(campaigns).where(eq(campaigns.placementId, placementId));
  expect(card).toMatchObject({ slot: 'newsletter.top', status: 'active', category: null });
  expect(card!.startsAt.getTime()).toBeGreaterThan(Date.now());
  await page.goto(`${pine}/owner/${slug}`);
  await expect(page.getByTestId('booking-newsletter')).toContainText(
    'Card approved: Furnace tune-ups this week',
  );

  // A category month is booked the same way, at its own price.
  await page
    .getByTestId('booking-exclusive')
    .getByRole('button', { name: 'Book a month for $75' })
    .click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  expect((await lastSession(email)).params).toMatchObject({
    mode: 'payment',
    line_items: [{ price_data: { unit_amount: '7500' } }],
    metadata: { product: 'exclusive', category },
  });
  void listing;
  await cleanup([slug]);
});

test('an owner without a featured spot sees the quote requests that went elsewhere', async ({
  page,
  context,
}, info) => {
  const category = categoriesFor(info.project.name).report;
  for (const [town, host] of [
    ['harbor-point', harbor],
    ['pine-hollow', pine],
  ] as const) {
    const slug = `growth-report-${town}-${info.project.name}`;
    const { townId: id, listing } = await ownListing(context, {
      town,
      host,
      category,
      slug,
      name: `Report Co ${info.project.name}`,
    });
    // A reader's quote request in the category went to a featured business (here, by fiat).
    await db.insert(leads).values({
      businessId: listing.id,
      kind: 'form',
      townId: id,
      slot: 'directory.quote-request',
      requestId: crypto.randomUUID(),
      meta: { category },
    });
    await page.goto(`${host}/owner/${slug}/report`);
    const featured = page.getByTestId('report-featured');
    await expect(
      featured.getByRole('heading', { name: 'What a featured spot would add' }),
    ).toBeVisible();
    await expect(page.getByTestId('report-missed')).toContainText('1 quote request for');
    await expect(page.getByTestId('report-missed')).toContainText(
      'went to businesses with a featured spot',
    );
    // Too little network data in tests: it says so instead of inventing a number.
    await expect(page.getByTestId('report-basis')).toContainText('Not enough data yet');
    await expect(featured.getByRole('link', { name: 'See open spots and prices' })).toBeVisible();
    await cleanup([slug]);
  }
});

test('follow-ups wait for staff until an admin turns on the standing approval', async ({
  browser,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'admin page, runs once');
  const slug = 'growth-followup';
  const { townId: harborId, listing } = await ownListing(context, {
    town: 'harbor-point',
    host: harbor,
    category: 'caterers',
    slug,
    name: 'Followup Catering',
  });
  // Mail from Harbor Point goes to the log in tests (the stripe spec relies on the same row).
  await db
    .insert(mailDomains)
    .values({
      name: 'harborpoint.test',
      townId: harborId,
      displayName: 'The Harbor Point Ledger',
      status: 'live',
    })
    .onConflictDoNothing();
  await db.update(towns).set({ businessMailApprovedAt: null }).where(eq(towns.id, harborId));
  await db.insert(businessFollowups).values({
    townId: harborId,
    businessId: listing.id,
    kind: 'nearby_claim',
    dedupeKey: `e2e:${Date.now()}`,
    toEmail: 'owner@growth-followup.test',
    subject: 'Another caterer near you joined The Harbor Point Ledger',
    lines: ['Another caterer in Harbor Point just claimed its listing.'],
    linkHref: `${harbor.replace('http:', 'https:')}/owner/${slug}`,
    linkLabel: 'Update your listing',
  });

  // A reviewer sees the switch but can't change it.
  const reviewer = await staffPage(browser, 'reviewer');
  await reviewer.page.goto('http://admin.test/admin/directory');
  const reviewerRow = reviewer.page
    .getByTestId('followup-approvals')
    .getByRole('row', { name: /Harbor Point/ });
  await expect(reviewerRow).toContainText('Off: staff press Send');
  await expect(reviewerRow).toContainText('Admins only');
  await reviewer.context.close();

  const admin = await staffPage(browser, 'admin');
  await admin.page.goto('http://admin.test/admin/directory');
  await admin.page
    .getByRole('button', { name: 'Turn on automatic follow-ups in Harbor Point' })
    .click();
  await expect(admin.page.getByRole('status')).toHaveText(
    'Follow-ups now send automatically in this town',
  );
  await expect(
    admin.page.getByTestId('followup-approvals').getByRole('row', { name: /Harbor Point/ }),
  ).toContainText('On since');
  await admin.page
    .getByRole('button', { name: 'Turn off automatic follow-ups in Harbor Point' })
    .click();
  await expect(admin.page.getByRole('status')).toHaveText('Automatic follow-ups are off');
  const audit = await db
    .select({ action: adminActions.action })
    .from(adminActions)
    .where(eq(adminActions.staffId, admin.staffId));
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining(['directory.followups.approve', 'directory.followups.revoke']),
  );

  // Staff press Send on the draft.
  const draft = admin.page
    .getByTestId('followup-drafts')
    .locator('form', { hasText: 'Followup Catering' });
  await draft.getByRole('button', { name: 'Send' }).click();
  await expect(admin.page.getByRole('status')).toHaveText('Follow-up sent');
  const [row] = await db
    .select()
    .from(businessFollowups)
    .where(eq(businessFollowups.businessId, listing.id));
  expect(row).toMatchObject({ status: 'sent', sentBy: admin.staffId });
  await admin.context.close();
  await cleanup([slug]);
});

test('the unsubscribe link in reports and follow-ups stops them, with one click', async ({
  page,
  context,
  request,
}, info) => {
  const slug = `growth-stop-${info.project.name}`;
  const { listing } = await ownListing(context, {
    town: 'pine-hollow',
    host: pine,
    category: 'caterers',
    slug,
    name: `Stop Catering ${info.project.name}`,
  });
  const token = ownerToken(listing.id);
  await page.goto(`${pine}/owner/stop/${token}`);
  await expect(page.getByRole('heading', { name: `Emails about ${listing.name}` })).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByTestId('owner-stopped')).toContainText('won’t send monthly reports');
  const [after] = await db.select().from(businesses).where(eq(businesses.id, listing.id));
  expect(after!.ownerMailOptOutAt).not.toBeNull();
  // A forged token is refused.
  expect(
    (
      await request.post(`${app}/api/owner/unsubscribe/${listing.id}~forged`, {
        headers: { host: 'pinehollow.test' },
        form: { 'List-Unsubscribe': 'One-Click' },
      })
    ).status(),
  ).toBe(404);
  // The RFC 8058 one-click POST works without a session.
  await db.update(businesses).set({ ownerMailOptOutAt: null }).where(eq(businesses.id, listing.id));
  const oneClick = await request.post(`${app}/api/owner/unsubscribe/${token}`, {
    headers: { host: 'pinehollow.test' },
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(oneClick.status()).toBe(200);
  const [again] = await db.select().from(businesses).where(eq(businesses.id, listing.id));
  expect(again!.ownerMailOptOutAt).not.toBeNull();
  await cleanup([slug]);
});
