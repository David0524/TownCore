import {
  adminActions,
  businessClaims,
  businesses,
  eq,
  mailDomains,
  staff,
  suppressions,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { MailTransport, SendRequest } from '@towncore/mail';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  decideClaim,
  decideNameChange,
  listClaims,
  normalizePhone,
  normalizeWebsite,
  ownerForSession,
  ownerListings,
  redeemOwnerLink,
  requestOwnerLink,
  startClaim,
  updateOwnedListing,
  verifyClaim,
  type DirectoryMailDeps,
} from '../src';

const sent: SendRequest[] = [];
const transport: MailTransport = {
  name: 'log',
  async send(request) {
    sent.push(request);
    return { sesMessageId: `m${sent.length}` };
  },
};
/** The link in the last message sent, decoded from its text part. */
const lastLink = () => {
  const raw = sent.at(-1)!.raw.toString();
  const unfolded = raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  return /https:\/\/claimville\.test\/[^\s"<]+/.exec(unfolded)![0];
};
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get('t')!);

describe('claims and the owner portal', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let townId: string;
  let businessId: string;
  let staffId: string;
  let clock = new Date('2026-10-16T12:00:00Z');
  const deps = (): DirectoryMailDeps => ({
    db,
    transport,
    configurationSet: 'conv',
    now: () => clock,
  });
  const claim = (over: Partial<Parameters<typeof startClaim>[1]> = {}) =>
    startClaim(deps(), {
      townId,
      slug: 'anchor-plumbing-t1',
      name: 'Jane Doe',
      role: 'Owner',
      email: 'Jane@Anchor.test',
      attest: true,
      ip: '203.0.113.9',
      ...over,
    });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'claimville',
        name: 'Claimville',
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain: 'claimville.test',
        siteName: 'The Claimville Post',
        tier: 'small',
        config: {},
      })
      .returning();
    townId = town!.id;
    const [listing] = await db
      .insert(businesses)
      .values({
        townId,
        slug: 'anchor-plumbing-t1',
        name: 'Anchor Plumbing',
        category: 'plumbers',
        dataSource: 'fl-dbpr',
        licenseNumber: 'T1',
        address: '1 Home Rd',
      })
      .returning();
    businessId = listing!.id;
    const [member] = await db
      .insert(staff)
      .values({ email: 'ed@towncore.net', name: 'Ed', role: 'admin' })
      .returning();
    staffId = member!.id;
  });
  afterAll(async () => drop());
  beforeEach(() => {
    sent.length = 0;
  });

  it('says unavailable until the town can send mail', async () => {
    expect(await claim()).toBe('unavailable');
    expect(sent).toHaveLength(0);
    await db
      .insert(mailDomains)
      .values({ name: 'claimville.test', townId, displayName: 'Claimville', status: 'live' });
  });

  it('rejects incomplete claims and drops bots silently', async () => {
    expect(await claim({ attest: false })).toBe('invalid');
    expect(await claim({ email: 'not an address' })).toBe('invalid');
    expect(await claim({ name: '  ' })).toBe('invalid');
    expect(await claim({ honeypot: 'http://spam' })).toBe('ok');
    expect(await claim({ slug: 'nope' })).toBe('not_found');
    expect(sent).toHaveLength(0);
  });

  it('sends one verification link to the address entered, from the town domain', async () => {
    expect(await claim()).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'listings@claimville.test',
      to: ['jane@anchor.test'],
      configurationSet: 'conv',
      tags: { stream: 'conversational', kind: 'claim_verify' },
    });
    expect(sent[0]!.raw.toString()).toContain('Auto-Submitted: auto-generated');
    expect(lastLink()).toContain('/directory/claim/verify?t=');
    // A second press within 10 minutes sends nothing more.
    expect(await claim()).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('verifies once, then waits for staff', async () => {
    clock = new Date(clock.getTime() + 11 * 60_000);
    await claim();
    const token = tokenOf(lastLink());
    expect(await verifyClaim(db, townId, token, clock)).toEqual({
      status: 'pending',
      businessName: 'Anchor Plumbing',
    });
    expect(await verifyClaim(db, townId, token, clock)).toEqual({ status: 'invalid' });
    expect(await verifyClaim(db, townId, 'made-up', clock)).toEqual({ status: 'invalid' });
    const waiting = await listClaims(db);
    expect(waiting.map((c) => [c.email, c.business.name, c.status])).toEqual([
      ['jane@anchor.test', 'Anchor Plumbing', 'pending'],
    ]);
    // A verified claim isn't re-sent.
    expect(await claim()).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('expires verification links after 7 days', async () => {
    await claim({ email: 'late@anchor.test' });
    const token = tokenOf(lastLink());
    const later = new Date(clock.getTime() + 8 * 86_400_000);
    expect(await verifyClaim(db, townId, token, later)).toEqual({ status: 'expired' });
  });

  it('approval makes the claimant owner, closes other claims, audits, and emails them', async () => {
    const [pending] = await listClaims(db);
    await decideClaim(deps(), { claimId: pending!.id, staffId, decision: 'approve' });
    const [listing] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    expect(listing).toMatchObject({ claimedByEmail: 'jane@anchor.test' });
    expect(listing!.claimedAt).not.toBeNull();
    const others = await db
      .select()
      .from(businessClaims)
      .where(eq(businessClaims.email, 'late@anchor.test'));
    expect(others[0]).toMatchObject({ status: 'rejected' });
    const audit = await db.select().from(adminActions);
    expect(audit.map((a) => a.action)).toContain('directory.claim.approve');
    expect(sent.at(-1)).toMatchObject({ tags: { kind: 'claim_approved' } });
    expect(lastLink()).toBe('https://claimville.test/owner');
    await expect(
      decideClaim(deps(), { claimId: pending!.id, staffId, decision: 'reject' }),
    ).rejects.toThrow(/not waiting/);
  });

  it('signs owners in by a single-use link, and answers the same for anyone', async () => {
    expect(await requestOwnerLink(deps(), { townId, email: 'stranger@x.test' })).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(await requestOwnerLink(deps(), { townId, email: 'JANE@anchor.test' })).toBe('ok');
    expect(sent).toHaveLength(1);
    const token = tokenOf(lastLink());
    const session = await redeemOwnerLink(db, townId, token, clock);
    expect(session).toBeTruthy();
    expect(await redeemOwnerLink(db, townId, token, clock)).toBeNull();
    expect(await ownerForSession(db, townId, session!, clock)).toBe('jane@anchor.test');
    expect(await ownerForSession(db, townId, 'nope', clock)).toBeNull();
    expect((await ownerListings(db, townId, 'jane@anchor.test')).map((l) => l.slug)).toEqual([
      'anchor-plumbing-t1',
    ]);
  });

  it('never mails a suppressed address', async () => {
    await db
      .insert(suppressions)
      .values({ email: 'jane@anchor.test', scope: 'global', reason: 'complaint' });
    await requestOwnerLink(deps(), { townId, email: 'jane@anchor.test' });
    expect(sent).toHaveLength(0);
    await db.delete(suppressions);
  });

  it('owners edit contact details at once; a new name waits for staff', async () => {
    const bad = await updateOwnedListing(db, {
      townId,
      email: 'jane@anchor.test',
      slug: 'anchor-plumbing-t1',
      edit: { phone: '123', website: 'javascript:alert(1)' },
    });
    expect(bad).toEqual({
      ok: false,
      errors: ['Enter a 10-digit US phone number.', 'Enter a website address, like example.com.'],
    });
    const good = await updateOwnedListing(db, {
      townId,
      email: 'jane@anchor.test',
      slug: 'anchor-plumbing-t1',
      edit: {
        name: 'Anchor Plumbing & Drain',
        phone: '561-555-0142',
        website: 'anchor.test',
        hours: 'Mon–Fri 8–5',
      },
    });
    expect(good).toEqual({ ok: true, nameReview: true });
    let [listing] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    expect(listing).toMatchObject({
      name: 'Anchor Plumbing',
      pendingName: 'Anchor Plumbing & Drain',
      phone: '(561) 555-0142',
      website: 'https://anchor.test/',
      hours: 'Mon–Fri 8–5',
    });
    await decideNameChange(db, { businessId, staffId, decision: 'approve' });
    [listing] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    expect(listing).toMatchObject({ name: 'Anchor Plumbing & Drain', pendingName: null });
    // Someone else's listing can't be edited.
    expect(
      await updateOwnedListing(db, {
        townId,
        email: 'stranger@x.test',
        slug: 'anchor-plumbing-t1',
        edit: { phone: '5615550100' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('normalizes phones and websites', () => {
    expect(normalizePhone('+1 (561) 555-0142')).toBe('(561) 555-0142');
    expect(normalizePhone('555-0142')).toBeNull();
    expect(normalizeWebsite('http://user:pw@x.test')).toBeNull();
    expect(normalizeWebsite('localhost')).toBeNull();
  });
});
