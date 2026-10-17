import { resetEnvCache } from '@towncore/config';
import {
  adminActions,
  articleEntities,
  articles,
  businessFollowups,
  businesses,
  campaigns,
  entities,
  eq,
  leads,
  mailDomains,
  placements,
  proofReports,
  records,
  slotStatsDaily,
  sources,
  staff,
  stripePrices,
  suppressions,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { MailTransport, SendRequest } from '@towncore/mail';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  categoryQuoteRequests,
  decideSponsorCard,
  draftFollowups,
  featuredUplift,
  handleStripeEvent,
  listingOffers,
  openWindows,
  ownerMailToken,
  ownerOptOut,
  pendingFollowups,
  sendApprovedFollowups,
  sendFollowup,
  sendMonthlyReports,
  setFollowupApproval,
  startCheckout,
  submitSponsorCard,
  upcomingWindows,
  verifyOwnerMailToken,
} from '../src';

// Traffic and self-serve revenue (owner, 2026-10-17): proof reports to every claimed business
// with what a featured spot would add, booked newsletter weeks and category months, and owner
// follow-ups that wait for staff unless a town's standing approval is on. No network: a fake
// Stripe and a recording mail transport.

const SECRET = 'x'.repeat(40);
const sent: SendRequest[] = [];
const transport: MailTransport = {
  name: 'log',
  async send(request) {
    sent.push(request);
    return { sesMessageId: `m${sent.length}` };
  },
};
const sessions: Array<Record<string, unknown>> = [];
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params: Record<string, unknown>) => {
        sessions.push(params);
        return {
          id: `cs_g_${sessions.length}`,
          url: `https://checkout.stripe.test/${sessions.length}`,
        };
      },
    },
  },
} as unknown as Stripe;
let n = 0;
const event = (type: string, object: Record<string, unknown>) =>
  ({ id: `evt_g_${++n}`, type, livemode: false, data: { object } }) as unknown as Stripe.Event;
const rawText = (r: SendRequest) => r.raw.toString('utf8');

