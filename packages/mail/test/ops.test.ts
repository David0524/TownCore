import { GetAccountCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import {
  domainHealthDaily,
  eq,
  isNull,
  mailAlerts,
  mailDomains,
  mailEvents,
  staff,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { simpleParser } from 'mailparser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setNetworkBulkPause } from '../src/bulk/health';
import { refreshAccountStatus, sesAccount, storedAccountStatus } from '../src/ops/account';
import { currentConditions, notifyAlerts, runAlerts, syncAlerts } from '../src/ops/alerts';
import { mailHealthSnapshot, rate } from '../src/ops/health';
import { NotStaffAddress, sendStaffEmail } from '../src/ops/staff-email';
import type { MailTransport, SendRequest } from '../src/outbound/transport';

const sent: SendRequest[] = [];
const transport: MailTransport = {
  name: 'ses',
  async send(r) {
    sent.push(r);
    return { sesMessageId: `ses-${sent.length}` };
  },
};
const mail = { transport, configurationSet: 'towncore-conversational' };

describe('SES account status', () => {
  it('reads GetAccount', async () => {
    const calls: unknown[] = [];
    const client = {
      async send(cmd: unknown) {
        calls.push(cmd);
        return {
          EnforcementStatus: 'PROBATION',
          ProductionAccessEnabled: true,
          SendingEnabled: true,
          SendQuota: { Max24HourSend: 50000, SentLast24Hours: 120, MaxSendRate: 14 },
        };
      },
    } as unknown as SESv2Client;
    expect(await sesAccount({ region: 'us-east-1', client }).getAccount()).toEqual({
      enforcementStatus: 'PROBATION',
      productionAccess: true,
      sendingEnabled: true,
      max24HourSend: 50000,
      sentLast24Hours: 120,
      maxSendRate: 14,
    });
    expect(calls[0]).toBeInstanceOf(GetAccountCommand);
  });
});

describe('staff email', () => {
  it('goes only to company addresses', async () => {
    await expect(
      sendStaffEmail(transport, 'set', {
        to: ['ed@towncore.net', 'someone@gmail.com'],
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(NotStaffAddress);
    await sendStaffEmail(transport, 'set', {
      to: ['ed@towncore.net'],
      subject: 'Hello',
      text: 'Body',
    });
    const m = await simpleParser(sent.at(-1)!.raw);
    expect(m.from?.text).toBe('"TownCore alerts" <alerts@towncore.net>');
    expect(m.headers.get('auto-submitted')).toBe('auto-generated');
    expect(sent.at(-1)!.tags).toEqual({ stream: 'staff', kind: 'alert' });
  });
});

describe('alerts against Postgres', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const t0 = new Date('2026-10-15T12:00:00Z');
  const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);
  let boca: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const domains = await db
      .insert(mailDomains)
      .values([
        {
          name: 'boca.test',
          displayName: 'Boca',
          status: 'live',
          bulkStatus: 'paused',
          pausedReason: 'complaint rate 0.9%',
        },
        {
          name: 'broken.test',
          displayName: 'Broken',
          status: 'failed',
          failureReason: 'MX conflict',
        },
      ])
      .returning();
    boca = domains[0]!.id;
    await db.insert(staff).values([
      { email: 'ed@towncore.net', name: 'Ed', role: 'admin' },
      { email: 'rae@towncore.net', name: 'Rae', role: 'reviewer' },
      { email: 'outside@example.com', name: 'Out', role: 'admin' },
    ]);
  });
  afterAll(async () => drop?.());

  it('finds every condition', async () => {
    await setNetworkBulkPause(db, { reason: 'complaints 0.09%', at: t0.toISOString() });
    await refreshAccountStatus(
      db,
      {
        async getAccount() {
          return {
            enforcementStatus: 'PROBATION',
            productionAccess: true,
            sendingEnabled: true,
            max24HourSend: 1,
            sentLast24Hours: 0,
            maxSendRate: 1,
          };
        },
      },
      t0,
    );
    expect((await storedAccountStatus(db))?.enforcementStatus).toBe('PROBATION');
    await db.insert(domainHealthDaily).values({
      domainId: boca,
      date: '2026-10-14',
      stream: 'bulk',
      sent: 1000,
      delivered: 960,
      bounced: 35,
      complained: 1,
    });
    await db.insert(mailEvents).values({
      snsMessageId: 'x',
      topicArn: 'arn',
      type: 'Received',
      payload: {},
      status: 'failed',
      nextAttemptAt: later(-1),
    });
    const keys = (await currentConditions(db, t0))
      .map((c) => `${c.severity}:${c.key.split(':')[0]}`)
      .sort();
    expect(keys).toEqual([
      'critical:domain_paused',
      'critical:network_paused',
      'critical:ses_enforcement',
      'warning:account_bounce_rate',
      'warning:account_complaint_rate',
      'warning:mail_events_failed',
      'warning:onboarding_failed',
    ]);
  });

  it('emails admins once, repeats daily, and reports resolution once', async () => {
    sent.length = 0;
    const first = await runAlerts(db, mail, t0);
    expect(first.opened).toHaveLength(7);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['ed@towncore.net']);
    const m = await simpleParser(sent[0]!.raw);
    expect(m.subject).toBe('[Critical] TownCore alerts: 7 open');
    expect(m.text).toContain('CRITICAL: Bulk mail paused for boca.test: complaint rate 0.9%');

    // Same conditions an hour later: nothing new, nothing sent.
    const again = await runAlerts(db, mail, later(1));
    expect(again.opened).toEqual([]);
    expect(sent).toHaveLength(1);

    // The network pause clears: one "resolved" line next time, then never again.
    await setNetworkBulkPause(db, null);
    await runAlerts(db, mail, later(2));
    expect(sent).toHaveLength(2);
    const m2 = await simpleParser(sent[1]!.raw);
    expect(m2.subject).toBe('TownCore alerts: 1 resolved');
    expect(m2.text).toContain('RESOLVED: Bulk mail paused for every town');
    await runAlerts(db, mail, later(3));
    expect(sent).toHaveLength(2);

    // Still open a day later: reminded.
    await runAlerts(db, mail, later(25));
    expect(sent).toHaveLength(3);
    const open = await db.select().from(mailAlerts).where(eq(mailAlerts.key, 'network_paused'));
    expect(open[0]!.resolvedAt).not.toBeNull();
  });

  it('a condition that returns opens a new alert; no mail transport means nothing is sent', async () => {
    await setNetworkBulkPause(db, { reason: 'again', at: t0.toISOString() });
    const run = await syncAlerts(db, await currentConditions(db, later(30)), later(30));
    expect(run.opened.map((c) => c.key)).toEqual(['network_paused']);
    expect(await notifyAlerts(db, null, later(30))).toBe(0);
  });

  it('emails by kind: breakage as before, a backlog weekly when deep and growing, standing never', async () => {
    const standing = {
      key: 'source_broken:draft',
      severity: 'warning' as const,
      message: 'Draft Town: a source is broken.',
      kind: 'standing' as const,
    };
    const backlog = (depth: number, weekAgo: number) => ({
      key: 'review_waiting',
      severity: 'warning' as const,
      message: `REVIEW BACKLOG ${depth}`,
      kind: 'backlog' as const,
      backlog: { depth, ceiling: 10, weekAgo },
    });
    // Everything emailed from here on, as text.
    const mailed = async (from: number) =>
      (await Promise.all(sent.slice(from).map((s) => simpleParser(s.raw))))
        .map((m) => m.text ?? '')
        .join('\n');
    let mark = sent.length;
    const at = (h: number) => later(200 + h);

    // A shallow backlog and a standing fact: both open on the dashboard, neither emailed.
    await runAlerts(db, mail, at(0), [standing, backlog(3, 1)]);
    const open = await db.select().from(mailAlerts).where(isNull(mailAlerts.resolvedAt));
    expect(open.map((a) => a.key)).toEqual(
      expect.arrayContaining(['source_broken:draft', 'review_waiting']),
    );
    expect(await mailed(mark)).not.toMatch(/Draft Town|REVIEW BACKLOG/);

    // Deep and growing: emailed.
    mark = sent.length;
    await runAlerts(db, mail, at(1), [standing, backlog(12, 5)]);
    expect(await mailed(mark)).toContain('WARNING: REVIEW BACKLOG 12');
    // Two days later, still deep and growing: not again within the week.
    mark = sent.length;
    await runAlerts(db, mail, at(49), [standing, backlog(14, 5)]);
    expect(await mailed(mark)).not.toContain('REVIEW BACKLOG');
    // Eight days later: weekly reminder.
    mark = sent.length;
    await runAlerts(db, mail, at(193), [standing, backlog(15, 12)]);
    expect(await mailed(mark)).toContain('WARNING: REVIEW BACKLOG 15');
    // Deep but shrinking a week later: no email.
    mark = sent.length;
    await runAlerts(db, mail, at(361), [standing, backlog(13, 15)]);
    expect(await mailed(mark)).not.toContain('REVIEW BACKLOG');

    // The standing fact clears: it was never emailed, so its resolution isn't either.
    mark = sent.length;
    await runAlerts(db, mail, at(362), [backlog(13, 15)]);
    expect(await mailed(mark)).not.toContain('Draft Town');
    const [gone] = await db
      .select()
      .from(mailAlerts)
      .where(eq(mailAlerts.key, 'source_broken:draft'));
    expect(gone!.resolvedAt).not.toBeNull();
    expect(gone!.lastNotifiedAt).toBeNull();
  });

  it('the snapshot sums streams and rates', async () => {
    const s = await mailHealthSnapshot(db, t0);
    expect(s.account7d).toEqual({ sent: 1000, delivered: 960, bounced: 35, complained: 1 });
    expect(s.domains.find((d) => d.domain.name === 'boca.test')!.streams.bulk?.sent).toBe(1000);
    expect(s.events.failed).toBe(1);
    expect(s.account?.enforcementStatus).toBe('PROBATION');
    expect(rate(35, 1000)).toBe('3.50%');
    expect(rate(1, 0)).toBe('–');
  });
});
