import {
  businesses,
  eq,
  placements,
  stripeEvents,
  stripePrices,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyPricePlan,
  handleStripeEvent,
  isLiveKey,
  openFeaturedRanks,
  LiveModeRefused,
  placementStatusFor,
  placesLeft,
  planPrices,
  startCheckout,
  stripeClient,
} from '../src';

// Stripe in test mode (M6 PR D) against a fake client: no network. Event payloads follow the
// shapes of Stripe API version 2026-09-30 (stripe-node 23), where a subscription's period end
// is on its items.

const created: Array<Record<string, unknown>> = [];
const sessions: Array<Record<string, unknown>> = [];
let priceCounter = 0;
const fakeStripe = {
  prices: {
    list: async () => ({ data: [] }),
    create: async (params: Record<string, unknown>) => {
      created.push(params);
      return { id: `price_${++priceCounter}`, product: `prod_${priceCounter}`, livemode: false };
    },
  },
  checkout: {
    sessions: {
      create: async (params: Record<string, unknown>) => {
        sessions.push(params);
        return {
          id: `cs_test_${sessions.length}`,
          url: `https://checkout.stripe.test/${sessions.length}`,
        };
      },
    },
  },
} as unknown as Stripe;

let n = 0;
const event = (type: string, object: Record<string, unknown>) =>
  ({ id: `evt_${++n}`, type, livemode: false, data: { object } }) as unknown as Stripe.Event;