describe('traffic and self-serve revenue', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  const ids: Record<string, string> = {};
  // Saturday, Oct. 17, 2026, noon in Florida.
  const now = new Date('2026-10-17T16:00:00Z');
  const deps = (over: object = {}) => ({
    db,
    transport,
    configurationSet: 'conv',
    tokenSecret: SECRET,
    postalAddress: '1 Main St, Growtown FL',
    now: () => now,
    ...over,
  });

  beforeAll(async () => {
    vi.stubEnv('DIRECTORY_PRODUCTS_PREVIEW', 'newsletter,exclusive');
    resetEnvCache();
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'growtown',
        name: 'Growtown',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'growtown.test',
        siteName: 'The Growtown Ledger',
        tier: 'small',
        config: {
          pricing: {
            featured_usd: [19, 12, 7],
            enhanced_usd: 39,
            free_trial_days: 30,
            newsletter_week_usd: 49,
            category_month_usd: 99,
          },
        },
      })
      .returning();
    townId = town!.id;
    await db.insert(mailDomains).values({
      name: 'growtown.test',
      townId,
      displayName: 'The Growtown Ledger',
      status: 'live',
    });
    const [member] = await db
      .insert(staff)
      .values({ email: 'admin@towncore.net', name: 'Admin', role: 'admin' })
      .returning();
    staffId = member!.id;
    const listing = async (slug: string, extra: object = {}) =>
      (
        await db
          .insert(businesses)
          .values({
            townId,
            slug,
            name: slug.replace(/-/g, ' '),
            category: 'plumbers',
            dataSource: 'fl-dbpr',
            licenseNumber: slug,
            ...extra,
          })
          .returning()
      )[0]!.id;
    const claimed = (email: string, daysAgo = 120) => ({
      claimedAt: new Date(now.getTime() - daysAgo * 86_400_000),
      claimedByEmail: email,
    });
    ids.owner = await listing('ace-plumbing', claimed('owner@ace.test'));
    ids.rival = await listing('best-plumbing', claimed('owner@best.test'));
    ids.unclaimed = await listing('quiet-plumbing');
    for (const [key, price, product, rank] of [
      ['enh', 3900, 'enhanced', null],
      ['r1', 1900, 'sponsored_slot', 1],
      ['r2', 1200, 'sponsored_slot', 2],
      ['r3', 700, 'sponsored_slot', 3],
    ] as const)
      await db.insert(stripePrices).values({
        townId,
        product,
        rank,
        stripeProductId: `prod_${key}`,
        stripePriceId: `price_${key}`,
        unitAmountCents: price,
      });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetEnvCache();
    await drop();
  });

  it('says "not enough data yet" until featured and unfeatured listings both have counts', async () => {
    const thin = await featuredUplift(db, { category: 'plumbers' }, now);
    expect(thin.status).toBe('thin');
    expect(thin.basis).toMatch(/^Not enough data yet/);
  });

  it('compares featured and unfeatured listings from real counts, with the basis', async () => {
    // A second town's plumbers count too: the comparison is network-wide.
    const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const extra: string[] = [];
    for (let i = 0; i < 8; i++)
      extra.push(
        (
          await db
            .insert(businesses)
            .values({
              townId,
              slug: `plumber-${i}`,
              name: `Plumber ${i}`,
              category: 'plumbers',
              dataSource: 'fl-dbpr',
              claimedAt: new Date(now.getTime() - 100 * 86_400_000),
              claimedByEmail: `p${i}@plumb.test`,
            })
            .returning()
        )[0]!.id,
      );
    // Three featured for 60 days each, 10 views a day; five unfeatured, 1 view a day.
    for (const [i, id] of extra.entries()) {
      const featured = i < 3;
      if (featured)
        await db.insert(placements).values({
          businessId: id,
          townId,
          product: 'sponsored_slot',
          category: 'plumbers',
          rank: ((i % 3) + 1) as 1 | 2 | 3,
          status: 'expired',
          startsAt: new Date(now.getTime() - 70 * 86_400_000),
          endsAt: new Date(now.getTime() - 10 * 86_400_000),
        });
      for (let d = 12; d < 68; d += 1)
        await db.insert(slotStatsDaily).values({
          townId,
          day: day(d),
          slot: 'directory.business.cta',
          businessId: id,
          impressions: featured ? 10 : 1,
        });
    }
    const uplift = await featuredUplift(db, { category: 'plumbers' }, now);
    expect(uplift.status).toBe('ok');
    if (uplift.status !== 'ok') return;
    expect(uplift.featuredViews).toBeGreaterThan(200);
    expect(uplift.unfeaturedViews).toBeLessThan(30);
    expect(uplift.basis).toContain('3 plumbers listings while they held a featured spot');
    // Clean up so the rest of the suite sees only the three listings above.
    await db.delete(slotStatsDaily);
    await db.delete(placements);
    for (const id of extra) await db.delete(businesses).where(eq(businesses.id, id));
  });

  it('emails every claimed owner a report; unpaid ones see missed quote requests', async () => {
    // Two quote requests for plumbers in September, one routed to two businesses.
    const sep = new Date('2026-09-15T15:00:00Z');
    const requestId = '00000000-0000-4000-8000-000000000001';
    await db.insert(leads).values([
      {
        businessId: ids.rival!,
        kind: 'form',
        townId,
        slot: 'directory.quote-request',
        requestId,
        meta: { category: 'plumbers' },
        createdAt: sep,
      },
      {
        businessId: ids.unclaimed!,
        kind: 'form',
        townId,
        slot: 'directory.quote-request',
        requestId,
        meta: { category: 'plumbers' },
        createdAt: sep,
      },
      {
        businessId: ids.rival!,
        kind: 'form',
        townId,
        slot: 'directory.quote-request',
        meta: { category: 'plumbers' },
        createdAt: sep,
      },
    ]);
    expect(
      await categoryQuoteRequests(db, {
        townId,
        category: 'plumbers',
        timezone: 'America/New_York',
        month: '2026-09',
      }),
    ).toBe(2);
    const first = new Date('2026-10-01T14:00:00Z');
    sent.length = 0;
    // Unpaid owners get the email only once an admin gave the town's standing approval (Rule 10).
    expect(await sendMonthlyReports(deps({ now: () => first }), first)).toEqual({ sent: 0 });
    await db.update(towns).set({ businessMailApprovedAt: first }).where(eq(towns.id, townId));
    expect(await sendMonthlyReports(deps({ now: () => first }), first)).toEqual({ sent: 2 });
    const toAce = sent.find((r) => r.to[0] === 'owner@ace.test')!;
    const text = rawText(toAce);
    expect(text).toContain('2 quote requests for plumbers');
    expect(text).toMatch(/Not enough data yet/);
    expect(text).toMatch(
      /List-Unsubscribe:\s*<https:\/\/growtown\.test\/api\/owner\/unsubscribe\//,
    );
    expect(text).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(text).toContain('1 Main St, Growtown FL');
    // Once per business and month.
    expect(await sendMonthlyReports(deps({ now: () => first }), first)).toEqual({ sent: 0 });
    expect(await db.select().from(proofReports)).toHaveLength(2);
    await db.delete(leads);
    await db.update(towns).set({ businessMailApprovedAt: null }).where(eq(towns.id, townId));
  });

  it('offers only open weeks and months at the town’s prices, behind the product switch', async () => {
    const weeks = upcomingWindows('week', now, 'America/New_York');
    expect(weeks[0]).toMatchObject({ start: '2026-10-19', label: 'Week of Oct 19–25' });
    expect(upcomingWindows('month', now, 'America/New_York')[0]).toMatchObject({
      start: '2026-11-01',
      label: 'November 2026',
    });
    const offers = await listingOffers(db, townId, { id: ids.owner!, category: 'plumbers' }, now);
    const newsletter = offers.find((o) => o.product === 'newsletter')!;
    expect(newsletter).toMatchObject({ monthlyUsd: 49, period: 'week' });
    expect(newsletter.open).toHaveLength(8);
    expect(offers.find((o) => o.product === 'exclusive')).toMatchObject({ monthlyUsd: 99 });
    // Enhanced now has the first-month trial too.
    expect(offers.find((o) => o.product === 'enhanced')).toMatchObject({ trialDays: 30 });

    // Switched off: no offer at all.
    vi.stubEnv('DIRECTORY_PRODUCTS_PREVIEW', '');
    resetEnvCache();
    const off = await listingOffers(db, townId, { id: ids.owner!, category: 'plumbers' }, now);
    expect(off.map((o) => o.product)).not.toContain('newsletter');
    vi.stubEnv('DIRECTORY_PRODUCTS_PREVIEW', 'newsletter,exclusive');
    resetEnvCache();
  });

  it('books a newsletter week through a one-time Checkout; the webhook turns it on', async () => {
    const result = await startCheckout(
      db,
      fakeStripe,
      {
        townId,
        email: 'owner@ace.test',
        slug: 'ace-plumbing',
        product: 'newsletter',
        period: '2026-10-26',
        origin: 'https://growtown.test',
      },
      now,
    );
    expect(result.status).toBe('redirect');
    const params = sessions.at(-1)!;
    expect(params).toMatchObject({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 4900 } }],
    });
    // The week is held while Checkout is open; nobody else can book it.
    expect(
      await startCheckout(
        db,
        fakeStripe,
        {
          townId,
          email: 'owner@best.test',
          slug: 'best-plumbing',
          product: 'newsletter',
          period: '2026-10-26',
          origin: 'https://growtown.test',
        },
        now,
      ),
    ).toEqual({ status: 'sold_out' });
    // A week that isn't offered (already started) can't be bought.
    expect(
      await startCheckout(
        db,
        fakeStripe,
        {
          townId,
          email: 'owner@best.test',
          slug: 'best-plumbing',
          product: 'newsletter',
          period: '2026-10-12',
          origin: 'https://growtown.test',
        },
        now,
      ),
    ).toEqual({ status: 'sold_out' });
    const placementId = (params.metadata as Record<string, string>).placement_id!;
    await handleStripeEvent(
      db,
      event('checkout.session.completed', {
        id: 'cs_g_1',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: placementId,
        metadata: { placement_id: placementId },
        customer: 'cus_ace',
      }),
      now,
    );
    const [placement] = await db.select().from(placements).where(eq(placements.id, placementId));
    expect(placement).toMatchObject({ status: 'active', period: '2026-10-26' });
    expect(placement!.startsAt!.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    const open = await openWindows(
      db,
      { townId, timezone: 'America/New_York', product: 'newsletter', category: null },
      now,
    );
    expect(open.map((w) => w.start)).not.toContain('2026-10-26');

    // The owner's card runs that week only, after staff approve it.
    expect(
      await submitSponsorCard(
        db,
        {
          townId,
          email: 'owner@ace.test',
          slug: 'ace-plumbing',
          headline: 'Leaks fixed today',
          body: '',
          placementId,
        },
        now,
      ),
    ).toEqual({ ok: true });
    const [card] = await db.select().from(campaigns).where(eq(campaigns.placementId, placementId));
    expect(card).toMatchObject({ slot: 'newsletter.top', category: null, status: 'draft' });
    expect((card!.creative as { href: string }).href).toBe(
      'https://growtown.test/directory/plumbers/ace-plumbing',
    );
    await decideSponsorCard(db, { campaignId: card!.id, staffId, decision: 'approve' }, now);
    const [live] = await db.select().from(campaigns).where(eq(campaigns.id, card!.id));
    expect(live).toMatchObject({ status: 'active' });
    expect(live!.startsAt.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(live!.endsAt!.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('books a category month; a second payment for the same month is held', async () => {
    const start = (email: string, slug: string) =>
      startCheckout(
        db,
        fakeStripe,
        {
          townId,
          email,
          slug,
          product: 'exclusive',
          period: '2026-11-01',
          origin: 'https://growtown.test',
        },
        now,
      );
    expect((await start('owner@ace.test', 'ace-plumbing')).status).toBe('redirect');
    const first = (sessions.at(-1)!.metadata as Record<string, string>).placement_id!;
    expect(sessions.at(-1)).toMatchObject({ line_items: [{ price_data: { unit_amount: 9900 } }] });
    // The Checkout hold lapses after an hour; a rival then starts one for the same month.
    const later = new Date(now.getTime() + 2 * 3_600_000);
    expect(
      (
        await startCheckout(
          db,
          fakeStripe,
          {
            townId,
            email: 'owner@best.test',
            slug: 'best-plumbing',
            product: 'exclusive',
            period: '2026-11-01',
            origin: 'https://growtown.test',
          },
          later,
        )
      ).status,
    ).toBe('redirect');
    const second = (sessions.at(-1)!.metadata as Record<string, string>).placement_id!;
    const complete = (id: string) =>
      handleStripeEvent(
        db,
        event('checkout.session.completed', {
          id: `cs_${id}`,
          mode: 'payment',
          payment_status: 'paid',
          metadata: { placement_id: id },
        }),
        later,
      );
    await complete(second);
    await complete(first);
    const rows = await db.select().from(placements).where(eq(placements.product, 'exclusive'));
    expect(rows.find((r) => r.id === second)!.status).toBe('active');
    expect(rows.find((r) => r.id === first)!.status).toBe('held');
  });

  it('gives Enhanced and a business’s first featured spot the 30-day trial', async () => {
    await startCheckout(
      db,
      fakeStripe,
      {
        townId,
        email: 'owner@best.test',
        slug: 'best-plumbing',
        product: 'enhanced',
        origin: 'https://growtown.test',
      },
      now,
    );
    expect(sessions.at(-1)).toMatchObject({
      mode: 'subscription',
      subscription_data: { trial_period_days: 30 },
    });
    await startCheckout(
      db,
      fakeStripe,
      {
        townId,
        email: 'owner@best.test',
        slug: 'best-plumbing',
        product: 'sponsored_slot',
        rank: 2,
        origin: 'https://growtown.test',
      },
      now,
    );
    expect(sessions.at(-1)).toMatchObject({
      line_items: [{ price: 'price_r2', quantity: 1 }],
      subscription_data: { trial_period_days: 30 },
    });
  });

  it('drafts follow-ups and stores the trial end from Stripe', async () => {
    // Best Plumbing completes its featured spot #2: Ace hears a competitor took a spot.
    const [spot] = await db
      .select()
      .from(placements)
      .where(eq(placements.stripeCheckoutSessionId, `cs_g_${sessions.length}`));
    await handleStripeEvent(
      db,
      event('checkout.session.completed', {
        id: spot!.stripeCheckoutSessionId,
        mode: 'subscription',
        metadata: { placement_id: spot!.id },
        subscription: 'sub_best',
        customer: 'cus_best',
      }),
      now,
    );
    const trialEnd = Math.floor((now.getTime() + 2 * 86_400_000) / 1000);
    await handleStripeEvent(
      db,
      event('customer.subscription.updated', {
        id: 'sub_best',
        status: 'trialing',
        customer: 'cus_best',
        metadata: { placement_id: spot!.id },
        trial_end: trialEnd,
        items: { data: [] },
      }),
      now,
    );
    const [after] = await db.select().from(placements).where(eq(placements.id, spot!.id));
    expect(after!.trialEndsAt!.getTime()).toBe(trialEnd * 1000);

    // A story names Ace.
    const [source] = await db
      .insert(sources)
      .values({ townId, kind: 'agenda', platform: 'legistar', adapter: 'legistar' })
      .returning();
    const [record] = await db
      .insert(records)
      .values({
        sourceId: source!.id,
        townId,
        externalId: 'a1',
        type: 'agenda',
        title: 'Agenda',
        occurredAt: now,
        contentHash: 'a1',
      })
      .returning();
    const [story] = await db
      .insert(articles)
      .values({
        townId,
        slug: 'water-main',
        headline: 'Water main work on Elm St.',
        bodyMd: 'Body.',
        beat: 'development',
        tier: 2,
        status: 'published',
        kind: 'story',
        byline: 'The Growtown Ledger Newsroom',
        sourceRecordIds: [record!.id],
        publishedAt: new Date(now.getTime() - 86_400_000),
      })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({
        townId,
        kind: 'business',
        name: 'ace plumbing',
        key: 'ace plumbing',
        slug: 'ace-plumbing',
      })
      .returning();
    await db
      .insert(articleEntities)
      .values({ articleId: story!.id, entityId: entity!.id, mention: 'Ace Plumbing' });

    expect(await draftFollowups(db, townId, now)).toEqual({ created: 2 });
    const drafts = await pendingFollowups(db);
    expect(drafts.map((d) => [d.kind, d.toEmail]).sort()).toEqual([
      ['competitor_spot', 'owner@ace.test'],
      ['trial_ending', 'owner@best.test'],
    ]);
    const trial = drafts.find((d) => d.kind === 'trial_ending')!;
    expect(trial.lines.join(' ')).toContain('$12 a month');
    // Ace's story mention waits a week (one follow-up a week); running again adds nothing.
    expect(await draftFollowups(db, townId, now)).toEqual({ created: 0 });
    const inAWeek = new Date(now.getTime() + 8 * 86_400_000);
    await db.update(articles).set({ publishedAt: new Date(inAWeek.getTime() - 86_400_000) });
    expect(await draftFollowups(db, townId, inAWeek)).toEqual({ created: 1 });
    expect((await pendingFollowups(db)).map((d) => d.kind)).toContain('story_mention');
    await db.delete(businessFollowups).where(eq(businessFollowups.kind, 'story_mention'));
  });

  it('sends nothing on its own until an admin turns on the standing approval', async () => {
    sent.length = 0;
    expect(await sendApprovedFollowups(deps(), now)).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toHaveLength(0);

    await setFollowupApproval(db, { townId, staffId, on: true }, now);
    // Ace asked never to be emailed: that draft is skipped, not sent.
    await db
      .insert(suppressions)
      .values({ email: 'owner@ace.test', reason: 'unsubscribe', scope: 'global' });
    expect(await sendApprovedFollowups(deps(), now)).toEqual({ sent: 1, skipped: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['owner@best.test']);
    expect(rawText(sent[0]!)).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const rows = await db.select().from(businessFollowups);
    expect(rows.find((r) => r.kind === 'competitor_spot')).toMatchObject({
      status: 'skipped',
      note: 'suppressed',
    });
    await setFollowupApproval(db, { townId, staffId, on: false }, now);
    const audit = (await db.select().from(adminActions)).map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining(['directory.followups.approve', 'directory.followups.revoke']),
    );
  });

  it('staff can send a draft by hand; the unsubscribe link stops everything', async () => {
    await db.delete(suppressions);
    await db.insert(businessFollowups).values({
      townId,
      businessId: ids.owner!,
      kind: 'nearby_claim',
      dedupeKey: 'test:nearby',
      toEmail: 'owner@ace.test',
      subject: 'Another plumber near you joined',
      lines: ['Hello.'],
      linkHref: 'https://growtown.test/owner/ace-plumbing',
      linkLabel: 'Update your listing',
    });
    const [draft] = await pendingFollowups(db);
    sent.length = 0;
    expect(await sendFollowup(deps(), { followupId: draft!.id, staffId })).toBe('sent');
    expect(sent).toHaveLength(1);

    const token = ownerMailToken(SECRET, ids.owner!);
    expect(verifyOwnerMailToken(SECRET, token)).toBe(ids.owner);
    expect(verifyOwnerMailToken('y'.repeat(40), token)).toBeNull();
    await db.insert(businessFollowups).values({
      townId,
      businessId: ids.owner!,
      kind: 'nearby_claim',
      dedupeKey: 'test:nearby2',
      toEmail: 'owner@ace.test',
      subject: 'Again',
      lines: ['Hello.'],
      linkHref: 'https://growtown.test/owner/ace-plumbing',
      linkLabel: 'Update your listing',
    });
    expect(await ownerOptOut(db, { secret: SECRET, token, townId }, now)).toMatchObject({
      id: ids.owner,
    });
    expect(await pendingFollowups(db)).toHaveLength(0);
    // No more reports either.
    sent.length = 0;
    await db.delete(proofReports);
    const first = new Date('2026-11-01T14:00:00Z');
    await sendMonthlyReports(deps({ now: () => first }), first);
    expect(sent.map((r) => r.to[0])).not.toContain('owner@ace.test');
  });
});
