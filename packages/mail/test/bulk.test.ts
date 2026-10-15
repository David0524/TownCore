import {
  adminActions,
  domainHealthDaily,
  emailCampaigns,
  emailCampaignSends,
  eq,
  mailDomains,
  mailEvents,
  staff,
  subscribers,
  suppressions,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { simpleParser } from 'mailparser';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveCampaign,
  CampaignError,
  createCampaign,
  fanOutTemplate,
  createTemplate,
  pauseCampaign,
  resumeCampaign,
  scheduleNewsletterIssue,
  setNewsletterApproval,
} from '../src/bulk/campaigns';
import { networkBulkPause, rateBreach, runAutoPause, runWarmupDay } from '../src/bulk/health';
import { buildBulkMime, renderVars } from '../src/bulk/message';
import { expandDueCampaigns, sendDueBatches } from '../src/bulk/sender';
import {
  confirmSubscription,
  newsletterDomain,
  signup,
  unsubscribeByToken,
  type BulkDeps,
} from '../src/bulk/subscribers';
import {
  confirmToken,
  unsubscribeToken,
  verifyConfirmToken,
  verifyUnsubscribeToken,
} from '../src/bulk/tokens';
import { nextWarmup, underCap, warmupCap } from '../src/bulk/warmup';
import { handleSendingEvent } from '../src/outbound/events';
import type { MailTransport, SendRequest } from '../src/outbound/transport';

const SECRET = 'x'.repeat(40);
const ID = '0b9c1d2e-3f40-4a51-8b62-7c83d94ea5f6';

describe('tokens', () => {
  it('unsubscribe tokens verify, never expire and resist tampering', () => {
    const t = unsubscribeToken(SECRET, ID);
    expect(verifyUnsubscribeToken(SECRET, t)).toBe(ID);
    expect(verifyUnsubscribeToken('y'.repeat(40), t)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, t.replace(ID, ID.replace('0b9c', '1b9c')))).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${ID}`)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${t}.extra`)).toBeNull();
  });

  it('confirm tokens expire and are not unsubscribe tokens', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const t = confirmToken(SECRET, ID, new Date(now.getTime() + 60_000));
    expect(verifyConfirmToken(SECRET, t, now)).toEqual({ id: ID });
    expect(verifyConfirmToken(SECRET, t, new Date(now.getTime() + 120_000))).toEqual({
      error: 'expired',
    });
    expect(verifyConfirmToken(SECRET, unsubscribeToken(SECRET, ID), now)).toEqual({
      error: 'invalid',
    });
    expect(verifyUnsubscribeToken(SECRET, t)).toBeNull();
  });
});

describe('warm-up math', () => {
  it('doubles every 3 healthy days up to the target', () => {
    expect([0, 2, 3, 6, 9, 30].map((d) => warmupCap(d, 50_000))).toEqual([
      50, 50, 100, 200, 400, 50_000,
    ]);
    expect(warmupCap(90, 1_000)).toBe(1_000);
  });

  it('holds on one breach day and steps back after two', () => {
    const s = { warmupDay: 9, warmupBreaches: 0, target: 50_000 };
    expect(nextWarmup(s, false)).toMatchObject({ warmupDay: 10, change: 'advanced', cap: 400 });
    const held = nextWarmup(s, true);
    expect(held).toMatchObject({ warmupDay: 9, warmupBreaches: 1, change: 'held' });
    expect(nextWarmup(held, true)).toMatchObject({
      warmupDay: 6,
      warmupBreaches: 0,
      change: 'stepped_back',
      cap: 200,
    });
    expect(nextWarmup({ warmupDay: 2, warmupBreaches: 0, target: 100 }, false)).toMatchObject({
      complete: true,
      cap: 100,
    });
  });

  it('fits sends under the cap', () => {
    expect(underCap(50, 0, 80)).toBe(50);
    expect(underCap(50, 45, 80)).toBe(5);
    expect(underCap(50, 60, 80)).toBe(0);
  });
});