describe('Stripe for the directory', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  const now = new Date('2026-10-16T12:00:00Z');
  const owner = (i: number) => `owner${i}@shop.test`;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'paytown',
        name: 'Paytown',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'paytown.test',
        siteName: 'The Paytown Post',
        tier: 'small',
        config: { pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39, free_trial_days: 30 } },
      })
      .returning();
    townId = town!.id;
    // Five claimed plumbers, one per owner.
    await db.insert(businesses).values(
      [1, 2, 3, 4, 5].map((i) => ({
        townId,
        slug: `plumber-${i}`,
        name: `Plumber ${i}`,
        category: 'plumbers',
        dataSource: 'fl-dbpr',
        licenseNumber: `P${i}`,
        claimedAt: now,
        claimedByEmail: owner(i),
      })),
    );
  });
  afterAll(async () => drop());

  it('refuses live keys (D-M6-5)', () => {
    expect(isLiveKey('sk_live_abc')).toBe(true);
    expect(isLiveKey('rk_live_abc')).toBe(true);
    expect(isLiveKey('sk_test_abc')).toBe(false);
    expect(() => stripeClient('sk_live_abc')).toThrow(LiveModeRefused);
    expect(stripeClient(undefined)).toBeNull();
  });

  it('plans and creates one monthly price per product and featured spot, idempotently', async () => {
    const plan = await planPrices(db);
    expect(plan.map((p) => [p.product, p.rank, p.amountCents, p.action])).toEqual([
      ['enhanced', null, 3900, 'create'],
      ['sponsored_slot', 1, 1900, 'create'],
      ['sponsored_slot', 2, 1200, 'create'],
      ['sponsored_slot', 3, 700, 'create'],
    ]);
    await applyPricePlan(db, fakeStripe, plan);
    expect(created[1]).toMatchObject({
      currency: 'usd',
      unit_amount: 1900,
      recurring: { interval: 'month' },
      lookup_key: 'towncore:paytown:sponsored_slot:r1:1900',
      product_data: { name: 'The Paytown Post: Featured spot #1' },
      metadata: { rank: '1' },
    });
    expect((await planPrices(db)).every((p) => p.action === 'current')).toBe(true);
    // A new #1 price makes a new Price and retires the old one; #2 and #3 stay.
    await db
      .update(towns)
      .set({
        config: { pricing: { featured_usd: [25, 12, 7], enhanced_usd: 39, free_trial_days: 30 } },
      })
      .where(eq(towns.id, townId));
    await applyPricePlan(db, fakeStripe, await planPrices(db));
    const rows = await db
      .select()
      .from(stripePrices)
      .where(eq(stripePrices.product, 'sponsored_slot'));
    expect(
      rows
        .map((r) => [r.rank, r.unitAmountCents, r.active])
        .sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1])),
    ).toEqual([
      [1, 1900, false],
      [1, 2500, true],
      [2, 1200, true],
      [3, 700, true],
    ]);
  });

  const checkout = (i: number, rank: 1 | 2 | 3, at = now, slug = `plumber-${i}`) =>
    startCheckout(
      db,
      fakeStripe,
      {
        townId,
        email: owner(i),
        slug,
        product: 'sponsored_slot',
        rank,
        origin: 'https://paytown.test',
      },
      at,
    );

  it('starts Checkout only for the listing’s owner, one business per featured spot', async () => {
    expect(await checkout(1, 1, now, 'plumber-2')).toEqual({ status: 'not_owner' });
    expect(await checkout(1, 1)).toEqual({
      status: 'redirect',
      url: 'https://checkout.stripe.test/1',
    });
    expect(sessions[0]).toMatchObject({
      mode: 'subscription',
      customer_email: owner(1),
      line_items: [{ price: 'price_5', quantity: 1 }],
      success_url: 'https://paytown.test/owner/plumber-1?s=paid',
      metadata: { product: 'sponsored_slot', category: 'plumbers', rank: '1' },
      // A business's first spot: the first 30 days free.
      subscription_data: { trial_period_days: 30 },
    });
    // A started Checkout holds its spot for an hour.
    expect(await placesLeft(db, townId, 'sponsored_slot', 'plumbers', now, 1)).toBe(0);
    expect(await placesLeft(db, townId, 'sponsored_slot', 'plumbers', now)).toBe(2);
    expect(await openFeaturedRanks(db, townId, 'plumbers', now)).toEqual([2, 3]);
    expect(await checkout(2, 1)).toEqual({ status: 'sold_out' });
    await checkout(2, 2);
    await checkout(3, 3);
    expect(await checkout(4, 2)).toEqual({ status: 'sold_out' });
    // After an hour, abandoned Checkouts stop holding spots.
    expect(
      await placesLeft(
        db,
        townId,
        'sponsored_slot',
        'plumbers',
        new Date(now.getTime() + 61 * 60_000),
      ),
    ).toBe(3);
  });

  it('only a completed Checkout turns a placement on; events are handled once', async () => {
    const [p1] = await db
      .select()
      .from(placements)
      .where(eq(placements.stripeCheckoutSessionId, 'cs_test_1'));
    // The subscription often arrives first: it stays pending.
    const early = event('customer.subscription.created', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      metadata: { placement_id: p1!.id },
      cancel_at_period_end: false,
      cancel_at: null,
      ended_at: null,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    });
    expect(await handleStripeEvent(db, early, now)).toBe('processed');
    expect((await db.select().from(placements).where(eq(placements.id, p1!.id)))[0]).toMatchObject({
      status: 'pending',
    });

    const done = event('checkout.session.completed', {
      id: 'cs_test_1',
      mode: 'subscription',
      client_reference_id: p1!.id,
      metadata: { placement_id: p1!.id },
      subscription: 'sub_1',
      customer: 'cus_1',
    });
    expect(await handleStripeEvent(db, done, now)).toBe('processed');
    expect(await handleStripeEvent(db, done, now)).toBe('duplicate');
    expect((await db.select().from(placements).where(eq(placements.id, p1!.id)))[0]).toMatchObject({
      status: 'active',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
    });
    expect(await db.select().from(stripeEvents)).toHaveLength(2);
  });

  it('holds a paid placement whose spot someone else took first', async () => {
    // Owner 4 got a Checkout once the hour passed; three others are now active.
    const later = new Date(now.getTime() + 61 * 60_000);
    for (const id of ['cs_test_2', 'cs_test_3']) {
      const [p] = await db
        .select()
        .from(placements)
        .where(eq(placements.stripeCheckoutSessionId, id));
      await handleStripeEvent(
        db,
        event('checkout.session.completed', {
          id,
          mode: 'subscription',
          metadata: { placement_id: p!.id },
          subscription: `sub_${id}`,
          customer: 'cus_x',
        }),
        later,
      );
    }
    const fourth = await checkout(4, 1, later);
    expect(fourth).toEqual({ status: 'sold_out' });
    // A race: a second Checkout for #1 was already open and completes anyway.
    const [race] = await db
      .insert(placements)
      .values({
        businessId: (await db.select().from(businesses).where(eq(businesses.slug, 'plumber-5')))[0]!
          .id,
        townId,
        product: 'sponsored_slot',
        category: 'plumbers',
        rank: 1,
        status: 'pending',
        stripeCheckoutSessionId: 'cs_race',
        createdAt: now,
      })
      .returning();
    await handleStripeEvent(
      db,
      event('checkout.session.completed', {
        id: 'cs_race',
        mode: 'subscription',
        metadata: { placement_id: race!.id },
        subscription: 'sub_race',
        customer: 'cus_r',
      }),
      later,
    );
    expect(
      (await db.select().from(placements).where(eq(placements.id, race!.id)))[0],
    ).toMatchObject({ status: 'held' });
    // Still paid, still held.
    await handleStripeEvent(
      db,
      event('customer.subscription.updated', {
        id: 'sub_race',
        customer: 'cus_r',
        status: 'active',
        metadata: { placement_id: race!.id },
        cancel_at_period_end: false,
        cancel_at: null,
        ended_at: null,
        items: { data: [] },
      }),
      later,
    );
    expect(
      (await db.select().from(placements).where(eq(placements.id, race!.id)))[0],
    ).toMatchObject({ status: 'held' });
  });

  it('follows the subscription: cancel at period end, unpaid, deleted', async () => {
    const sub = (status: string, extra: Record<string, unknown> = {}) =>
      event('customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status,
        metadata: {},
        cancel_at_period_end: false,
        cancel_at: null,
        ended_at: null,
        items: { data: [{ current_period_end: 1_800_000_000 }] },
        ...extra,
      });
    const p1 = async () =>
      (await db.select().from(placements).where(eq(placements.stripeSubscriptionId, 'sub_1')))[0]!;
    await handleStripeEvent(db, sub('active', { cancel_at_period_end: true }), now);
    expect(await p1()).toMatchObject({ status: 'active', endsAt: new Date(1_800_000_000_000) });
    await handleStripeEvent(db, sub('past_due'), now);
    expect((await p1()).status).toBe('active');
    await handleStripeEvent(db, sub('unpaid'), now);
    expect((await p1()).status).toBe('expired');
    await handleStripeEvent(
      db,
      event('customer.subscription.deleted', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'canceled',
        metadata: {},
        cancel_at_period_end: false,
        cancel_at: null,
        ended_at: 1_790_000_000,
        items: { data: [] },
      }),
      now,
    );
    expect(await p1()).toMatchObject({ status: 'canceled', endsAt: new Date(1_790_000_000_000) });
  });

  it('an expired Checkout frees its place; other events are stored and ignored', async () => {
    const expired = await db
      .select()
      .from(placements)
      .where(eq(placements.stripeCheckoutSessionId, 'cs_test_1'));
    expect(expired).toHaveLength(1);
    const [pending] = await db
      .insert(placements)
      .values({
        businessId: expired[0]!.businessId,
        townId,
        product: 'enhanced',
        status: 'pending',
        stripeCheckoutSessionId: 'cs_gone',
        createdAt: now,
      })
      .returning();
    await handleStripeEvent(db, event('checkout.session.expired', { id: 'cs_gone' }), now);
    expect(
      (await db.select().from(placements).where(eq(placements.id, pending!.id)))[0],
    ).toMatchObject({ status: 'canceled' });
    expect(await handleStripeEvent(db, event('invoice.paid', { id: 'in_1' }), now)).toBe('ignored');
  });

  it('gives the free month only on a business’s first spot', async () => {
    // Owner 1's spot #1 was canceled above; buying it again starts billing at once.
    const later = new Date(now.getTime() + 2 * 61 * 60_000);
    await db.update(placements).set({ status: 'canceled' }).where(eq(placements.status, 'held'));
    expect(await checkout(1, 1, later)).toMatchObject({ status: 'redirect' });
    const last = sessions[sessions.length - 1]!;
    expect(last.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('maps every subscription status', () => {
    expect(placementStatusFor('trialing')).toBe('active');
    expect(placementStatusFor('incomplete')).toBe('pending');
    expect(placementStatusFor('incomplete_expired')).toBe('expired');
    expect(placementStatusFor('paused')).toBe('expired');
  });

  it('verifies webhook signatures with the official helper', async () => {
    const stripe = new Stripe('sk_test_x');
    const payload = JSON.stringify({
      id: 'evt_sig',
      type: 'invoice.paid',
      livemode: false,
      data: { object: {} },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    expect(stripe.webhooks.constructEvent(payload, header, 'whsec_test').id).toBe('evt_sig');
    expect(() => stripe.webhooks.constructEvent(payload, header, 'whsec_other')).toThrow();
  });
});
