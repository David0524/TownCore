import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  mailAlerts,
  mailDomains,
  mailEvents,
  or,
  sql,
  staff,
  type Db,
} from '@towncore/db';
import { publisher } from '@towncore/config';
import { boughtDomains, ONBOARD_GRACE_MS } from '../bought';
import { healthTotals, networkBulkPause } from '../bulk/health';
import type { MailTransport } from '../outbound/transport';
import { storedAccountStatus } from './account';
import { sendStaffEmail } from './staff-email';

// Mail health alerts (docs/plans/MAIL.md, Mail-6). Each run works out what is wrong right now,
// keeps one open alert per condition, resolves the ones that cleared, and emails admins about
// new and resolved alerts (and repeats a still-open one once a day).

export type Condition = { key: string; severity: 'warning' | 'critical'; message: string };

/** 60% of SES's review levels (5% bounces, 0.1% complaints): early warning, not a pause. */
export const ACCOUNT_WARN = { bounceRate: 0.03, complaintRate: 0.0006, minSample: 500 };
const REPEAT_MS = 24 * 3_600_000;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export async function currentConditions(db: Db, now = new Date()): Promise<Condition[]> {
  const out: Condition[] = [];
  const paused = await db
    .select({ id: mailDomains.id, name: mailDomains.name, reason: mailDomains.pausedReason })
    .from(mailDomains)
    .where(eq(mailDomains.bulkStatus, 'paused'));
  for (const d of paused)
    out.push({
      key: `domain_paused:${d.id}`,
      severity: 'critical',
      message: `Bulk mail paused for ${d.name}: ${d.reason ?? 'no reason recorded'}`,
    });

  const network = await networkBulkPause(db);
  if (network)
    out.push({
      key: 'network_paused',
      severity: 'critical',
      message: `Bulk mail paused for every town: ${network.reason}`,
    });

  const account = await storedAccountStatus(db);
  if (account && account.enforcementStatus !== 'HEALTHY')
    out.push({
      key: `ses_enforcement:${account.enforcementStatus}`,
      severity: 'critical',
      message: `SES account status is ${account.enforcementStatus} (checked ${account.checkedAt}). See the runbook: "Handling an SES account review".`,
    });

  const totals = await healthTotals(db, { since: new Date(now.getTime() - 6 * 86_400_000) });
  if (totals.sent >= ACCOUNT_WARN.minSample) {
    const bounce = totals.bounced / totals.sent;
    const complaint = totals.complained / totals.sent;
    if (bounce >= ACCOUNT_WARN.bounceRate)
      out.push({
        key: 'account_bounce_rate',
        severity: 'warning',
        message: `Account bounce rate ${pct(bounce)} over 7 days (SES reviews at 5%; bulk pauses at 4%)`,
      });
    if (complaint >= ACCOUNT_WARN.complaintRate)
      out.push({
        key: 'account_complaint_rate',
        severity: 'warning',
        message: `Account complaint rate ${pct(complaint)} over 7 days (SES reviews at 0.1%; bulk pauses at 0.08%)`,
      });
  }

  const failed = await db
    .select({ name: mailDomains.name, id: mailDomains.id, reason: mailDomains.failureReason })
    .from(mailDomains)
    .where(eq(mailDomains.status, 'failed'));
  for (const d of failed)
    out.push({
      key: `onboarding_failed:${d.id}`,
      severity: 'warning',
      message: `Onboarding failed for ${d.name}: ${d.reason ?? 'see Admin → Mail domains'}`,
    });

  // Warm-up starts at purchase (owner, 2026-10-17): a bought domain must not sit un-onboarded.
  for (const d of await boughtDomains(db)) {
    if (d.mail || !d.boughtAt || now.getTime() - d.boughtAt.getTime() < ONBOARD_GRACE_MS) continue;
    out.push({
      key: `bought_not_onboarded:${d.domain}`,
      severity: 'warning',
      message: `${d.domain} was bought ${d.boughtAt.toISOString().slice(0, 10)} but its mail onboarding hasn't started, so it isn't warming up${d.startBy ? ` (cohort ${d.cohort} wants it by ${d.startBy})` : ''}. Run pnpm mail:onboard bought --execute (see the runbook).`,
    });
  }

  const [events] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mailEvents)
    // A failed event's next_attempt_at is set when it gives up, so it dates the failure.
    .where(
      and(
        eq(mailEvents.status, 'failed'),
        gte(mailEvents.nextAttemptAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  if (events && events.n > 0)
    out.push({
      key: 'mail_events_failed',
      severity: 'warning',
      message: `${events.n} mail event(s) failed in the last 24 hours after all retries (inbound mail or delivery reports). See the runbook: "How inbound mail flows".`,
    });
  return out;
}

export type AlertRun = { opened: Condition[]; resolved: string[]; notified: number };

/** Updates mail_alerts from the current conditions; returns what is new and what cleared. */
export async function syncAlerts(
  db: Db,
  conditions: Condition[],
  now = new Date(),
): Promise<AlertRun> {
  const open = await db.select().from(mailAlerts).where(isNull(mailAlerts.resolvedAt));
  const openKeys = new Map(open.map((a) => [a.key, a]));
  const current = new Set(conditions.map((c) => c.key));
  const opened: Condition[] = [];
  for (const c of conditions) {
    if (openKeys.has(c.key)) {
      await db
        .update(mailAlerts)
        .set({ lastSeenAt: now, message: c.message, severity: c.severity })
        .where(eq(mailAlerts.id, openKeys.get(c.key)!.id));
    } else {
      await db
        .insert(mailAlerts)
        .values({
          key: c.key,
          severity: c.severity,
          message: c.message,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoNothing();
      opened.push(c);
    }
  }
  const resolved = open.filter((a) => !current.has(a.key));
  if (resolved.length)
    await db
      .update(mailAlerts)
      .set({ resolvedAt: now })
      .where(
        inArray(
          mailAlerts.id,
          resolved.map((a) => a.id),
        ),
      );
  return { opened, resolved: resolved.map((a) => a.key), notified: 0 };
}

/** Admin addresses on the company domain: the only possible alert recipients. */
export async function alertRecipients(db: Db): Promise<string[]> {
  const rows = await db
    .select({ email: staff.email })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.role, 'admin')));
  return rows.map((r) => r.email).filter((e) => e.toLowerCase().endsWith(`@${publisher.hqDomain}`));
}

/**
 * Emails admins once about each new alert, again every 24 hours while it stays open, and once
 * when it resolves. Marks what was sent so a retried run doesn't repeat it.
 */
export async function notifyAlerts(
  db: Db,
  mail: { transport: MailTransport; configurationSet: string } | null,
  now = new Date(),
): Promise<number> {
  const due = await db
    .select()
    .from(mailAlerts)
    .where(
      or(
        and(
          isNull(mailAlerts.resolvedAt),
          or(
            isNull(mailAlerts.lastNotifiedAt),
            lt(mailAlerts.lastNotifiedAt, new Date(now.getTime() - REPEAT_MS)),
          ),
        ),
        and(
          isNotNull(mailAlerts.resolvedAt),
          isNotNull(mailAlerts.lastNotifiedAt),
          isNull(mailAlerts.resolvedNotifiedAt),
        ),
      ),
    )
    .orderBy(asc(mailAlerts.severity), asc(mailAlerts.firstSeenAt));
  if (!due.length || !mail) return 0;
  const to = await alertRecipients(db);
  if (!to.length) return 0;
  const active = due.filter((a) => !a.resolvedAt);
  const cleared = due.filter((a) => a.resolvedAt);
  const critical = active.some((a) => a.severity === 'critical');
  const subject = active.length
    ? `${critical ? '[Critical] ' : ''}TownCore alerts: ${active.length} open${cleared.length ? `, ${cleared.length} resolved` : ''}`
    : `TownCore alerts: ${cleared.length} resolved`;
  const lines = [
    ...active.map(
      (a) => `${a.severity.toUpperCase()}: ${a.message} (since ${a.firstSeenAt.toISOString()})`,
    ),
    ...cleared.map((a) => `RESOLVED: ${a.message}`),
    '',
    'Details: Admin → Health and Admin → Mail health. Procedures: docs/mail/RUNBOOK.md.',
  ];
  await sendStaffEmail(mail.transport, mail.configurationSet, {
    to,
    subject,
    text: lines.join('\n'),
  });
  if (active.length)
    await db
      .update(mailAlerts)
      .set({ lastNotifiedAt: now })
      .where(
        inArray(
          mailAlerts.id,
          active.map((a) => a.id),
        ),
      );
  if (cleared.length)
    await db
      .update(mailAlerts)
      .set({ resolvedNotifiedAt: now })
      .where(
        inArray(
          mailAlerts.id,
          cleared.map((a) => a.id),
        ),
      );
  return due.length;
}

export async function runAlerts(
  db: Db,
  mail: { transport: MailTransport; configurationSet: string } | null,
  now = new Date(),
  /** Conditions from outside mail (M8: sources, spend, review queue, worker), same table. */
  extra: Condition[] = [],
): Promise<AlertRun> {
  const run = await syncAlerts(db, [...(await currentConditions(db, now)), ...extra], now);
  run.notified = await notifyAlerts(db, mail, now);
  return run;
}
