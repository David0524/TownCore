import {
  adminActions,
  businessFollowups,
  businessTestimonials,
  businesses,
  directoryPrices,
  directoryWaitlist,
  eq,
  experiments,
  placements,
  priceChanges,
  slotStatsDaily,
  staff,
  stripePrices,
  subscribers,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advertiserCount,
  approvedTestimonials,
  categoryPrice,
  decidePriceProposal,
  decideTestimonial,
  draftFollowups,
  featuredPrices,
  joinWaitlist,
  listingOffers,
  overridePrice,
  PricingError,
  proofLine,
  readerReach,
  runMonthlyPricing,
  socialProofLine,
  startCheckout,
  submitTestimonial,
  TestimonialNotPending,
  waitlistCount,
} from '../src';

// Directory revenue (owner, 2026-10-17): one price per town and category, the monthly
// recalculation and its guardrails, grandfathered subscriptions, the waitlist and its follow-up,
// testimonials that need staff approval, and proof lines that need real minimums.

const DAY = 86_400_000;
const now = new Date('2026-11-02T15:00:00Z');
type Session = { metadata: Record<string, string>; line_items: Array<{ price: string }> };
const sessions: Session[] = [];
let priceId = 0;
const fakeStripe = {
  prices: {
    list: async () => ({ data: [] }),
    create: async () => ({ id: `price_dyn_${++priceId}`, product: 'prod_dyn', livemode: false }),
  },
  checkout: {
    sessions: {
      create: async (params: Session) => {
        sessions.push(params);
        return { id: `cs_dyn_${sessions.length}`, url: `https://checkout.test/${sessions.length}` };
      },
    },
  },
} as unknown as Stripe;

