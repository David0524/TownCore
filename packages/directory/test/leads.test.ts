import {
  businesses,
  campaigns,
  leads,
  mailDomains,
  placements,
  proofReports,
  slotStatsDaily,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { MailTransport, SendRequest } from '@towncore/mail';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  logCall,
  previousMonth,
  proofReport,
  quoteRecipients,
  recordSlotEvents,
  sendMonthlyReports,
  submitQuote,
} from '../src';

// Leads, slot stats and proof reports (M6 PR E).
const sent: SendRequest[] = [];
const transport: MailTransport = {
  name: 'log',
  async send(request) {
    sent.push(request);
    return { sesMessageId: `m${sent.length}` };
  },
};

describe('leads and proof reports', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  const ids: Record<string, string> = {};
  let campaignId: string;
  let now = new Date('2026-10-16T15:00:00Z');
  const deps = () => ({
    db,
    transport,
    configurationSet: 'conv',
    timezone: 'America/New_York',
    now: () => now,
  });
  const quote = (over: Partial<Parameters<typeof submitQuote>[1]> = {}) =>
    submitQuote(deps(), {
      townId,
      category: 'plumbers',
      name: 'Pat Reader',
      email: 'pat@reader.test',
      phone: '561 555 0100',
      message: 'Leaking water heater, need a quote this week.',
      consent: true,
      ip: '198.51.100.7',
      ...over,
    });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'leadville',
        name: 'Leadville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'leadville.test',
        siteName: 'The Leadville Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    await db
      .insert(mailDomains)
      .values({ name: 'leadville.test', townId, displayName: 'Leadville', status: 'live' });
    for (const [key, paid] of [
      ['a', true],
      ['b', true],
      ['c', false],
    ] as const) {
      const [b] = await db
        .insert(businesses)
        .values({
          townId,
          slug: `plumber-${key}`,
          name: `Plumber ${key.toUpperCase()}`,
          category: 'plumbers',
          dataSource: 'fl-dbpr',
          licenseNumber: `L${key}`,
          claimedAt: now,
          claimedByEmail: `${key}@plumber.test`,
          phone: '(561) 555-0101',
        })
        .returning();
      ids[key] = b!.id;
      if (paid) {
        const [p] = await db
          .insert(placements)
          .values({
            businessId: b!.id,
            townId,
            product: 'sponsored_slot',
            category: 'plumbers',
            status: 'active',
            startsAt: new Date('2026-09-20T00:00:00Z'),
          })
          .returning();
        if (key === 'a') {
          const [c] = await db
            .insert(campaigns)
            .values({
              townId,
              slot: 'directory.category.top',
              category: 'plumbers',
              placementId: p!.id,
              status: 'active',
              startsAt: new Date('2026-09-20T00:00:00Z'),
              creative: { advertiser: 'Plumber A', headline: 'Hi', href: '/x' },
            })
            .returning();
          campaignId = c!.id;
        }
      }
    }
  });
  afterAll(async () => drop());
  beforeEach(() => {
    sent.length = 0;
  });

  it('routes a quote only to claimed, paying businesses in the category', async () => {
    expect((await quoteRecipients(db, townId, 'plumbers')).map((r) => r.name)).toEqual([
      'Plumber A',
      'Plumber B',
    ]);
    expect(await quote()).toEqual({ status: 'sent', to: ['Plumber A', 'Plumber B'] });
    expect(sent.map((s) => s.to[0])).toEqual(['a@plumber.test', 'b@plumber.test']);
    const raw = sent[0]!.raw.toString();
    expect(raw).toMatch(/Reply-To: pat@reader\.test/);
    expect(raw).toContain('Leaking water heater');
    const rows = await db.select().from(leads);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.requestId)).size).toBe(1);
    expect(rows[0]).toMatchObject({ kind: 'form', slot: 'directory.quote-request' });
  });

  it('validates, drops bots, and refuses categories with no sponsors', async () => {
    expect(await quote({ consent: false })).toEqual({ status: 'invalid' });
    expect(await quote({ phone: '12' })).toEqual({ status: 'invalid' });
    expect(await quote({ email: 'nope' })).toEqual({ status: 'invalid' });
    expect(await quote({ honeypot: 'x' })).toEqual({ status: 'sent', to: [] });
    expect(await quote({ category: 'roofers' })).toEqual({ status: 'no_recipients' });
    expect(sent).toHaveLength(0);
  });

  it('rate-limits by address per day and by IP per hour', async () => {
    await quote({ ip: '198.51.100.8' });
    await quote({ ip: '198.51.100.9' });
    expect(await quote({ ip: '198.51.100.10' })).toEqual({ status: 'rate_limited' });
    for (let i = 0; i < 5; i++) await quote({ email: `n${i}@reader.test`, ip: '203.0.113.1' });
    expect(await quote({ email: 'n9@reader.test', ip: '203.0.113.1' })).toEqual({
      status: 'rate_limited',
    });
  });

  it('logs call taps, and counts slot events with the campaign’s business looked up', async () => {
    expect(
      await logCall(db, { townId, timezone: 'America/New_York', slug: 'plumber-a' }, now),
    ).toBe(true);
    expect(await logCall(db, { townId, timezone: 'America/New_York', slug: 'nope' }, now)).toBe(
      false,
    );
    const counted = await recordSlotEvents(
      db,
      {
        townId,
        timezone: 'America/New_York',
        events: [
          { slot: 'directory.category.top', kind: 'impression', campaignId },
          { slot: 'directory.category.top', kind: 'impression', campaignId },
          { slot: 'directory.category.top', kind: 'click', campaignId, businessId: ids.c },
          { slot: 'directory.business.cta', kind: 'impression', businessId: ids.a },
          { slot: 'rail.box', kind: 'impression' },
          // Unknown ids are dropped, never counted.
          {
            slot: 'directory.category.top',
            kind: 'click',
            campaignId: '00000000-0000-0000-0000-000000000000',
          },
        ],
      },
      now,
    );
    expect(counted).toBe(5);
    const rows = await db.select().from(slotStatsDaily);
    const card = rows.find((r) => r.campaignId === campaignId)!;
    expect(card).toMatchObject({ impressions: 2, clicks: 1, businessId: ids.a, day: '2026-10-16' });
  });

  it('builds the month’s report', async () => {
    expect(
      await proofReport(db, { businessId: ids.a!, timezone: 'America/New_York', month: '2026-10' }),
    ).toEqual({ listingViews: 1, cardImpressions: 2, cardClicks: 1, calls: 1, quoteRequests: 8 });
    expect(previousMonth(new Date('2026-11-01T12:00:00Z'), 'America/New_York')).toBe('2026-10');
    expect(previousMonth(new Date('2026-01-02T12:00:00Z'), 'America/New_York')).toBe('2025-12');
  });

  it('emails last month’s report to paying businesses once, early in the month', async () => {
    now = new Date('2026-11-15T14:00:00Z');
    expect(await sendMonthlyReports(deps(), now)).toEqual({ sent: 0 });
    now = new Date('2026-11-01T14:00:00Z');
    expect(await sendMonthlyReports(deps(), now)).toEqual({ sent: 2 });
    expect(sent.map((s) => s.to[0]).sort()).toEqual(['a@plumber.test', 'b@plumber.test']);
    expect(sent[0]!.raw.toString()).toMatch(/October 2026 report/);
    expect(await sendMonthlyReports(deps(), now)).toEqual({ sent: 0 });
    expect(await db.select().from(proofReports)).toHaveLength(2);
  });
});
