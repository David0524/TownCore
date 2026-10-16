import { createHash, createHmac, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  businesses,
  campaigns,
  createDb,
  eq,
  ownerSessions,
  placements,
  staff,
  staffSessions,
  stripeEvents,
  stripePrices,
  towns,
} from '@towncore/db';
import { E2E_STRIPE_WEBHOOK_SECRET } from './newsletter-secret';

// Stripe (M6 PR D), test mode. No request reaches Stripe here: the webhook is exercised with
// events signed the way Stripe signs them (t=…,v1=HMAC-SHA256 of "t.payload"), and the owner
// page with prices recorded in the database.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1 });
const webhook = 'http://127.0.0.1:3100/api/stripe/webhook';
const sign = (payload: string, secret = E2E_STRIPE_WEBHOOK_SECRET) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
};
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await db.$client.end();
});

test('the webhook takes signed events once, refuses others, and lives on the admin host', async ({
  request,
}, info) => {
  const id = `evt_e2e_${info.project.name}_${Date.now()}`;
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: 'invoice.paid',
    livemode: false,
    data: { object: { id: 'in_e2e' } },
  });
  const post = (headers: Record<string, string>, host = 'admin.test') =>
    request.post(webhook, {
      headers: { host, 'content-type': 'application/json', ...headers },
      data: payload,
    });

  expect((await post({})).status()).toBe(400);
  expect((await post({ 'stripe-signature': sign(payload, 'whsec_wrong') })).status()).toBe(400);
  const ok = await post({ 'stripe-signature': sign(payload) });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ received: true, result: 'ignored' });
  expect(await (await post({ 'stripe-signature': sign(payload) })).json()).toEqual({
    received: true,
    result: 'duplicate',
  });
  expect(await db.select().from(stripeEvents).where(eq(stripeEvents.id, id))).toHaveLength(1);
  // A town site has no webhook.
  expect((await post({ 'stripe-signature': sign(payload) }, 'harborpoint.test')).status()).toBe(
    404,
  );
});

test('a signed checkout.session.completed turns the owner’s placement on', async ({
  request,
  page,
  context,
}, info) => {
  // One listing, so one project: this flow doesn't depend on the screen size.
  test.skip(info.project.name !== 'desktop', 'runs once, on desktop');
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
  // Restaurants: the claims spec works on roofers and the directory spec on plumbers.
  const slug = 'harbor-light-chowder-house-test0008';
  const [listing] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.townId, town!.id), eq(businesses.slug, slug)));
  const email = `owner-${info.project.name}@chowder.test`;
  await db.delete(placements).where(eq(placements.businessId, listing!.id));
  await db
    .update(businesses)
    .set({ claimedAt: new Date(), claimedByEmail: email })
    .where(eq(businesses.id, listing!.id));
  for (const [product, cents] of [
    ['enhanced', 1900],
    ['sponsored_slot', 9900],
  ] as const) {
    await db
      .insert(stripePrices)
      .values({
        townId: town!.id,
        product,
        stripeProductId: `prod_e2e_${product}`,
        stripePriceId: `price_e2e_${product}`,
        unitAmountCents: cents,
      })
      .onConflictDoNothing();
  }
  // A Checkout the owner started (Stripe itself isn't called in e2e).
  const sessionId = `cs_e2e_${info.project.name}_${Date.now()}`;
  const [placement] = await db
    .insert(placements)
    .values({
      businessId: listing!.id,
      townId: town!.id,
      product: 'sponsored_slot',
      category: 'restaurants',
      status: 'pending',
      stripeCheckoutSessionId: sessionId,
      buyerEmail: email,
    })
    .returning();
  const payload = JSON.stringify({
    id: `evt_${sessionId}`,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'subscription',
        client_reference_id: placement!.id,
        metadata: { placement_id: placement!.id },
        subscription: `sub_${sessionId}`,
        customer: 'cus_e2e',
      },
    },
  });
  const response = await request.post(webhook, {
    headers: {
      host: 'admin.test',
      'content-type': 'application/json',
      'stripe-signature': sign(payload),
    },
    data: payload,
  });
  expect(await response.json()).toEqual({ received: true, result: 'processed' });
  const [after] = await db.select().from(placements).where(eq(placements.id, placement!.id));
  expect(after).toMatchObject({ status: 'active', stripeSubscriptionId: `sub_${sessionId}` });

  // The owner sees it, and the products they can still buy.
  const token = randomBytes(24).toString('base64url');
  await db.insert(ownerSessions).values({
    townId: town!.id,
    email,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_owner', value: token, url: 'http://harborpoint.test/' }]);
  await page.goto(`http://harborpoint.test/owner/${slug}`);
  const promote = page.getByTestId('promote');
  await expect(promote).toContainText('Sponsored slot · $99/month');
  await expect(page.getByTestId('placement-sponsored_slot')).toContainText('Active');
  await expect(promote.getByRole('button', { name: 'Buy enhanced listing' })).toBeVisible();

  await db.delete(placements).where(eq(placements.id, placement!.id));
  await db
    .update(businesses)
    .set({ claimedAt: null, claimedByEmail: null })
    .where(eq(businesses.id, listing!.id));
});