describe('directory pricing', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  const ids: Record<string, string> = {};

  const town = async () => (await db.select().from(towns).where(eq(towns.id, townId)))[0]!;
  const listing = async (slug: string, category: string, owner?: string) => {
    const [row] = await db
      .insert(businesses)
      .values({
        townId,
        slug,
        name: slug.replace(/-/g, ' '),
        category,
        dataSource: 'test',
        active: true,
        ...(owner ? { claimedAt: new Date(now.getTime() - 90 * DAY), claimedByEmail: owner } : {}),
      })
      .returning();
    ids[slug] = row!.id;
    return row!;
  };
  const spot = (businessId: string, category: string, rank: number, extra = {}) =>
    db
      .insert(placements)
      .values({
        businessId,
        townId,
        product: 'sponsored_slot',
        category,
        rank,
        status: 'active',
        startsAt: new Date(now.getTime() - 70 * DAY),
        stripePriceId: `price_old_${rank}`,
        ...extra,
      })
      .returning();

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [t] = await db
      .insert(towns)
      .values({
        slug: 'priceville',
        name: 'Priceville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'priceville.test',
        siteName: 'The Priceville Post',
        status: 'live',
        tier: 'small',
        // No pricing: the small tier's list ($9/$6/$4).
        config: {},
      })
      .returning();
    townId = t!.id;
    const [s] = await db
      .insert(staff)
      .values({ email: 'admin@towncore.net', name: 'Admin', role: 'admin' })
      .returning();
    staffId = s!.id;
  });
  afterAll(async () => drop());

  it('uses the tier list price until a category has its own, one price per category', async () => {
    const t = await town();
    expect(await featuredPrices(db, t, 'plumbers')).toEqual({ 1: 900, 2: 600, 3: 400 });
    await overridePrice(
      db,
      {
        townId,
        category: 'plumbers',
        product: 'sponsored_slot',
        rank: 1,
        dollars: 12,
        staffId,
        reason: 'test',
      },
      now,
    );
    expect(await categoryPrice(db, t, 'sponsored_slot', 'plumbers', 1)).toBe(1200);
    expect(await categoryPrice(db, t, 'sponsored_slot', 'electricians', 1)).toBe(900);
    // Every plumber sees the same price.
    const a = await listing('pipe-one', 'plumbers', 'one@pipe.test');
    const b = await listing('pipe-two', 'plumbers', 'two@pipe.test');
    for (const l of [a, b]) {
      const offers = await listingOffers(db, townId, l, now);
      expect(offers.find((o) => o.rank === 1)?.monthlyUsd).toBe(12);
    }
    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'directory.price.override'));
    expect(audit?.detail).toMatchObject({ category: 'plumbers', oldCents: 900, newCents: 1200 });
    await expect(
      overridePrice(db, {
        townId,
        category: 'plumbers',
        product: 'enhanced',
        rank: null,
        dollars: 5,
        staffId,
        reason: 'x',
      }),
    ).rejects.toThrow(PricingError);
  });

  it('checks out at the current price and leaves existing subscriptions on theirs', async () => {
    const [old] = await spot(ids['pipe-one']!, 'plumbers', 2, { stripePriceId: 'price_old_2' });
    const result = await startCheckout(
      db,
      fakeStripe,
      {
        townId,
        email: 'two@pipe.test',
        slug: 'pipe-two',
        product: 'sponsored_slot',
        rank: 1,
        origin: 'https://priceville.test',
      },
      now,
    );
    expect(result.status).toBe('redirect');
    const session = sessions.at(-1)!;
    expect(session.metadata).toMatchObject({ price_cents: '1200', rank: '1' });
    const [level] = await db
      .select()
      .from(stripePrices)
      .where(eq(stripePrices.stripePriceId, session.line_items[0]!.price));
    expect(level).toMatchObject({ unitAmountCents: 1200, rank: 1, active: true });
    // The other subscription is untouched.
    const [still] = await db.select().from(placements).where(eq(placements.id, old!.id));
    expect(still!.stripePriceId).toBe('price_old_2');
    await db.delete(placements).where(eq(placements.townId, townId));
  });

  it('raises a sold-out category once a month, inside the guardrails, and logs its inputs', async () => {
    const roofers = await Promise.all(
      [1, 2, 3].map((i) => listing(`roof-${i}`, 'roofers', `r${i}@roof.test`)),
    );
    for (const [i, r] of roofers.entries()) await spot(r.id, 'roofers', i + 1);
    // Delivered value: card clicks while featured.
    await db.insert(slotStatsDaily).values(
      roofers.map((r) => ({
        townId,
        day: new Date(now.getTime() - 10 * DAY).toISOString().slice(0, 10),
        slot: 'directory.category.top',
        businessId: r.id,
        impressions: 100,
        clicks: 6,
      })),
    );
    const first = await runMonthlyPricing(db, now);
    // +10% in whole dollars: $9 → $10, $6 → $7; $4.40 rounds back to $4, so #3 stays.
    expect(first.changed).toBe(2);
    const t = await town();
    expect(await featuredPrices(db, t, 'roofers')).toEqual({ 1: 1000, 2: 700, 3: 400 });
    const changes = await db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.category, 'roofers'));
    expect(changes).toHaveLength(2);
    expect(changes[0]!.inputs).toMatchObject({ fillRate: 1, waitlist: 0 });
    expect(changes.every((c) => c.status === 'applied')).toBe(true);
    // A second run in the same month changes nothing.
    expect((await runMonthlyPricing(db, new Date(now.getTime() + DAY))).towns).toBe(0);
    expect(await featuredPrices(db, t, 'roofers')).toEqual({ 1: 1000, 2: 700, 3: 400 });
  });

  it('sends a bigger increase to an admin, who approves it (audited)', async () => {
    // Two businesses wait: +10% for the waitlist on top of +10% sold out = a proposal.
    for (const email of ['w1@roof.test', 'w2@roof.test'])
      expect(
        await joinWaitlist(
          db,
          { townId, category: 'roofers', email, consent: true, source: 'category' },
          now,
        ),
      ).toBe('joined');
    const december = new Date('2026-12-02T15:00:00Z');
    const run = await runMonthlyPricing(db, december);
    expect(run.proposed).toBeGreaterThan(0);
    const proposal = (
      await db.select().from(priceChanges).where(eq(priceChanges.status, 'proposed'))
    ).find((c) => c.rank === 1);
    expect(proposal).toMatchObject({ category: 'roofers', oldCents: 1000, newCents: 1200 });
    // Nothing changes until an admin decides.
    expect(await categoryPrice(db, await town(), 'sponsored_slot', 'roofers', 1)).toBe(1000);
    await decidePriceProposal(
      db,
      { changeId: proposal!.id, staffId, decision: 'approve' },
      december,
    );
    expect(await categoryPrice(db, await town(), 'sponsored_slot', 'roofers', 1)).toBe(1200);
    await expect(
      decidePriceProposal(db, { changeId: proposal!.id, staffId, decision: 'reject' }),
    ).rejects.toThrow(PricingError);
    const [row] = await db
      .select()
      .from(directoryPrices)
      .where(eq(directoryPrices.category, 'roofers'));
    expect(row).toBeDefined();
  });

  it('holds prices in towns in the hold arm of the price test', async () => {
    await db
      .insert(experiments)
      .values({ key: 'monthly-pricing', status: 'decided', unit: 'town', winner: 'hold' });
    const january = new Date('2027-01-05T15:00:00Z');
    const before = await featuredPrices(db, await town(), 'roofers');
    const run = await runMonthlyPricing(db, january);
    expect(run).toMatchObject({ towns: 1, changed: 0, proposed: 0 });
    expect(await featuredPrices(db, await town(), 'roofers')).toEqual(before);
    await db.delete(experiments).where(eq(experiments.key, 'monthly-pricing'));
  });
});