describe('auto-pause thresholds', () => {
  const limits = { bounceRate: 0.03, complaintRate: 0.0008, minSample: 100 };
  it('ignores small samples and names the breach', () => {
    expect(rateBreach({ sent: 50, delivered: 0, bounced: 10, complained: 0 }, limits)).toBeNull();
    expect(rateBreach({ sent: 1000, delivered: 0, bounced: 30, complained: 0 }, limits)).toBeNull();
    expect(rateBreach({ sent: 1000, delivered: 0, bounced: 31, complained: 0 }, limits)).toMatch(
      /^bounce rate 3\.10%/,
    );
    expect(rateBreach({ sent: 10_000, delivered: 0, bounced: 0, complained: 9 }, limits)).toMatch(
      /^complaint rate/,
    );
  });
});

describe('bulk MIME', () => {
  it('carries the §7.3 headers, footer and a text part', async () => {
    const token = unsubscribeToken(SECRET, ID);
    const raw = await buildBulkMime({
      brand: {
        siteName: 'Boca Town Square',
        domain: 'boca.test',
        postalAddress: '1 Main St, Boca Raton, FL 33432',
      },
      to: 'pat@example.com',
      subject: 'Today in Boca',
      html: '<p>Hello</p>',
      text: 'Hello',
      unsubscribeToken: token,
      campaignId: ID,
      kind: 'newsletter',
    });
    const m = await simpleParser(raw);
    expect(m.from?.text).toBe('"Boca Town Square" <newsletter@news.boca.test>');
    expect(m.replyTo?.text).toBe('news@boca.test');
    const head = raw
      .toString()
      .split('\r\n\r\n')[0]!
      .replace(/\r\n\s+/g, ' ');
    expect(head).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(head).toContain(
      `List-Unsubscribe: <https://boca.test/api/newsletter/unsubscribe/${encodeURIComponent(token)}>`,
    );
    expect(m.text).toContain(`https://boca.test/u/${encodeURIComponent(token)}`);
    expect(m.text).toContain(
      'Boca Town Square, published by TownCore · 1 Main St, Boca Raton, FL 33432',
    );
    expect(m.html).toContain('>Unsubscribe</a>');
    expect(m.headers.get('feedback-id')).toBe(`${ID.slice(0, 8)}:boca.test:newsletter:towncore`);
  });

  it('fills template variables and leaves unknown ones', () => {
    expect(
      renderVars('{{site_name}} in {{ town_name }} {{nope}}', {
        site_name: 'Boca',
        town_name: 'Boca Raton',
      }),
    ).toBe('Boca in Boca Raton {{nope}}');
  });
});

