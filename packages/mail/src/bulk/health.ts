import {
  and,
  domainHealthDaily,
  emailCampaigns,
  eq,
  gte,
  inArray,
  mailDomains,
  isNull,
  lt,
  mailSettings,
  or,
  sql,
  type Db,
} from '@towncore/db';
import { BULK_CONFIG } from './config';
import { nextWarmup, warmupCap } from './warmup';

// Domain health and auto-pause (brief §7.2). SES events add to domain_health_daily; every few
// minutes the worker reads the trailing window and pauses bulk mail for a domain (or for every
// town) whose bounce or complaint rate crosses the thresholds. Replies are never paused here.

export type HealthField = 'sent' | 'delivered' | 'bounced' | 'complained';
export type HealthTotals = Record<HealthField, number>;

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

export async function bumpHealth(
  db: Db,
  entry: { domainId: string; stream: string; at: Date; field: HealthField },
): Promise<void> {
  const column = domainHealthDaily[entry.field];
  await db
    .insert(domainHealthDaily)
    .values({
      domainId: entry.domainId,
      stream: entry.stream,
      date: utcDate(entry.at),
      [entry.field]: 1,
    })
    .onConflictDoUpdate({
      target: [domainHealthDaily.domainId, domainHealthDaily.date, domainHealthDaily.stream],
      set: { [entry.field]: sql`${column} + 1` },
    });
}

/** Sums the window for one domain (or the whole account), optionally one stream. */
export async function healthTotals(
  db: Db,
  options: { domainId?: string; stream?: string; since: Date },
): Promise<HealthTotals> {
  const [row] = await db
    .select({
      sent: sql<number>`coalesce(sum(${domainHealthDaily.sent}), 0)::int`,
      delivered: sql<number>`coalesce(sum(${domainHealthDaily.delivered}), 0)::int`,
      bounced: sql<number>`coalesce(sum(${domainHealthDaily.bounced}), 0)::int`,
      complained: sql<number>`coalesce(sum(${domainHealthDaily.complained}), 0)::int`,
    })
    .from(domainHealthDaily)
    .where(
      and(
        gte(domainHealthDaily.date, utcDate(options.since)),
        options.domainId ? eq(domainHealthDaily.domainId, options.domainId) : undefined,
        options.stream ? eq(domainHealthDaily.stream, options.stream) : undefined,
      ),
    );
  return row ?? { sent: 0, delivered: 0, bounced: 0, complained: 0 };
}

export type Thresholds = { bounceRate: number; complaintRate: number; minSample: number };

/** A plain-words reason if the totals cross a threshold, else null. */
export function rateBreach(t: HealthTotals, limits: Thresholds): string | null {
  if (t.sent < limits.minSample) return null;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const bounce = t.bounced / t.sent;
  const complaint = t.complained / t.sent;
  if (bounce > limits.bounceRate)
    return `bounce rate ${pct(bounce)} over ${pct(limits.bounceRate)} (${t.bounced} of ${t.sent})`;
  if (complaint > limits.complaintRate)
    return `complaint rate ${pct(complaint)} over ${pct(limits.complaintRate)} (${t.complained} of ${t.sent})`;
  return null;
}

export const domainThresholds: Thresholds = {
  bounceRate: BULK_CONFIG.autoPause.domainBounceRate,
  complaintRate: BULK_CONFIG.autoPause.domainComplaintRate,
  minSample: BULK_CONFIG.autoPause.minSample,
};

export async function pauseDomainBulk(db: Db, domainId: string, reason: string): Promise<void> {
  await db
    .update(mailDomains)
    .set({ bulkStatus: 'paused', pausedReason: reason })
    .where(eq(mailDomains.id, domainId));
  await db
    .update(emailCampaigns)
    .set({ status: 'paused', pausedReason: reason })
    .where(
      and(
        eq(emailCampaigns.domainId, domainId),
        inArray(emailCampaigns.status, ['scheduled', 'sending']),
      ),
    );
}

export type BulkPause = { reason: string; at: string; by?: string };

export async function networkBulkPause(db: Db): Promise<BulkPause | null> {
  const [row] = await db.select().from(mailSettings).where(eq(mailSettings.key, 'bulk_paused'));
  return (row?.value as BulkPause | null | undefined) ?? null;
}