describe('waitlist, testimonials and proof', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [t] = await db
      .insert(towns)
      .values({
        slug: 'waitville',
        name: 'Waitville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'waitville.test',
        siteName: 'The Waitville Wire',
        tier: 'mid',
        config: {},
      })
      .returning();
    townId = t!.id;
    const [s] = await db
      .insert(staff)
      .values({ email: 'staff@towncore.net', name: 'Staff', role: 'reviewer' })
      .returning();
    staffId = s!.id;
  });
  afterAll(async () => drop());

  it('takes a waitlist only when every spot is sold, with consent, once per address', async () => {
    const base = { townId, category: 'electricians', source: 'category' as const };
    expect(await joinWaitlist(db, { ...base, email: 'a@b.test', consent: true }, now)).toBe('open');
    const sellers = await db
      .insert(businesses)
      .values(
        [1, 2, 3].map((i) => ({
          townId,
          slug: `volt-${i}`,
          name: `Volt ${i}`,
          category: 'electricians',
          dataSource: 'test',
          claimedAt: now,
          claimedByEmail: `v${i}@volt.test`,
        })),
      )
      .returning();
    const spots = await db
      .insert(placements)
      .values(
        sellers.map((b, i) => ({
          businessId: b.id,
          townId,
          product: 'sponsored_slot' as const,
          category: 'electricians',
          rank: i + 1,
          status: 'active' as const,
          startsAt: new Date(now.getTime() - DAY),
        })),
      )
      .returning();
    expect(await joinWaitlist(db, { ...base, email: 'a@b.test', consent: false }, now)).toBe(
      'invalid',
    );
    expect(await joinWaitlist(db, { ...base, email: 'not-an-email', consent: true }, now)).toBe(
      'invalid',
    );
    expect(await joinWaitlist(db, { ...base, email: 'A@b.test', consent: true }, now)).toBe(
      'joined',
    );
    expect(await joinWaitlist(db, { ...base, email: 'a@B.test', consent: true }, now)).toBe(
      'already',
    );
    for (let i = 0; i < 5; i++)
      await joinWaitlist(db, { ...base, email: `x${i}@y.test`, consent: true, ip: '1.2.3.4' }, now);
    expect(
      await joinWaitlist(db, { ...base, email: 'late@y.test', consent: true, ip: '1.2.3.4' }, now),
    ).toBe('rate_limited');

    // A claimed electrician joins with its claim email: tied to the listing.
    const [waiter] = await db
      .insert(businesses)
      .values({
        townId,
        slug: 'spark-co',
        name: 'Spark Co',
        category: 'electricians',
        dataSource: 'test',
        claimedAt: now,
        claimedByEmail: 'owner@spark.test',
      })
      .returning();
    expect(
      await joinWaitlist(
        db,
        { ...base, email: 'owner@spark.test', consent: true, source: 'owner' },
        now,
      ),
    ).toBe('joined');
    expect(await waitlistCount(db, townId, 'electricians')).toBe(7);

    // Full: no follow-ups yet.
    await draftFollowups(db, townId, now);
    expect(
      await db.select().from(businessFollowups).where(eq(businessFollowups.kind, 'waitlist_open')),
    ).toHaveLength(0);
    // A spot frees up: only the claimed listing's entry gets a draft (never sent by itself).
    await db
      .update(placements)
      .set({ status: 'canceled', endsAt: now })
      .where(eq(placements.id, spots[2]!.id));
    await draftFollowups(db, townId, now);
    const drafts = await db
      .select()
      .from(businessFollowups)
      .where(eq(businessFollowups.kind, 'waitlist_open'));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      businessId: waiter!.id,
      toEmail: 'owner@spark.test',
      status: 'draft',
    });
    expect(drafts[0]!.lines[0]).toContain('Spot #3 is open now');
    const entries = await db
      .select()
      .from(directoryWaitlist)
      .where(eq(directoryWaitlist.townId, townId));
    expect(entries.filter((e) => e.status === 'notified').map((e) => e.email)).toEqual([
      'owner@spark.test',
    ]);
    // Idempotent: one notice per entry.
    await draftFollowups(db, townId, now);
    expect(
      await db.select().from(businessFollowups).where(eq(businessFollowups.kind, 'waitlist_open')),
    ).toHaveLength(1);
  });

  it('takes testimonials only from advertisers, with permission, shown once staff approve', async () => {
    const [shop] = await db
      .insert(businesses)
      .values({
        townId,
        slug: 'quote-shop',
        name: 'Quote Shop',
        category: 'plumbers',
        dataSource: 'test',
        claimedAt: now,
        claimedByEmail: 'q@shop.test',
      })
      .returning();
    const input = {
      townId,
      email: 'q@shop.test',
      slug: 'quote-shop',
      quote: 'We got three new customers in our first month from the listing.',
      permission: true,
    };
    expect(await submitTestimonial(db, input, now)).toBe('not_eligible');
    await db.insert(placements).values({
      businessId: shop!.id,
      townId,
      product: 'enhanced',
      status: 'active',
      startsAt: now,
    });
    expect(await submitTestimonial(db, { ...input, permission: false }, now)).toBe('invalid');
    expect(await submitTestimonial(db, { ...input, quote: 'Short' }, now)).toBe('invalid');
    expect(await submitTestimonial(db, input, now)).toBe('sent');
    expect(await submitTestimonial(db, input, now)).toBe('waiting');
    expect(await approvedTestimonials(db, townId)).toHaveLength(0);
    const [{ id }] = (await db
      .select({ id: businessTestimonials.id })
      .from(businessTestimonials)
      .where(eq(businessTestimonials.status, 'pending'))) as [{ id: string }];
    await decideTestimonial(db, { testimonialId: id, staffId, decision: 'approve' }, now);
    expect(await approvedTestimonials(db, townId)).toEqual([
      { id, quote: input.quote, attribution: 'Quote Shop' },
    ]);
    await expect(
      decideTestimonial(db, { testimonialId: id, staffId, decision: 'reject' }),
    ).rejects.toThrow(TestimonialNotPending);
    const [audit] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'directory.testimonial.approve'));
    expect(audit).toMatchObject({ targetId: id });
  });

  it('shows social proof, reach and personal proof only above their real minimums', async () => {
    // Two electricians (the third canceled) and the enhanced shop: 3, under the minimum of 5.
    expect(await advertiserCount(db, townId, now)).toBe(3);
    expect(socialProofLine(3, 'Waitville')).toBeNull();
    expect(socialProofLine(12, 'Waitville')).toBe('12 Waitville businesses advertise here.');
    expect(await readerReach(db, townId)).toBeNull();
    await db.insert(subscribers).values(
      Array.from({ length: 250 }, (_, i) => ({
        townId,
        email: `reader${i}@mail.test`,
        status: 'active' as const,
        consentAt: now,
        confirmedAt: now,
      })),
    );
    expect(await readerReach(db, townId)).toBe(250);
    expect(proofLine({ days: 30, views: 4, calls: 1, quotes: 0, enough: false })).toBeNull();
    expect(proofLine({ days: 30, views: 214, calls: 3, quotes: 0, enough: true })).toBe(
      'Your listing was seen 214 times in the last 30 days and got 3 calls.',
    );
  });
});
