import {
  adminActions,
  dmarcReports,
  dnsRecords,
  eq,
  mailDomains,
  placementResults,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { simpleParser } from 'mailparser';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desiredRecords, planDns } from '../src/dns';
import type { BulkDeps } from '../src/bulk/subscribers';
import {
  latestPlacement,
  PlacementError,
  providerOf,
  recordPlacement,
  sendPlacementTest,
  summarize,
} from '../src/bulk/placement';
import {
  dmarcPolicyAdvice,
  DmarcPolicyError,
  judgeStepUp,
  policyOf,
  reportDomain,
  setDmarcPolicy,
  withPolicy,
} from '../src/ops/dmarc-policy';
import type { MailTransport, SendRequest } from '../src/outbound/transport';
import { fakeDns } from './fakes';

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T12:00:00Z');
const RUA = 'dmarc@towncore.net';
const value = (p: string) => `v=DMARC1; p=${p}; rua=mailto:${RUA}; fo=1`;

describe('DMARC policy values', () => {
  it('reads and changes only the p= tag', () => {
    expect(policyOf(value('none'))).toBe('none');
    expect(policyOf('"v=DMARC1; p=Reject"')).toBe('reject');
    expect(policyOf('v=DMARC1; sp=reject')).toBeNull();
    expect(withPolicy(value('none'), 'quarantine')).toBe(value('quarantine'));
    // sp= is left alone.
    expect(withPolicy('v=DMARC1; p=none; sp=none', 'reject')).toBe('v=DMARC1; p=reject; sp=none');
    expect(() => withPolicy('v=DMARC1; sp=none', 'reject')).toThrow(DmarcPolicyError);
  });

  it('names the domain each record governs', () => {
    expect(reportDomain('boca.test', '_dmarc')).toBe('boca.test');
    expect(reportDomain('boca.test', '_dmarc.news')).toBe('news.boca.test');
  });

  it('onboarding keeps a stepped-up policy: present, not a conflict, not reset', () => {
    const want = desiredRecords({
      region: 'us-east-1',
      dmarcReportAddress: RUA,
      root: { tokens: ['a', 'b', 'c'], signingHostedZone: 'dkim.amazonses.com' },
      news: { tokens: ['d', 'e', 'f'], signingHostedZone: 'dkim.amazonses.com' },
    }).filter((r) => r.purpose === 'dmarc');
    const plan = planDns(want, [
      { id: 'r1', type: 'TXT', name: '_dmarc', value: value('quarantine'), priority: null },
      { id: 'r2', type: 'TXT', name: '_dmarc.news', value: value('none'), priority: null },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.present.map((p) => p.want.value)).toEqual([value('quarantine'), value('none')]);
    // Someone else's policy (another rua) is still a conflict.
    const theirs = planDns(want.slice(0, 1), [
      { id: 'x', type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=reject; rua=mailto:x@y.z' },
    ] as never);
    expect(theirs.conflicts).toHaveLength(1);
  });

  it('judges a step up on days, volume, pass rate and freshness', () => {
    const stats = {
      reports: 20,
      reportDays: 20,
      messages: 1000,
      dmarcPass: 995,
      newestEnd: new Date(NOW.getTime() - DAY),
    };
    const since = new Date(NOW.getTime() - 40 * DAY);
    expect(judgeStepUp('none', since, stats, NOW)).toMatchObject({
      next: 'quarantine',
      ready: true,
    });
    const low = judgeStepUp('none', since, { ...stats, dmarcPass: 900 }, NOW);
    expect(low.ready).toBe(false);
    expect(low.reasons.join(' ')).toMatch(/90\.0% passed DMARC; needs 99%/);
    expect(judgeStepUp('none', since, { ...stats, reportDays: 5 }, NOW).ready).toBe(false);
    expect(judgeStepUp('none', since, { ...stats, messages: 50, dmarcPass: 50 }, NOW).ready).toBe(
      false,
    );
    const stale = { ...stats, newestEnd: new Date(NOW.getTime() - 10 * DAY) };
    expect(judgeStepUp('none', since, stale, NOW).ready).toBe(false);
    // Quarantine needs 30 days at quarantine first.
    const recent = new Date(NOW.getTime() - 10 * DAY);
    expect(judgeStepUp('quarantine', recent, stats, NOW)).toMatchObject({
      next: 'reject',
      ready: false,
    });
    expect(judgeStepUp('quarantine', since, stats, NOW)).toMatchObject({
      next: 'reject',
      ready: true,
    });
    expect(judgeStepUp('reject', since, stats, NOW)).toMatchObject({ next: null, ready: false });
  });
});

describe('against Postgres', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let admin: { id: string; name: string };
  let reviewer: { id: string; name: string };
  let domainId: string;
  let quietId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const [t] = await db
      .insert(towns)
      .values({
        slug: 'boca',
        name: 'Boca Raton',
        state: 'FL',
        county: 'Palm Beach',
        timezone: 'America/New_York',
        domain: 'boca.test',
        siteName: 'Boca Town Square',
        tier: 'large',
        config: {},
      })
      .returning();
    const [d, q] = await db
      .insert(mailDomains)
      .values([
        {
          name: 'boca.test',
          townId: t!.id,
          displayName: 'Boca Town Square',
          status: 'live' as const,
          bulkStatus: 'warming' as const,
        },
        { name: 'quiet.test', displayName: 'Quiet', status: 'onboarding' as const },
      ])
      .returning();
    domainId = d!.id;
    quietId = q!.id;
    const rows = await db
      .insert(staff)
      .values([
        { email: 'ed@towncore.net', name: 'Ed', role: 'admin' as const },
        { email: 'rae@towncore.net', name: 'Rae', role: 'reviewer' as const },
      ])
      .returning();
    admin = { id: rows[0]!.id, name: 'Ed' };
    reviewer = { id: rows[1]!.id, name: 'Rae' };
  });
  afterAll(async () => drop?.());

  describe('DMARC step-up', () => {
    let zones: Record<string, Array<{ id: string; type: string; name: string; value: string }>>;
    let rootId: string;
    let newsId: string;

    beforeEach(async () => {
      await db.delete(dnsRecords);
      await db.delete(dmarcReports);
      zones = {
        'boca.test': [
          { id: 'v_root', type: 'TXT', name: '_dmarc', value: value('none') },
          { id: 'v_news', type: 'TXT', name: '_dmarc.news', value: value('none') },
        ],
      };
      const created = new Date(NOW.getTime() - 60 * DAY);
      const rows = await db
        .insert(dnsRecords)
        .values([
          {
            domainId,
            purpose: 'dmarc' as const,
            type: 'TXT',
            name: '_dmarc',
            value: value('none'),
            vercelRecordId: 'v_root',
            status: 'created' as const,
            createdAt: created,
          },
          {
            domainId,
            purpose: 'dmarc' as const,
            type: 'TXT',
            name: '_dmarc.news',
            value: value('none'),
            vercelRecordId: null,
            status: 'existing' as const,
            createdAt: created,
          },
        ])
        .returning();
      rootId = rows[0]!.id;
      newsId = rows[1]!.id;
      // 20 days of clean reports for the root domain only.
      await db.insert(dmarcReports).values(
        Array.from({ length: 20 }, (_, i) => ({
          orgName: 'google.com',
          reportId: `r${i}`,
          domain: 'boca.test',
          policy: 'none',
          beginAt: new Date(NOW.getTime() - (i + 2) * DAY),
          endAt: new Date(NOW.getTime() - (i + 1) * DAY),
          messages: 50,
          dkimPass: 50,
          spfPass: 50,
          dmarcPass: 50,
          sources: [],
          receivedAt: NOW,
        })),
      );
    });

    const deps = () => {
      const dns = fakeDns(zones as never);
      return { dns: dns.provider, zones: dns.zones, db, offline: false };
    };

    it('advises per record: the root is ready, news has no reports and is not ours', async () => {
      const advice = await dmarcPolicyAdvice(db, NOW);
      const root = advice.find((a) => a.recordId === rootId)!;
      const news = advice.find((a) => a.recordId === newsId)!;
      expect(root).toMatchObject({
        governs: 'boca.test',
        current: 'none',
        next: 'quarantine',
        ready: true,
        editable: true,
      });
      expect(root.stats).toMatchObject({ messages: 1000, dmarcPass: 1000, reportDays: 20 });
      expect(news).toMatchObject({ governs: 'news.boca.test', ready: false, editable: false });
      expect(news.reasons).toContain('No reported mail yet.');
    });

    it('steps up one record we created: new record first, old one deleted, audited', async () => {
      const d = deps();
      expect(await setDmarcPolicy(d, admin, rootId, 'quarantine', NOW)).toEqual({
        from: 'none',
        to: 'quarantine',
      });
      const zone = d.zones['boca.test']!;
      expect(zone.filter((r) => r.name === '_dmarc').map((r) => r.value)).toEqual([
        value('quarantine'),
      ]);
      const [row] = await db.select().from(dnsRecords).where(eq(dnsRecords.id, rootId));
      expect(row).toMatchObject({ value: value('quarantine'), policySetAt: NOW });
      expect(row!.vercelRecordId).not.toBe('v_root');
      const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, rootId));
      expect(log).toMatchObject({ action: 'dmarc_policy', staffId: admin.id });

      // Next: reject waits 30 days at quarantine, judged on reports since the change.
      const [after] = (await dmarcPolicyAdvice(db, NOW)).filter((a) => a.recordId === rootId);
      expect(after).toMatchObject({ current: 'quarantine', next: 'reject', ready: false });
      await expect(setDmarcPolicy(d, admin, rootId, 'reject', NOW)).rejects.toThrow(/Not ready/);
      // Back to none is always allowed.
      await setDmarcPolicy(d, admin, rootId, 'none', NOW);
      expect(d.zones['boca.test']!.find((r) => r.name === '_dmarc')!.value).toBe(value('none'));
    });

    it('refuses reviewers, skipped steps, records we didn’t create, and no credentials', async () => {
      const d = deps();
      await expect(setDmarcPolicy(d, reviewer, rootId, 'quarantine', NOW)).rejects.toThrow(
        /Only an admin/,
      );
      await expect(setDmarcPolicy(d, admin, rootId, 'reject', NOW)).rejects.toThrow(
        /next step is quarantine/,
      );
      await expect(setDmarcPolicy(d, admin, newsId, 'none', NOW)).rejects.toThrow(/didn’t create/);
      await expect(
        setDmarcPolicy({ ...d, offline: true }, admin, rootId, 'quarantine', NOW),
      ).rejects.toThrow(/VERCEL_DNS_TOKEN/);
      // Nothing changed.
      expect(d.zones['boca.test']!.find((r) => r.name === '_dmarc')!.value).toBe(value('none'));
    });

    it('keeps the old policy when the old record can’t be deleted', async () => {
      const d = deps();
      const broken = {
        ...d,
        dns: {
          ...d.dns,
          deleteRecord: async (domain: string, id: string) => {
            if (id === 'v_root') throw new Error('Vercel is down');
            return d.dns.deleteRecord(domain, id);
          },
        },
      };
      await expect(setDmarcPolicy(broken, admin, rootId, 'quarantine', NOW)).rejects.toThrow(
        /Vercel is down/,
      );
      expect(d.zones['boca.test']!.filter((r) => r.name === '_dmarc').map((r) => r.value)).toEqual([
        value('none'),
      ]);
      const [row] = await db.select().from(dnsRecords).where(eq(dnsRecords.id, rootId));
      expect(row!.value).toBe(value('none'));
    });
  });

  describe('inbox placement test', () => {
    let sent: SendRequest[];
    let failFor: string | null;
    let clock: Date;
    const transport: MailTransport = {
      name: 'ses',
      async send(r) {
        if (r.to[0] === failFor) throw new Error('SES said no');
        sent.push(r);
        return { sesMessageId: `ses-${sent.length}` };
      },
    };
    const seeds = ['seed.one@gmail.com', 'Seed@Outlook.com', 'seed@yahoo.com', 'qa@towncore.net'];
    const deps = (over: Partial<BulkDeps & { seeds: string[] }> = {}) => ({
      db,
      transport,
      configurationSet: 'towncore-bulk',
      secret: 'x'.repeat(32),
      postalAddress: '1 Main St, Boca Raton, FL 33432',
      now: () => clock,
      seeds,
      ...over,
    });

    beforeEach(() => {
      sent = [];
      failFor = null;
      clock = new Date(NOW.getTime() + Math.random() * 1000 * DAY);
    });

    it('names providers', () => {
      expect(providerOf('a@gmail.com')).toBe('gmail');
      expect(providerOf('a@hotmail.co.uk')).toBe('outlook');
      expect(providerOf('a@icloud.com')).toBe('icloud');
      expect(providerOf('a@towncore.net')).toBe('towncore.net');
    });

    it('sends one copy to each seed only, as its own stream, then once a day', async () => {
      failFor = 'seed@yahoo.com';
      const result = await sendPlacementTest(deps(), admin, domainId);
      expect(result).toMatchObject({ sent: 3, failed: 1 });
      expect(sent.map((s) => s.to)).toEqual([
        ['seed.one@gmail.com'],
        ['seed@outlook.com'],
        ['qa@towncore.net'],
      ]);
      expect(sent[0]!.tags).toMatchObject({ stream: 'placement', domain: 'boca.test' });
      const mail = await simpleParser(sent[0]!.raw);
      expect(mail.from?.text).toContain('newsletter@news.boca.test');
      expect(mail.subject).toBe('Boca Town Square: your morning briefing');
      expect(mail.text).toContain(`Placement check ${result.token}`);
      expect(sent[0]!.raw.toString()).toMatch(/^List-Unsubscribe: /m);

      await expect(sendPlacementTest(deps(), admin, domainId)).rejects.toThrow(/last 24 hours/);

      const summary = (await latestPlacement(db, [domainId])).get(domainId)!;
      expect(summary.results.find((r) => r.seed === 'seed@yahoo.com')).toMatchObject({
        placement: 'not_sent',
        sendError: 'SES said no',
      });
      expect(summary.line).toBe('0 of 3 in the inbox, 3 not checked yet, 1 not sent');

      const byseed = (s: string) => summary.results.find((r) => r.seed === s)!.id;
      await recordPlacement(db, reviewer, byseed('seed.one@gmail.com'), 'promotions');
      await recordPlacement(db, reviewer, byseed('seed@outlook.com'), 'spam');
      await recordPlacement(db, reviewer, byseed('qa@towncore.net'), 'inbox');
      await expect(
        recordPlacement(db, reviewer, byseed('seed@yahoo.com'), 'inbox'),
      ).rejects.toThrow(PlacementError);
      const after = (await latestPlacement(db, [domainId])).get(domainId)!;
      expect(after).toMatchObject({ sent: 3, checked: 3, delivered: 2, spam: 1 });
      expect(after.line).toBe('2 of 3 in the inbox (1 under Promotions), 1 in spam, 1 not sent');
      const [row] = await db
        .select()
        .from(placementResults)
        .where(eq(placementResults.id, byseed('seed@outlook.com')));
      expect(row).toMatchObject({ placement: 'spam', checkedBy: reviewer.id });
    });

    it('refuses without seeds, with too many, or before the domain can send bulk', async () => {
      await expect(sendPlacementTest(deps({ seeds: [] }), admin, domainId)).rejects.toThrow(
        /PLACEMENT_SEED_ADDRESSES/,
      );
      const many = Array.from({ length: 11 }, (_, i) => `s${i}@gmail.com`);
      await expect(sendPlacementTest(deps({ seeds: many }), admin, domainId)).rejects.toThrow(
        /At most 10/,
      );
      await expect(sendPlacementTest(deps(), admin, quietId)).rejects.toThrow(/finish onboarding/);
      expect(sent).toHaveLength(0);
    });

    it('summarizes with nothing checked', () => {
      const s = summarize({ id: 't', token: 'T', createdAt: NOW }, []);
      expect(s).toMatchObject({ sent: 0, line: '0 of 0 in the inbox' });
    });
  });
});
