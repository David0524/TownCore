import {
  asc,
  desc,
  domainHealthDaily,
  gte,
  isNull,
  mailAlerts,
  mailDomains,
  mailEvents,
  sql,
  workerHeartbeats,
  type Db,
} from '@towncore/db';
import { networkBulkPause } from '../bulk/health';
import { storedAccountStatus } from './account';
import { dmarcSummary } from './dmarc';

// Everything Admin → Mail health shows (docs/plans/MAIL.md, Mail-6): one read so the page can
// answer "is anything on fire?".

export const SES_REVIEW = { bounceRate: 0.05, complaintRate: 0.001 };

export type StreamTotals = { sent: number; delivered: number; bounced: number; complained: number };

export async function mailHealthSnapshot(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [alerts, account, network, domains, perStream, events, heartbeat, dmarc] =
    await Promise.all([
      db
        .select()
        .from(mailAlerts)
        .where(isNull(mailAlerts.resolvedAt))
        .orderBy(asc(mailAlerts.severity), asc(mailAlerts.firstSeenAt)),
      storedAccountStatus(db),
      networkBulkPause(db),
      db.select().from(mailDomains).orderBy(asc(mailDomains.name)),
      db
        .select({
          domainId: domainHealthDaily.domainId,
          stream: domainHealthDaily.stream,
          sent: sql<number>`sum(${domainHealthDaily.sent})::int`,
          delivered: sql<number>`sum(${domainHealthDaily.delivered})::int`,
          bounced: sql<number>`sum(${domainHealthDaily.bounced})::int`,
          complained: sql<number>`sum(${domainHealthDaily.complained})::int`,
        })
        .from(domainHealthDaily)
        .where(gte(domainHealthDaily.date, since))
        .groupBy(domainHealthDaily.domainId, domainHealthDaily.stream),
      db
        .select({
          status: mailEvents.status,
          n: sql<number>`count(*)::int`,
          oldest: sql<Date | null>`min(${mailEvents.createdAt})`,
        })
        .from(mailEvents)
        .where(sql`${mailEvents.status} in ('pending', 'failed')`)
        .groupBy(mailEvents.status),
      db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastBeatAt)).limit(1),
      dmarcSummary(db, now),
    ]);
  const account7d = perStream.reduce<StreamTotals>(
    (t, r) => ({
      sent: t.sent + r.sent,
      delivered: t.delivered + r.delivered,
      bounced: t.bounced + r.bounced,
      complained: t.complained + r.complained,
    }),
    { sent: 0, delivered: 0, bounced: 0, complained: 0 },
  );
  const streams = new Map<string, Partial<Record<string, StreamTotals>>>();
  for (const r of perStream) {
    const m = streams.get(r.domainId) ?? {};
    m[r.stream] = r;
    streams.set(r.domainId, m);
  }
  const pending = events.find((e) => e.status === 'pending');
  const failed = events.find((e) => e.status === 'failed');
  return {
    alerts,
    account,
    network,
    account7d,
    domains: domains.map((d) => ({ domain: d, streams: streams.get(d.id) ?? {} })),
    events: {
      pending: pending?.n ?? 0,
      failed: failed?.n ?? 0,
      oldestPending: pending?.oldest ? new Date(pending.oldest) : null,
    },
    lastHeartbeat: heartbeat[0]?.lastBeatAt ?? null,
    dmarc,
  };
}

export function rate(n: number, of: number): string {
  return of ? `${((n / of) * 100).toFixed(2)}%` : '–';
}
