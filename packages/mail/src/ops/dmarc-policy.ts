import {
  adminActions,
  and,
  dmarcReports,
  dnsRecords,
  eq,
  gte,
  mailDomains,
  ne,
  staff,
  type Db,
} from '@towncore/db';
import type { DnsProvider } from '../vercel';

// Stepping a domain's DMARC policy up (owner, 2026-10-19): every record starts at p=none, so
// receivers only report. Once the aggregate reports show our mail passing, an admin moves each
// record to quarantine, then reject. Admin → Mail health says when; the change is one press,
// made only on records we created, and p=none is always one press away.

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';
export const DMARC_POLICIES: readonly DmarcPolicy[] = ['none', 'quarantine', 'reject'];

/** When a record is ready for its next step. */
export const STEP_UP = {
  windowDays: 30,
  // Reports on at least this many different days in the window, so one quiet week isn't enough.
  minReportDays: 14,
  minMessages: 200,
  minPassRate: 0.99,
  // Reports still arriving: the newest ended within this many days.
  freshDays: 7,
  // Time at quarantine before reject, judged on reports from after the change only.
  minDaysAtQuarantine: 30,
} as const;

export class DmarcPolicyError extends Error {}

const DAY = 86_400_000;

export function policyOf(value: string): DmarcPolicy | null {
  const m = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i.exec(value.replace(/"/g, ''));
  return m ? (m[1]!.toLowerCase() as DmarcPolicy) : null;
}

/** The same record with only its p= tag changed. */
export function withPolicy(value: string, policy: DmarcPolicy): string {
  const out = value.replace(
    /((?:^|;)\s*p\s*=\s*)(none|quarantine|reject)(\s*(?:;|$))/i,
    (_, a: string, _p: string, b: string) => `${a}${policy}${b}`,
  );
  if (out === value && policyOf(value) !== policy)
    throw new DmarcPolicyError(`No p= tag to change in "${value}".`);
  return out;
}

const nextOf = (p: DmarcPolicy): DmarcPolicy | null =>
  p === 'none' ? 'quarantine' : p === 'quarantine' ? 'reject' : null;

/** `_dmarc` → example.com, `_dmarc.news` → news.example.com (the domain reports name). */
export function reportDomain(domain: string, recordName: string): string {
  const rest = recordName.replace(/^_dmarc\.?/, '');
  return rest ? `${rest}.${domain}` : domain;
}

export type ReportStats = {
  reports: number;
  reportDays: number;
  messages: number;
  dmarcPass: number;
  newestEnd: Date | null;
};

export type PolicyAdvice = {
  recordId: string;
  domainId: string;
  domain: string;
  /** The domain the record governs (reports name it). */
  governs: string;
  current: DmarcPolicy | null;
  next: DmarcPolicy | null;
  ready: boolean;
  /** Why it is or isn't ready, plain sentences. */
  reasons: string[];
  /** Only records we created can be changed from the admin; others are changed by hand. */
  editable: boolean;
  stats: ReportStats;
  policySince: Date;
};

/** Pure: is a record at `current` (since `since`) ready for its next step, given these stats? */
export function judgeStepUp(
  current: DmarcPolicy | null,
  since: Date,
  stats: ReportStats,
  now: Date,
): { next: DmarcPolicy | null; ready: boolean; reasons: string[] } {
  if (!current) return { next: null, ready: false, reasons: ['The record has no p= policy.'] };
  const next = nextOf(current);
  if (!next) return { next: null, ready: false, reasons: ['Already at reject, the strictest.'] };
  const reasons: string[] = [];
  const ok: boolean[] = [];
  const check = (pass: boolean, good: string, bad: string) => {
    ok.push(pass);
    reasons.push(pass ? good : bad);
  };
  if (current === 'quarantine') {
    const days = Math.floor((now.getTime() - since.getTime()) / DAY);
    check(
      days >= STEP_UP.minDaysAtQuarantine,
      `${days} days at quarantine.`,
      `${days} of ${STEP_UP.minDaysAtQuarantine} days at quarantine.`,
    );
  }
  check(
    stats.reportDays >= STEP_UP.minReportDays,
    `Reports on ${stats.reportDays} days.`,
    `Reports on ${stats.reportDays} of ${STEP_UP.minReportDays} days needed.`,
  );
  check(
    stats.messages >= STEP_UP.minMessages,
    `${stats.messages.toLocaleString('en-US')} messages reported.`,
    `${stats.messages.toLocaleString('en-US')} of ${STEP_UP.minMessages} messages reported.`,
  );
  const rate = stats.messages ? stats.dmarcPass / stats.messages : 0;
  const pct = `${(rate * 100).toFixed(1)}%`;
  check(
    stats.messages > 0 && rate >= STEP_UP.minPassRate,
    `${pct} passed DMARC.`,
    stats.messages
      ? `${pct} passed DMARC; needs ${STEP_UP.minPassRate * 100}%. Check the failing sources first.`
      : 'No reported mail yet.',
  );
  const fresh =
    stats.newestEnd !== null &&
    now.getTime() - stats.newestEnd.getTime() <= STEP_UP.freshDays * DAY;
  check(fresh, 'Reports are current.', `No report in the last ${STEP_UP.freshDays} days.`);
  return { next, ready: ok.every(Boolean), reasons };
}

async function statsFor(db: Db, governs: string, since: Date): Promise<ReportStats> {
  const rows = await db
    .select({
      beginAt: dmarcReports.beginAt,
      endAt: dmarcReports.endAt,
      messages: dmarcReports.messages,
      dmarcPass: dmarcReports.dmarcPass,
    })
    .from(dmarcReports)
    .where(and(eq(dmarcReports.domain, governs), gte(dmarcReports.beginAt, since)));
  const days = new Set(rows.map((r) => r.endAt.toISOString().slice(0, 10)));
  return {
    reports: rows.length,
    reportDays: days.size,
    messages: rows.reduce((n, r) => n + r.messages, 0),
    dmarcPass: rows.reduce((n, r) => n + r.dmarcPass, 0),
    newestEnd: rows.reduce<Date | null>((d, r) => (!d || r.endAt > d ? r.endAt : d), null),
  };
}

/** Every DMARC record we know of, with whether it's ready to step up and why. */
export async function dmarcPolicyAdvice(
  db: Db,
  now = new Date(),
  domainId?: string,
): Promise<PolicyAdvice[]> {
  const rows = await db
    .select({ record: dnsRecords, domain: mailDomains.name })
    .from(dnsRecords)
    .innerJoin(mailDomains, eq(mailDomains.id, dnsRecords.domainId))
    .where(
      and(
        eq(dnsRecords.purpose, 'dmarc'),
        ne(dnsRecords.status, 'planned'),
        ne(mailDomains.status, 'removed'),
        domainId ? eq(dnsRecords.domainId, domainId) : undefined,
      ),
    );
  const out: PolicyAdvice[] = [];
  for (const { record, domain } of rows) {
    const current = policyOf(record.value);
    const policySince = record.policySetAt ?? record.createdAt;
    const governs = reportDomain(domain, record.name);
    const windowStart = new Date(now.getTime() - STEP_UP.windowDays * DAY);
    // After a change, only reports from under the new policy count.
    const since =
      record.policySetAt && record.policySetAt > windowStart ? policySince : windowStart;
    const stats = await statsFor(db, governs, since);
    const verdict = judgeStepUp(current, policySince, stats, now);
    out.push({
      recordId: record.id,
      domainId: record.domainId,
      domain,
      governs,
      current,
      ...verdict,
      editable: record.status === 'created' && record.vercelRecordId !== null,
      stats,
      policySince,
    });
  }
  return out.sort((a, b) => a.governs.localeCompare(b.governs));
}

/**
 * Moves one DMARC record we created to `target`: one step stricter when the reports say it's
 * ready, or straight back to none at any time. Admins only, audited. The new record is created
 * before the old one is deleted, so a failure leaves the old policy in place.
 */
export async function setDmarcPolicy(
  deps: { db: Db; dns: DnsProvider; offline: boolean },
  actor: { id: string },
  recordId: string,
  target: DmarcPolicy,
  now = new Date(),
): Promise<{ from: DmarcPolicy; to: DmarcPolicy }> {
  const { db, dns } = deps;
  const [who] = await db.select().from(staff).where(eq(staff.id, actor.id));
  if (who?.role !== 'admin' || !who.active)
    throw new DmarcPolicyError('Only an admin can change a DMARC policy.');
  const [advice] = (await dmarcPolicyAdvice(db, now)).filter((a) => a.recordId === recordId);
  if (!advice) throw new DmarcPolicyError('No such DMARC record.');
  if (!advice.editable)
    throw new DmarcPolicyError(
      'We didn’t create this record, so it is never changed from here. Change it at the DNS host.',
    );
  const from = advice.current;
  if (!from) throw new DmarcPolicyError('The record has no p= policy.');
  if (from === target) throw new DmarcPolicyError(`The policy is already ${target}.`);
  if (target !== 'none') {
    if (target !== advice.next)
      throw new DmarcPolicyError(`From ${from}, the next step is ${advice.next ?? 'none'}.`);
    if (!advice.ready)
      throw new DmarcPolicyError(`Not ready for ${target}: ${advice.reasons.join(' ')}`);
  }
  if (deps.offline)
    throw new DmarcPolicyError('DNS changes need VERCEL_DNS_TOKEN and AWS credentials.');

  const [record] = await db.select().from(dnsRecords).where(eq(dnsRecords.id, recordId));
  const value = withPolicy(record!.value, target);
  const newId = await dns.createRecord(
    advice.domain,
    { purpose: 'dmarc', type: 'TXT', name: record!.name, value },
    `TownCore mail: dmarc p=${target}`,
  );
  try {
    await dns.deleteRecord(advice.domain, record!.vercelRecordId!);
  } catch (error) {
    // Two DMARC records at one name are invalid; take ours back off and keep the old one.
    await dns.deleteRecord(advice.domain, newId).catch(() => undefined);
    throw error;
  }
  await db
    .update(dnsRecords)
    .set({ value, vercelRecordId: newId, policySetAt: now, updatedAt: now })
    .where(eq(dnsRecords.id, recordId));
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: 'dmarc_policy',
    targetType: 'dns_record',
    targetId: recordId,
    detail: { domain: advice.governs, from, to: target, reasons: advice.reasons },
  });
  return { from, to: target };
}
