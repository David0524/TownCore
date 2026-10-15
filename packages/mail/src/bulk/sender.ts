import {
  and,
  emailCampaigns,
  emailCampaignSends,
  eq,
  gte,
  inArray,
  lt,
  mailDomains,
  sql,
  subscribers,
  type Db,
} from '@towncore/db';
import { suppressedAddresses } from '../outbound/suppression';
import { BULK_CONFIG } from './config';
import { domainBrand } from './campaigns';
import { networkBulkPause } from './health';
import { bulkFromAddress, buildBulkMime } from './message';
import type { BulkDeps } from './subscribers';
import { unsubscribeToken } from './tokens';
import { underCap } from './warmup';

// Campaign sending (brief §4.3, Phase 5). A due campaign is expanded into one send row per
// active subscriber; batches are claimed with SKIP LOCKED and marked 'sending' before SES is
// called, so a retried or concurrent job never sends a row twice. Warm-up caps defer the rest.

const startOfUtcDay = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);

/** Scheduled campaigns that are due become 'sending' with their recipient rows. */
export async function expandDueCampaigns(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .select({ c: emailCampaigns, townId: mailDomains.townId })
    .from(emailCampaigns)
    .innerJoin(mailDomains, eq(mailDomains.id, emailCampaigns.domainId))
    .where(
      and(
        eq(emailCampaigns.status, 'scheduled'),
        lt(emailCampaigns.scheduledAt, new Date(now.getTime() + 1)),
        inArray(mailDomains.bulkStatus, ['warming', 'active']),
        eq(mailDomains.status, 'live'),
      ),
    );
  for (const { c, townId } of due) {
    if (!townId) continue;
    await db.transaction(async (tx) => {
      // The unique (campaign, subscriber) key makes a second expansion add nothing.
      await tx.execute(sql`
        insert into email_campaign_sends (campaign_id, subscriber_id, email, priority)
        select ${c.id}, s.id, lower(s.email), coalesce(s.last_engaged_at, s.confirmed_at)
        from subscribers s
        where s.town_id = ${townId} and s.status = 'active'
        on conflict (campaign_id, subscriber_id) do nothing`);
      await tx
        .update(emailCampaigns)
        .set({ status: 'sending', expandedAt: now })
        .where(and(eq(emailCampaigns.id, c.id), eq(emailCampaigns.status, 'scheduled')));
    });
  }
  return due.length;
}

export type BatchResult = {
  sent: number;
  suppressed: number;
  failed: number;
  deferred: number;
  finished: number;
};

/**
 * One pass over the campaigns that are sending: give up on stale claims, respect each
 * domain's daily cap, send a batch, and finish campaigns with nothing left.
 */
