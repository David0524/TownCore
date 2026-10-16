import {
  adminActions,
  businesses,
  campaigns,
  eq,
  getActiveCampaigns,
  placements,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decideSponsorCard,
  handleStripeEvent,
  pendingSponsorCards,
  SPONSOR_SLOT,
  sponsorCards,
  submitSponsorCard,
} from '../src';

// Sponsor cards (M6 PR D2, D-M6-7): owner writes, staff approve, the card follows its placement.
describe('sponsor cards', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  const now = new Date('2026-10-16T12:00:00Z');
  const placementFor: Record<number, string> = {};
  const owner = (i: number) => `owner${i}@card.test`;
  const submit = (i: number, headline: string, body = '') =>
    submitSponsorCard(db, { townId, email: owner(i), slug: `plumber-${i}`, headline, body }, now);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'cardtown',
        name: 'Cardtown',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'cardtown.test',
        siteName: 'The Cardtown Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [member] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'admin' })
      .returning();
    staffId = member!.id;
    for (const i of [1, 2, 3, 4, 5]) {
      const [listing] = await db
        .insert(businesses)
        .values({
          townId,
          slug: `plumber-${i}`,
          name: `Plumber ${i}`,
          category: 'plumbers',
          dataSource: 'fl-dbpr',
          licenseNumber: `C${i}`,
          claimedAt: now,
          claimedByEmail: owner(i),
        })
        .returning();
      // Plumbers 1–4 hold active sponsored slots (4 would be held in real life; here it tests
      // the approval cap); plumber 5 has none.
      if (i < 5) {
        const [p] = await db
          .insert(placements)
          .values({
            businessId: listing!.id,
            townId,
            product: 'sponsored_slot',
            category: 'plumbers',
            status: 'active',
            stripeSubscriptionId: `sub_${i}`,
            endsAt: new Date('2026-11-16T12:00:00Z'),
          })
          .returning();
        placementFor[i] = p!.id;
      }
    }
  });
  afterAll(async () => drop());

  it('needs an active placement and sane text', async () => {
    expect(await submit(5, 'Hello')).toEqual({ ok: false, error: 'no_placement' });
    expect(await submit(1, '')).toEqual({ ok: false, error: 'headline' });
    expect(await submit(1, 'x'.repeat(71))).toEqual({ ok: false, error: 'headline' });
    expect(await submit(1, 'Fine', 'x'.repeat(161))).toEqual({ ok: false, error: 'body' });
    expect(
      await submitSponsorCard(
        db,
        { townId, email: owner(2), slug: 'plumber-1', headline: 'Not mine', body: '' },
        now,
      ),
    ).toEqual({ ok: false, error: 'not_owner' });
  });

  it('a submitted card waits for staff and links to the listing', async () => {
    expect(await submit(1, 'Same-day   repairs', 'Licensed since 1990.')).toEqual({ ok: true });
    const [waiting] = await pendingSponsorCards(db);
    expect(waiting).toMatchObject({ headline: 'Same-day repairs', body: 'Licensed since 1990.' });
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, waiting!.campaignId));
    expect(row).toMatchObject({ slot: SPONSOR_SLOT, category: 'plumbers', status: 'draft' });
    expect(row!.creative).toMatchObject({
      advertiser: 'Plumber 1',
      href: '/directory/plumbers/plumber-1',
    });
    expect(await getActiveCampaigns(db, townId, SPONSOR_SLOT, 'plumbers', 3, now)).toHaveLength(0);
  });

  it('approval puts it live until the placement ends; a new version replaces it on approval', async () => {
    const [waiting] = await pendingSponsorCards(db);
    await decideSponsorCard(
      db,
      { campaignId: waiting!.campaignId, staffId, decision: 'approve' },
      now,
    );
    const live = await getActiveCampaigns(db, townId, SPONSOR_SLOT, 'plumbers', 3, now);
    expect(live).toHaveLength(1);
    expect(live[0]!.endsAt).toEqual(new Date('2026-11-16T12:00:00Z'));

    await submit(1, 'Now open Sundays');
    expect((await sponsorCards(db, placementFor[1]!)).map((c) => c.status)).toEqual([
      'waiting',
      'live',
    ]);
    const [next] = await pendingSponsorCards(db);
    await decideSponsorCard(
      db,
      { campaignId: next!.campaignId, staffId, decision: 'approve' },
      now,
    );
    const after = await getActiveCampaigns(db, townId, SPONSOR_SLOT, 'plumbers', 3, now);
    expect(after.map((c) => (c.creative as { headline: string }).headline)).toEqual([
      'Now open Sundays',
    ]);
  });

  it('a rejection carries its note back to the owner, and is audited', async () => {
    await submit(2, 'Best plumber in town!!!');
    const [waiting] = await pendingSponsorCards(db);
    await decideSponsorCard(
      db,
      {
        campaignId: waiting!.campaignId,
        staffId,
        decision: 'reject',
        note: 'No unsupported superlatives.',
      },
      now,
    );
    expect(await sponsorCards(db, placementFor[2]!)).toEqual([
      expect.objectContaining({ status: 'rejected', note: 'No unsupported superlatives.' }),
    ]);
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['directory.card.approve', 'directory.card.reject']),
    );
  });

  it('never shows more than 3 cards in a category', async () => {
    for (const i of [2, 3]) {
      await submit(i, `Plumber ${i} card`);
      const [w] = await pendingSponsorCards(db);
      await decideSponsorCard(db, { campaignId: w!.campaignId, staffId, decision: 'approve' }, now);
    }
    await submit(4, 'Fourth card');
    const [w] = await pendingSponsorCards(db);
    await expect(
      decideSponsorCard(db, { campaignId: w!.campaignId, staffId, decision: 'approve' }, now),
    ).rejects.toThrow(/already shows 3/);
    expect(await getActiveCampaigns(db, townId, SPONSOR_SLOT, 'plumbers', 5, now)).toHaveLength(3);
  });

  it('a canceled subscription takes its card down', async () => {
    const event = {
      id: 'evt_cancel',
      type: 'customer.subscription.deleted',
      livemode: false,
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'canceled',
          metadata: {},
          cancel_at_period_end: false,
          cancel_at: null,
          ended_at: Math.floor(now.getTime() / 1000),
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;
    await handleStripeEvent(db, event, now);
    const live = await getActiveCampaigns(db, townId, SPONSOR_SLOT, 'plumbers', 5, now);
    expect(live.map((c) => (c.creative as { advertiser: string }).advertiser).sort()).toEqual([
      'Plumber 2',
      'Plumber 3',
    ]);
  });
});
