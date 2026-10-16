import {
  adminActions,
  businessRequests,
  businesses,
  eq,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decideBusinessRequest,
  pendingBusinessRequests,
  RequestNotPending,
  REQUESTS_PER_HOUR,
  submitBusinessRequest,
} from '../src';

describe('add your business', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let staffId: string;
  const now = new Date('2026-10-16T12:00:00Z');
  const send = (over: Partial<Parameters<typeof submitBusinessRequest>[1]> = {}) =>
    submitBusinessRequest(
      db,
      {
        townId,
        name: '  Tidepool   Grooming ',
        category: 'pets',
        address: '12 Harbor St',
        zip: '33432-1234',
        phone: '561.555.0142',
        website: 'tidepool.test',
        contactName: 'Robin',
        email: 'Robin@Tidepool.test',
        ip: '203.0.113.7',
        ...over,
      },
      now,
    );

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'addville',
        name: 'Addville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'addville.test',
        siteName: 'The Addville Post',
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
  });
  afterAll(async () => drop());

  it('checks the form and stores a clean request, listing nothing yet', async () => {
    expect(await send({ name: ' ' })).toBe('missing');
    expect(await send({ email: 'nope' })).toBe('contact');
    expect(await send({ category: 'dragons' })).toBe('category');
    expect(await send()).toBe('sent');
    const [row] = await pendingBusinessRequests(db);
    expect(row).toMatchObject({
      name: 'Tidepool Grooming',
      zip: '33432',
      phone: '(561) 555-0142',
      website: 'https://tidepool.test/',
      email: 'robin@tidepool.test',
      status: 'pending',
      town: { name: 'Addville' },
    });
    expect(await db.select().from(businesses)).toHaveLength(0);
  });

  it('limits requests from one address an hour', async () => {
    for (let i = 1; i < REQUESTS_PER_HOUR; i++)
      expect(await send({ email: `x${i}@a.test` })).toBe('sent');
    expect(await send({ email: 'other@a.test' })).toBe('rate');
    await db.delete(businessRequests).where(eq(businessRequests.status, 'pending'));
  });

  it('adds a listing with the details shown, or rejects; each decided once and audited', async () => {
    await send({ ip: null });
    await send({ ip: null, name: 'Spam Co', email: 'spam@a.test' });
    const [keep, spam] = await pendingBusinessRequests(db);
    const { businessId } = await decideBusinessRequest(db, {
      requestId: keep!.id,
      staffId,
      decision: 'add',
    });
    const [listing] = await db.select().from(businesses).where(eq(businesses.id, businessId!));
    expect(listing).toMatchObject({
      name: 'Tidepool Grooming',
      category: 'pets',
      address: '12 Harbor St',
      addressPublic: true,
      dataSource: 'request',
      active: true,
      claimedAt: null,
    });
    expect(listing!.slug).toMatch(/^tidepool-grooming-r[0-9a-f]{6}$/);
    await decideBusinessRequest(db, { requestId: spam!.id, staffId, decision: 'reject' });
    await expect(
      decideBusinessRequest(db, { requestId: spam!.id, staffId, decision: 'add' }),
    ).rejects.toBeInstanceOf(RequestNotPending);
    expect(await pendingBusinessRequests(db)).toHaveLength(0);
    const actions = await db.select().from(adminActions);
    expect(actions.map((a) => a.action).sort()).toEqual([
      'directory.request.add',
      'directory.request.reject',
    ]);
  });
});