export async function setNetworkBulkPause(db: Db, pause: BulkPause | null): Promise<void> {
  if (!pause) {
    await db.delete(mailSettings).where(eq(mailSettings.key, 'bulk_paused'));
    return;
  }
  await db
    .insert(mailSettings)
    .values({ key: 'bulk_paused', value: pause })
    .onConflictDoUpdate({ target: mailSettings.key, set: { value: pause } });
}

export type AutoPauseResult = {
  paused: { domainId: string; name: string; reason: string }[];
  network: string | null;
};

export async function runAutoPause(db: Db, now = new Date()): Promise<AutoPauseResult> {
  const cfg = BULK_CONFIG.autoPause;
  const since = new Date(now.getTime() - (cfg.windowDays - 1) * 86_400_000);
  const result: AutoPauseResult = { paused: [], network: null };

  const domains = await db
    .select({ id: mailDomains.id, name: mailDomains.name })
    .from(mailDomains)
    .where(inArray(mailDomains.bulkStatus, ['warming', 'active']));
  for (const d of domains) {
    const totals = await healthTotals(db, { domainId: d.id, stream: 'bulk', since });
    const breach = rateBreach(totals, domainThresholds);
    if (!breach) continue;
    const reason = `Auto-paused ${now.toISOString().slice(0, 10)}: bulk ${breach} over ${cfg.windowDays} days`;
    await pauseDomainBulk(db, d.id, reason);
    result.paused.push({ domainId: d.id, name: d.name, reason });
  }

  if (!(await networkBulkPause(db))) {
    const all = await healthTotals(db, { since });
    const breach = rateBreach(all, {
      bounceRate: cfg.networkBounceRate,
      complaintRate: cfg.networkComplaintRate,
      minSample: cfg.networkMinSample,
    });
    if (breach) {
      result.network = `Auto-paused: all mail ${breach} over ${cfg.windowDays} days`;
      await setNetworkBulkPause(db, { reason: result.network, at: now.toISOString() });
    }
  }
  return result;
}

export type WarmupDayResult = { domain: string; change: string; cap: number }[];

/**
 * Once a day per warming domain (brief §7.4): judge yesterday's bulk mail and move the ramp.
 * A day with no bulk sends changes nothing, so an idle domain doesn't ramp up unused.
 */
export async function runWarmupDay(db: Db, now = new Date()): Promise<WarmupDayResult> {
  const today = utcDate(now);
  const yesterday = utcDate(new Date(now.getTime() - 86_400_000));
  const due = await db
    .select()
    .from(mailDomains)
    .where(
      and(
        eq(mailDomains.bulkStatus, 'warming'),
        or(isNull(mailDomains.warmupCheckedOn), lt(mailDomains.warmupCheckedOn, today)),
      ),
    );
  const out: WarmupDayResult = [];
  for (const d of due) {
    const [day] = await db
      .select()
      .from(domainHealthDaily)
      .where(
        and(
          eq(domainHealthDaily.domainId, d.id),
          eq(domainHealthDaily.date, yesterday),
          eq(domainHealthDaily.stream, 'bulk'),
        ),
      );
    if (!day || day.sent === 0) {
      const cap = warmupCap(d.warmupDay, d.bulkTargetCap);
      await db
        .update(mailDomains)
        .set({ warmupCheckedOn: today, bulkDailyCap: cap })
        .where(eq(mailDomains.id, d.id));
      out.push({ domain: d.name, change: 'idle', cap });
      continue;
    }
    const breached = rateBreach(day, { ...domainThresholds, minSample: 1 }) !== null;
    const step = nextWarmup(
      { warmupDay: d.warmupDay, warmupBreaches: d.warmupBreaches, target: d.bulkTargetCap },
      breached,
    );
    await db
      .update(mailDomains)
      .set({
        warmupDay: step.warmupDay,
        warmupBreaches: step.warmupBreaches,
        bulkDailyCap: step.cap,
        warmupCheckedOn: today,
        ...(step.complete ? { bulkStatus: 'active' as const } : {}),
      })
      .where(eq(mailDomains.id, d.id));
    out.push({ domain: d.name, change: step.complete ? 'complete' : step.change, cap: step.cap });
  }
  return out;
}