test('a paid sponsor card goes live only after staff approve it; Enhanced is labeled', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once, on desktop');
  const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
  const slug = 'harbor-light-chowder-house-test0008';
  const [listing] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.townId, town!.id), eq(businesses.slug, slug)));
  const email = 'owner-card@chowder.test';
  await db.delete(campaigns).where(eq(campaigns.category, 'restaurants'));
  await db.delete(placements).where(eq(placements.businessId, listing!.id));
  await db
    .update(businesses)
    .set({ claimedAt: new Date(), claimedByEmail: email, phone: '(207) 555-0177' })
    .where(eq(businesses.id, listing!.id));
  await db.insert(placements).values([
    {
      businessId: listing!.id,
      townId: town!.id,
      product: 'sponsored_slot',
      category: 'restaurants',
      status: 'active',
      stripeSubscriptionId: `sub_card_${Date.now()}`,
      buyerEmail: email,
    },
    {
      businessId: listing!.id,
      townId: town!.id,
      product: 'enhanced',
      status: 'active',
      stripeSubscriptionId: `sub_enh_${Date.now()}`,
      buyerEmail: email,
    },
  ]);

  // The owner writes the card.
  const token = randomBytes(24).toString('base64url');
  await db.insert(ownerSessions).values({
    townId: town!.id,
    email,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_owner', value: token, url: 'http://harborpoint.test/' }]);
  await page.goto(`http://harborpoint.test/owner/${slug}`);
  const card = page.getByTestId('sponsor-card');
  await card.getByRole('textbox', { name: 'Headline' }).fill('Chowder made fresh every morning');
  await card
    .getByRole('textbox', { name: 'Short text (optional)' })
    .fill('On the wharf since 1952.');
  await card.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByTestId('card-waiting')).toContainText('Chowder made fresh every morning');

  // Not live yet: the category still shows the house ad.
  await page.goto('http://harborpoint.test/directory/restaurants');
  await expect(page.getByTestId('sponsored-cards')).toHaveCount(0);
  await expect(page.locator('[data-slot="directory.category.top"]')).toHaveAttribute(
    'data-fill',
    'house',
  );

  // Staff approve it.
  const staffContext = await browser.newContext();
  const [member] = await db
    .insert(staff)
    .values({ email: `cards-${Date.now()}@towncore.net`, name: 'Card reviewer', role: 'admin' })
    .returning();
  const staffToken = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(staffToken),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await staffContext.addCookies([
    { name: 'tc_admin', value: staffToken, url: 'http://admin.test/admin' },
  ]);
  const adminPage = await staffContext.newPage();
  await adminPage.goto('http://admin.test/admin/directory');
  const row = adminPage
    .getByTestId('cards-waiting')
    .getByRole('row', { name: /Chowder made fresh every morning/ });
  await row.getByRole('button', { name: 'Approve card' }).click();
  await expect(adminPage.getByRole('status')).toHaveText('Card approved and live');
  await staffContext.close();

  // Live: labeled Sponsored, linking to the listing; Enhanced is labeled in place.
  await page.goto('http://harborpoint.test/directory/restaurants');
  const sponsored = page.getByTestId('sponsored-cards').locator('[data-slot]');
  await expect(sponsored).toHaveCount(1);
  await expect(sponsored).toHaveAttribute('data-fill', 'campaign');
  await expect(sponsored.getByTestId('slot-label')).toHaveText(
    'Sponsored · Harbor Light Chowder House',
  );
  await expect(sponsored.getByRole('link')).toHaveAttribute(
    'href',
    `/directory/restaurants/${slug}`,
  );
  const organic = page.locator('section[aria-labelledby="organic"]');
  await expect(organic).toContainText('Enhanced (paid)');
  await expect(organic).toContainText('(207) 555-0177');

  await db.delete(campaigns).where(eq(campaigns.category, 'restaurants'));
  await db.delete(placements).where(eq(placements.businessId, listing!.id));
  await db
    .update(businesses)
    .set({ claimedAt: null, claimedByEmail: null, phone: null })
    .where(eq(businesses.id, listing!.id));
});