export async function sendDueBatches(
  deps: BulkDeps & { sleep?: (ms: number) => Promise<void> },
): Promise<BatchResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const cfg = BULK_CONFIG.sending;
  const result: BatchResult = { sent: 0, suppressed: 0, failed: 0, deferred: 0, finished: 0 };
  if (await networkBulkPause(db)) return result;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gap = deps.transport.name === 'log' ? 0 : Math.ceil(1000 / cfg.messagesPerSecond);

  // A row claimed but never finished may already have gone out: never retry it.
  await db
    .update(emailCampaignSends)
    .set({ status: 'failed', error: 'outcome unknown (the send was interrupted); not retried' })
    .where(
      and(
        eq(emailCampaignSends.status, 'sending'),
        lt(emailCampaignSends.claimedAt, new Date(now.getTime() - cfg.staleSendingMs)),
      ),
    );

  const active = await db
    .select({ c: emailCampaigns, d: mailDomains })
    .from(emailCampaigns)
    .innerJoin(mailDomains, eq(mailDomains.id, emailCampaigns.domainId))
    .where(
      and(
        eq(emailCampaigns.status, 'sending'),
        inArray(mailDomains.bulkStatus, ['warming', 'active']),
      ),
    );

  for (const { c, d } of active) {
    const brand = await domainBrand(db, d.id, deps.postalAddress);
    if (!brand.postalAddress) {
      await db
        .update(emailCampaigns)
        .set({
          status: 'paused',
          pausedReason: 'No postal address for the footer (MAIL_POSTAL_ADDRESS).',
        })
        .where(eq(emailCampaigns.id, c.id));
      continue;
    }
    const cap =
      d.bulkStatus === 'active' ? Math.max(d.bulkDailyCap, d.bulkTargetCap) : d.bulkDailyCap;
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailCampaignSends)
      .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailCampaignSends.campaignId))
      .where(
        and(eq(emailCampaigns.domainId, d.id), gte(emailCampaignSends.sentAt, startOfUtcDay(now))),
      );
    const allowance = underCap(cap, today?.n ?? 0, cfg.batchSize);

    const claimed =
      allowance > 0
        ? await db
            .update(emailCampaignSends)
            .set({ status: 'sending', claimedAt: now })
            .where(
              inArray(
                emailCampaignSends.id,
                sql`(select id from email_campaign_sends
                     where campaign_id = ${c.id} and status in ('queued', 'deferred_cap')
                     order by (status = 'deferred_cap') desc, priority desc nulls last, created_at
                     limit ${allowance} for update skip locked)`,
              ),
            )
            .returning()
        : [];

    // UPDATE … RETURNING has no order: send the most recently confirmed first.
    claimed.sort(
      (a, b) =>
        Number(b.status === 'deferred_cap') - Number(a.status === 'deferred_cap') ||
        (b.priority?.getTime() ?? 0) - (a.priority?.getTime() ?? 0),
    );
    for (const send of claimed) {
      const [sub] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, send.subscriberId));
      const blocked = await suppressedAddresses(db, [send.email], {
        domainId: d.id,
        stream: 'bulk',
      });
      if (!sub || sub.status !== 'active' || blocked.length) {
        await db
          .update(emailCampaignSends)
          .set({ status: 'suppressed', error: blocked[0]?.reason ?? sub?.status ?? 'gone' })
          .where(eq(emailCampaignSends.id, send.id));
        result.suppressed++;
        continue;
      }
      try {
        const raw = await buildBulkMime({
          brand,
          to: send.email,
          subject: c.subject,
          html: c.html,
          text: c.text,
          unsubscribeToken: unsubscribeToken(deps.secret, sub.id),
          campaignId: c.id,
          kind: c.kind,
        });
        const { sesMessageId } = await deps.transport.send({
          raw,
          from: bulkFromAddress(brand.domain),
          to: [send.email],
          cc: [],
          configurationSet: deps.configurationSet,
          tags: {
            domain: brand.domain,
            domain_id: d.id,
            stream: 'bulk',
            campaign: c.id,
            kind: c.kind,
          },
        });
        await db
          .update(emailCampaignSends)
          .set({ status: 'sent', sesMessageId, sentAt: deps.now?.() ?? new Date() })
          .where(eq(emailCampaignSends.id, send.id));
        result.sent++;
      } catch (error) {
        await db
          .update(emailCampaignSends)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 500) : String(error),
          })
          .where(eq(emailCampaignSends.id, send.id));
        result.failed++;
      }
      if (gap) await sleep(gap);
    }

    // Over today's cap: what's left waits for tomorrow, first in line.
    if (allowance < cfg.batchSize) {
      const deferred = await db
        .update(emailCampaignSends)
        .set({ status: 'deferred_cap' })
        .where(
          and(eq(emailCampaignSends.campaignId, c.id), eq(emailCampaignSends.status, 'queued')),
        )
        .returning({ id: emailCampaignSends.id });
      result.deferred += deferred.length;
    }

    const [left] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailCampaignSends)
      .where(
        and(
          eq(emailCampaignSends.campaignId, c.id),
          inArray(emailCampaignSends.status, ['queued', 'deferred_cap', 'sending']),
        ),
      );
    if (!left?.n) {
      await db
        .update(emailCampaigns)
        .set({ status: 'sent', finishedAt: now })
        .where(and(eq(emailCampaigns.id, c.id), eq(emailCampaigns.status, 'sending')));
      result.finished++;
    }
  }
  return result;
}
