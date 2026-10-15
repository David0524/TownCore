import {
  and,
  emailCampaignSends,
  emailEvents,
  eq,
  inArray,
  messages,
  sql,
  subscribers,
  type Db,
} from '@towncore/db';
import { bumpHealth, type HealthField } from '../bulk/health';
import { z } from 'zod';
import { suppress } from './suppression';

// SES sending events (brief Phase 4, §7.2): delivery status on our outbound messages and bulk
// sends, one email_events row per recipient, domain health counts (Mail-5), and suppressions
// for hard bounces and complaints.

const recipients = z.array(z.object({ emailAddress: z.string() })).optional();
export const sendingEventSchema = z.object({
  eventType: z.string(),
  mail: z.object({
    messageId: z.string(),
    timestamp: z.string().optional(),
    destination: z.array(z.string()).default([]),
    tags: z.record(z.string(), z.array(z.string())).optional(),
  }),
  bounce: z
    .object({
      bounceType: z.string(),
      bounceSubType: z.string().optional(),
      bouncedRecipients: recipients,
      timestamp: z.string().optional(),
    })
    .optional(),
  complaint: z
    .object({
      complainedRecipients: recipients,
      complaintFeedbackType: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
  delivery: z
    .object({ recipients: z.array(z.string()).optional(), timestamp: z.string().optional() })
    .optional(),
  deliveryDelay: z
    .object({
      delayedRecipients: recipients,
      delayType: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
  reject: z.object({ reason: z.string().optional() }).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Later outcomes win: a delivered message that then draws a complaint shows "complained". */
const RANK: Record<string, number> = {
  sending: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  rejected: 4,
  bounced: 5,
  complained: 6,
};

const STATUS: Record<string, string> = {
  Send: 'sent',
  Delivery: 'delivered',
  DeliveryDelay: 'delayed',
  Bounce: 'bounced',
  Complaint: 'complained',
  Reject: 'rejected',
};

const SEND_STATUS: Record<string, 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed'> = {
  sent: 'sent',
  delivered: 'delivered',
  bounced: 'bounced',
  complained: 'complained',
  rejected: 'failed',
};

export const SENDING_EVENT_TYPES = new Set([...Object.keys(STATUS), 'Rendering Failure']);

export async function handleSendingEvent(
  db: Db,
  mailEventId: string,
  payload: unknown,
): Promise<{ recipients: number; suppressed: number }> {
  const e = sendingEventSchema.parse(payload);
  const type = e.eventType;
  const occurredAt = new Date(
    e.bounce?.timestamp ??
      e.complaint?.timestamp ??
      e.delivery?.timestamp ??
      e.deliveryDelay?.timestamp ??
      e.mail.timestamp ??
      Date.now(),
  );
  const who =
    type === 'Bounce'
      ? (e.bounce?.bouncedRecipients ?? []).map((r) => r.emailAddress)
      : type === 'Complaint'
        ? (e.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress)
        : type === 'Delivery'
          ? (e.delivery?.recipients ?? [])
          : type === 'DeliveryDelay'
            ? (e.deliveryDelay?.delayedRecipients ?? []).map((r) => r.emailAddress)
            : e.mail.destination;
  const list = [...new Set(who.map((w) => w.toLowerCase()))];
  const subType = e.bounce
    ? `${e.bounce.bounceType}/${e.bounce.bounceSubType ?? ''}`
    : (e.complaint?.complaintFeedbackType ?? e.deliveryDelay?.delayType ?? null);
  const tag = (name: string) => e.mail.tags?.[name]?.[0] ?? null;
  const domainId = tag('domain_id');
  const stream = tag('stream');
  const permanent = type === 'Bounce' && e.bounce?.bounceType === 'Permanent';
  const complaint = type === 'Complaint' && e.complaint?.complaintFeedbackType !== 'not-spam';
  const field: HealthField | null =
    type === 'Send'
      ? 'sent'
      : type === 'Delivery'
        ? 'delivered'
        : permanent
          ? 'bounced'
          : complaint
            ? 'complained'
            : null;
  for (const recipient of list) {
    const inserted = await db
      .insert(emailEvents)
      .values({
        mailEventId,
        type,
        subType,
        sesMessageId: e.mail.messageId,
        recipient,
        configurationSet: e.mail.tags?.['ses:configuration-set']?.[0] ?? null,
        domainId: domainId && UUID.test(domainId) ? domainId : null,
        stream,
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: emailEvents.id });
    // Counted once per recipient, even when SNS delivers the event again.
    if (inserted.length && field && domainId && UUID.test(domainId) && stream)
      await bumpHealth(db, { domainId, stream, at: occurredAt, field });
  }

  let suppressed = 0;
  if (permanent || complaint) {
    for (const email of list) {
      await suppress(db, {
        email,
        reason: permanent ? 'hard_bounce' : 'complaint',
        sourceEventId: mailEventId,
      });
      suppressed++;
    }
  }

  const status = STATUS[type];
  if (status) {
    const error =
      type === 'Bounce'
        ? `${e.bounce?.bounceType} bounce (${e.bounce?.bounceSubType ?? 'unknown'})`
        : type === 'Reject'
          ? `Rejected by SES: ${e.reject?.reason ?? 'unknown'}`
          : null;
    const rank = RANK[status]!;
    await db
      .update(messages)
      .set({ deliveryStatus: status, ...(error ? { deliveryError: error } : {}) })
      .where(
        and(
          eq(messages.sesMessageId, e.mail.messageId),
          eq(messages.direction, 'outbound'),
          sql`(case ${messages.deliveryStatus} ${sql.join(
            Object.entries(RANK).map(([name, n]) => sql`when ${name} then ${n}`),
            sql` `,
          )} else -1 end) <= ${rank}`,
        ),
      );
  }
  const sendStatus = status ? SEND_STATUS[status] : undefined;
  if (status && sendStatus && stream === 'bulk') {
    const rank = RANK[status]!;
    const updated = await db
      .update(emailCampaignSends)
      .set({
        status: sendStatus,
        ...(type === 'Reject' ? { error: e.reject?.reason ?? 'rejected' } : {}),
      })
      .where(
        and(
          eq(emailCampaignSends.sesMessageId, e.mail.messageId),
          sql`(case ${emailCampaignSends.status}::text ${sql.join(
            Object.entries(RANK).map(([name, n]) => sql`when ${name} then ${n}`),
            sql` `,
          )} else -1 end) <= ${rank}`,
        ),
      )
      .returning({ subscriberId: emailCampaignSends.subscriberId });
    if ((permanent || complaint) && updated.length)
      await db
        .update(subscribers)
        .set({ status: permanent ? 'bounced' : 'complained' })
        .where(
          inArray(
            subscribers.id,
            updated.map((u) => u.subscriberId),
          ),
        );
  }
  return { recipients: list.length, suppressed };
}
