import { and, emailEvents, eq, messages, sql, type Db } from '@towncore/db';
import { z } from 'zod';
import { suppress } from './suppression';

// SES sending events (brief Phase 4, §7.2): delivery status on our outbound messages, one
// email_events row per recipient, and suppressions for hard bounces and complaints.

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
  for (const recipient of list) {
    await db
      .insert(emailEvents)
      .values({
        mailEventId,
        type,
        subType,
        sesMessageId: e.mail.messageId,
        recipient,
        configurationSet: e.mail.tags?.['ses:configuration-set']?.[0] ?? null,
        occurredAt,
      })
      .onConflictDoNothing();
  }

  let suppressed = 0;
  const permanent = type === 'Bounce' && e.bounce?.bounceType === 'Permanent';
  const complaint = type === 'Complaint' && e.complaint?.complaintFeedbackType !== 'not-spam';
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
  return { recipients: list.length, suppressed };
}