describe('newsletters against Postgres', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let sent: SendRequest[];
  let fail = false;
  let clock = new Date('2026-10-15T12:00:00Z');
  const transport: MailTransport = {
    name: 'ses',
    async send(r) {
      if (fail) throw new Error('SES said no');
      sent.push(r);
      return { sesMessageId: `ses-${sent.length}-${r.to[0]}` };
    },
  };
  const deps = (): BulkDeps & { sleep: () => Promise<void> } => ({
    db,
    transport,
    configurationSet: 'towncore-bulk',
    secret: SECRET,
    postalAddress: '1 Main St, Boca Raton, FL 33432',
    now: () => clock,
    sleep: async () => {},
  });
  const ids: Record<string, string> = {};
  let admin: { id: string; name: string; email: string };
  let reviewer: { id: string; name: string; email: string };

  async function addTown(
    slug: string,
    domain: string,
    bulk: 'warming' | 'not_started' = 'warming',
  ) {
    const [t] = await db
      .insert(towns)
      .values({
        slug,
        name: slug,
        state: 'FL',
        county: 'X',
        timezone: 'America/New_York',
        domain,
        siteName: `${slug} Ledger`,
        tier: 'small',
        config: {},
      })
      .returning();
    const [d] = await db
      .insert(mailDomains)
      .values({
        name: domain,
        townId: t!.id,
        displayName: `${slug} Ledger`,
        status: 'live',
        bulkStatus: bulk,
        bulkDailyCap: 50,
      })
      .returning();
    ids[slug] = t!.id;
    ids[domain] = d!.id;
  }

  async function activeSubscribers(townId: string, n: number, prefix: string) {
    await db.insert(subscribers).values(
      Array.from({ length: n }, (_, i) => ({
        townId,
        email: `${prefix}${i}@example.com`,
        status: 'active' as const,
        confirmedAt: new Date(clock.getTime() - i * 60_000),
      })),
    );
  }

  async function event(payload: unknown, replayOf?: string) {
    if (replayOf) return handleSendingEvent(db, replayOf, payload);
    const [row] = await db
      .insert(mailEvents)
      .values({
        snsMessageId: `sns-${Math.random()}`,
        topicArn: 'arn:aws:sns:us-east-1:1:events',
        type: (payload as { eventType: string }).eventType,
        payload,
      })
      .returning();
    return handleSendingEvent(db, row!.id, payload);
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await addTown('boca', 'boca.test');
    await addTown('harbor', 'harbor.test');
    await addTown('quiet', 'quiet.test', 'not_started');
    const rows = await db
      .insert(staff)
      .values([
        { email: 'ed@towncore.net', name: 'Ed', role: 'admin' },
        { email: 'rae@towncore.net', name: 'Rae', role: 'reviewer' },
      ])
      .returning();
    admin = { id: rows[0]!.id, name: 'Ed', email: rows[0]!.email };
    reviewer = { id: rows[1]!.id, name: 'Rae', email: rows[1]!.email };
  });
  afterAll(async () => drop?.());
  beforeEach(() => {
    sent = [];
    fail = false;
  });

  it('only towns with a live, warming or active domain take signups', async () => {
    expect(await newsletterDomain(db, ids.boca!, 'addr')).toMatchObject({ domain: 'boca.test' });
    expect(await newsletterDomain(db, ids.quiet!, 'addr')).toBeNull();
    expect(await newsletterDomain(db, ids.boca!, null)).toBeNull();
    expect(
      await signup(deps(), {
        townId: ids.quiet!,
        email: 'a@example.com',
        ip: '1.1.1.1',
        sourceUrl: 'https://quiet.test/',
      }),
    ).toBe('unavailable');
  });

  it('double opt-in: signup sends one confirmation, confirm activates', async () => {
    const input = {
      townId: ids.boca!,
      email: 'New.Reader@Example.com',
      ip: '2.2.2.2',
      sourceUrl: 'https://boca.test/',
    };
    expect(await signup(deps(), input)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: ['new.reader@example.com'],
      from: 'newsletter@news.boca.test',
      configurationSet: 'towncore-bulk',
    });
    expect(sent[0]!.tags).toMatchObject({
      stream: 'bulk',
      kind: 'confirm',
      domain_id: ids['boca.test'],
    });
    const [sub] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.email, 'new.reader@example.com'));
    expect(sub).toMatchObject({
      status: 'pending',
      consentIp: '2.2.2.2',
      consentSource: 'https://boca.test/',
    });

    // A second try within 10 minutes says ok but sends nothing.
    expect(await signup(deps(), input)).toBe('ok');
    expect(sent).toHaveLength(1);

    const mail = await simpleParser(sent[0]!.raw);
    const link = /https:\/\/boca\.test\/newsletter\/confirm\?t=(\S+)/.exec(mail.text ?? '')![1]!;
    expect(await confirmSubscription(deps(), decodeURIComponent(link))).toMatchObject({
      status: 'confirmed',
    });
    expect(await confirmSubscription(deps(), decodeURIComponent(link))).toMatchObject({
      status: 'already',
    });
    const [after] = await db.select().from(subscribers).where(eq(subscribers.id, sub!.id));
    expect(after!.status).toBe('active');
    expect(after!.confirmedAt).not.toBeNull();

    // Signing up again while active: same answer, no email (no list lookups through the form).
    clock = new Date(clock.getTime() + 3_600_000);
    expect(await signup(deps(), input)).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('honeypot, bad addresses and per-IP limits', async () => {
    expect(
      await signup(deps(), {
        townId: ids.boca!,
        email: 'bot@example.com',
        ip: '3.3.3.3',
        sourceUrl: 'x',
        honeypot: 'http://spam',
      }),
    ).toBe('ok');
    expect(
      await signup(deps(), {
        townId: ids.boca!,
        email: 'not an email',
        ip: '3.3.3.3',
        sourceUrl: 'x',
      }),
    ).toBe('invalid');
    for (let i = 0; i < 5; i++)
      expect(
        await signup(deps(), {
          townId: ids.boca!,
          email: `ip${i}@example.com`,
          ip: '4.4.4.4',
          sourceUrl: 'x',
        }),
      ).toBe('ok');
    expect(
      await signup(deps(), {
        townId: ids.boca!,
        email: 'ip5@example.com',
        ip: '4.4.4.4',
        sourceUrl: 'x',
      }),
    ).toBe('rate_limited');
    expect(sent.map((s) => s.to[0])).toEqual([
      'ip0@example.com',
      'ip1@example.com',
      'ip2@example.com',
      'ip3@example.com',
      'ip4@example.com',
    ]);
    const [bot] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.email, 'bot@example.com'));
    expect(bot).toBeUndefined();
  });

  it('a hard-bounced address gets no confirmation', async () => {
    await db
      .insert(suppressions)
      .values({ email: 'gone@example.com', scope: 'global', reason: 'hard_bounce' });
    expect(
      await signup(deps(), {
        townId: ids.boca!,
        email: 'gone@example.com',
        ip: '5.5.5.5',
        sourceUrl: 'x',
      }),
    ).toBe('ok');
    expect(sent).toHaveLength(0);
  });

  it('campaigns need an admin approval; newsletters need the standing approval', async () => {
    const c = await createCampaign(db, reviewer, {
      domainId: ids['boca.test']!,
      subject: 'News from {{site_name}}',
      body: '**Hi** {{town_name}}',
    });
    expect(c).toMatchObject({
      status: 'draft',
      subject: 'News from boca Ledger',
      text: '**Hi** boca',
    });
    expect(c.html).toContain('<strong>Hi</strong>');
    await expect(approveCampaign(db, reviewer, c.id)).rejects.toThrow(CampaignError);
    const approved = await approveCampaign(db, admin, c.id);
    expect(approved).toMatchObject({ status: 'scheduled', approvedBy: admin.id });
    await db.update(emailCampaigns).set({ status: 'cancelled' }).where(eq(emailCampaigns.id, c.id));

    const issue = {
      domainId: ids['boca.test']!,
      issueId: null as unknown as string,
      subject: 's',
      html: 'h',
      text: 't',
      at: clock,
    };
    await expect(scheduleNewsletterIssue(db, issue)).rejects.toThrow(/isn’t approved/);
    await expect(setNewsletterApproval(db, reviewer, ids['boca.test']!, true)).rejects.toThrow(
      CampaignError,
    );
    await setNewsletterApproval(db, admin, ids['boca.test']!, true);
    const audit = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, ids['boca.test']!));
    expect(audit.map((a) => a.action)).toEqual(['newsletter_approve']);
    await setNewsletterApproval(db, admin, ids['boca.test']!, false);
  });

  it('templates fan out with each town’s variables', async () => {
    const t = await createTemplate(db, admin, {
      name: 'Welcome',
      subject: 'Welcome to {{site_name}}',
      body: 'Hello from {{domain}}',
    });
    const out = await fanOutTemplate(db, admin, t.id, [ids['boca.test']!, ids['harbor.test']!]);
    expect(out.map((c) => [c.subject, c.text])).toEqual([
      ['Welcome to boca Ledger', 'Hello from boca.test'],
      ['Welcome to harbor Ledger', 'Hello from harbor.test'],
    ]);
  });

  it('sends under the warm-up cap, defers the rest, and never sends twice', async () => {
    clock = new Date('2026-10-20T12:00:00Z');
    await activeSubscribers(ids.harbor!, 70, 'h');
    await db
      .insert(subscribers)
      .values({ townId: ids.harbor!, email: 'unsub@example.com', status: 'unsubscribed' });
    const c = await createCampaign(db, admin, {
      domainId: ids['harbor.test']!,
      subject: 'Hi',
      body: 'Body',
    });
    await approveCampaign(db, admin, c.id, new Date(clock.getTime() - 1000));
    expect(await expandDueCampaigns(db, clock)).toBe(1);
    expect(await expandDueCampaigns(db, clock)).toBe(0);
    const rows = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.campaignId, c.id));
    expect(rows).toHaveLength(70);

    const first = await sendDueBatches(deps());
    expect(first).toMatchObject({ sent: 50, deferred: 0 });
    // The most recently confirmed go first during warm-up.
    expect(sent[0]!.to).toEqual(['h0@example.com']);
    expect(sent[0]!.tags).toMatchObject({
      stream: 'bulk',
      campaign: c.id,
      domain_id: ids['harbor.test'],
    });
    const second = await sendDueBatches(deps());
    expect(second).toMatchObject({ sent: 0, deferred: 20 });
    expect(sent).toHaveLength(50);

    // A claimed row left behind by a crash is given up, not re-sent.
    const [stuck] = await db
      .update(emailCampaignSends)
      .set({ status: 'sending', claimedAt: new Date(clock.getTime() - 3_600_000) })
      .where(eq(emailCampaignSends.email, 'h60@example.com'))
      .returning();
    expect(stuck).toBeDefined();

    // Next day: the deferred rows go out first, the stuck one doesn't.
    clock = new Date('2026-10-21T12:00:00Z');
    const third = await sendDueBatches(deps());
    expect(third).toMatchObject({ sent: 19, finished: 1 });
    const all = sent.map((s) => s.to[0]);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('h60@example.com');
    const [after] = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.email, 'h60@example.com'));
    expect(after).toMatchObject({ status: 'failed' });
    expect(after!.error).toMatch(/outcome unknown/);
    const [done] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(done!.status).toBe('sent');
  });

  it('pause and resume pick up where it stopped', async () => {
    clock = new Date('2026-10-22T12:00:00Z');
    const c = await createCampaign(db, admin, {
      domainId: ids['harbor.test']!,
      subject: 'Two',
      body: 'Body',
    });
    await approveCampaign(db, admin, c.id, clock);
    await expandDueCampaigns(db, clock);
    await pauseCampaign(db, admin, c.id);
    expect((await sendDueBatches(deps())).sent).toBe(0);
    await resumeCampaign(db, admin, c.id);
    expect((await sendDueBatches(deps())).sent).toBe(50);
  });

  it('one-click unsubscribe works at once and cancels queued sends', async () => {
    const [sub] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.email, 'h69@example.com'));
    const [queued] = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.subscriberId, sub!.id))
      .orderBy(emailCampaignSends.createdAt);
    await db
      .update(emailCampaignSends)
      .set({ status: 'queued' })
      .where(eq(emailCampaignSends.id, queued!.id));
    expect(await unsubscribeByToken(deps(), 'nonsense')).toBeNull();
    expect(await unsubscribeByToken(deps(), unsubscribeToken(SECRET, sub!.id))).toMatchObject({
      email: 'h69@example.com',
    });
    const [after] = await db.select().from(subscribers).where(eq(subscribers.id, sub!.id));
    expect(after!.status).toBe('unsubscribed');
    const [send] = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.id, queued!.id));
    expect(send!.status).toBe('suppressed');
    const supp = await db
      .select()
      .from(suppressions)
      .where(eq(suppressions.email, 'h69@example.com'));
    expect(supp).toMatchObject([
      { reason: 'unsubscribe', scope: 'domain', domainId: ids['harbor.test'] },
    ]);
  });

  it('bulk events update sends, subscribers and health; complaints auto-pause that domain only', async () => {
    const harbor = ids['harbor.test']!;
    const tags = (extra: Record<string, string> = {}) =>
      Object.fromEntries(
        Object.entries({ domain_id: harbor, stream: 'bulk', ...extra }).map(([k, v]) => [k, [v]]),
      );
    const sends = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.status, 'sent'));
    const day = new Date('2026-10-22T13:00:00Z').toISOString();
    for (const s of sends)
      await event({
        eventType: 'Send',
        mail: { messageId: s.sesMessageId, timestamp: day, destination: [s.email], tags: tags() },
      });
    const victim = sends[0]!;
    const complaint = {
      eventType: 'Complaint',
      mail: {
        messageId: victim.sesMessageId,
        timestamp: day,
        destination: [victim.email],
        tags: tags(),
      },
      complaint: {
        complainedRecipients: [{ emailAddress: victim.email }],
        complaintFeedbackType: 'abuse',
        timestamp: day,
      },
    };
    const [stored] = await db
      .insert(mailEvents)
      .values({
        snsMessageId: 'sns-complaint',
        topicArn: 'arn:aws:sns:us-east-1:1:events',
        type: 'Complaint',
        payload: complaint,
      })
      .returning();
    await event(complaint, stored!.id);
    await event(complaint, stored!.id); // processed again after a retry: counted once

    const [send] = await db
      .select()
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.id, victim.id));
    expect(send!.status).toBe('complained');
    const [sub] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, victim.subscriberId));
    expect(sub!.status).toBe('complained');
    const health = await db
      .select()
      .from(domainHealthDaily)
      .where(eq(domainHealthDaily.domainId, harbor));
    expect(health).toEqual([
      expect.objectContaining({ stream: 'bulk', sent: sends.length, complained: 1 }),
    ]);

    const result = await runAutoPause(db, new Date('2026-10-22T14:00:00Z'));
    expect(result.paused.map((p) => p.name)).toEqual(['harbor.test']);
    expect(result.network).toBeNull();
    const domains = await db.select().from(mailDomains);
    const status = Object.fromEntries(domains.map((d) => [d.name, d.bulkStatus]));
    expect(status).toMatchObject({ 'harbor.test': 'paused', 'boca.test': 'warming' });
    expect(domains.find((d) => d.name === 'harbor.test')!.pausedReason).toMatch(
      /complaint rate [0-9.]+% over 0\.08% \(1 of /,
    );
    expect(await networkBulkPause(db)).toBeNull();
  });

  it('the warm-up day advances on a healthy day and holds after a breach', async () => {
    const boca = ids['boca.test']!;
    await db
      .insert(domainHealthDaily)
      .values({ domainId: boca, date: '2026-10-22', stream: 'bulk', sent: 50, delivered: 50 });
    const out = await runWarmupDay(db, new Date('2026-10-23T01:00:00Z'));
    expect(out).toEqual([{ domain: 'boca.test', change: 'advanced', cap: 50 }]);
    expect(await runWarmupDay(db, new Date('2026-10-23T05:00:00Z'))).toEqual([]);
    await db
      .insert(domainHealthDaily)
      .values({ domainId: boca, date: '2026-10-23', stream: 'bulk', sent: 50, bounced: 5 });
    expect(await runWarmupDay(db, new Date('2026-10-24T01:00:00Z'))).toEqual([
      { domain: 'boca.test', change: 'held', cap: 50 },
    ]);
  });
});
