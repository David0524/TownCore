import {
  and,
  attachments as attachmentsTable,
  contacts,
  desc,
  eq,
  gte,
  inArray,
  mailDomains,
  messages,
  ne,
  or,
  sql,
  threads,
  type Db,
} from '@towncore/db';
import { z } from 'zod';
import { routeRecipient } from '../routing';
import { storeDmarcAttachments } from '../ops/dmarc';
import { parseRawEmail, type ParsedMessage } from './parse';
import { normalizeSubject, referencedIds, THREAD_FALLBACK_DAYS } from './threading';

// Turns one SES "Received" notification into conversations (brief §4.1 step 5, Phase 2):
// fetch the raw message from S3, parse it once, then for each envelope recipient at a live
// domain store the message in the right team's thread. Safe to run again on the same event.

export const receivedNotificationSchema = z.object({
  notificationType: z.literal('Received'),
  mail: z.object({
    messageId: z.string().min(1),
    source: z.string(),
    timestamp: z.string().optional(),
  }),
  receipt: z.object({
    recipients: z.array(z.string()),
    spamVerdict: z.object({ status: z.string() }).optional(),
    virusVerdict: z.object({ status: z.string() }).optional(),
    spfVerdict: z.object({ status: z.string() }).optional(),
    dkimVerdict: z.object({ status: z.string() }).optional(),
    dmarcVerdict: z.object({ status: z.string() }).optional(),
    action: z.object({
      type: z.literal('S3'),
      bucketName: z.string(),
      objectKey: z.string(),
    }),
  }),
});
export type ReceivedNotification = z.infer<typeof receivedNotificationSchema>;

export interface MailObjectStore {
  getRaw(bucket: string, key: string): Promise<Buffer>;
  putAttachment(key: string, body: Buffer, contentType: string): Promise<void>;
}

export type ProcessResult = {
  outcome: 'stored' | 'dropped';
  stored: number;
  duplicates: number;
  dropped: { recipient: string; reason: string }[];
  /** DMARC aggregate reports stored from mail to the report address (Mail-6). */
  dmarcReports?: number;
};

export type ProcessDeps = {
  db: Db;
  objects: MailObjectStore;
  /** The bucket SES writes to (MAIL_S3_BUCKET); any other bucket in a notification is refused. */
  bucket: string;
  routing: { roles: ReadonlyMap<string, string>; catchAllTeamId: string };
  /** DMARC_REPORT_ADDRESS: its mail is parsed into dmarc_reports, not put in the inbox. */
  dmarcAddress?: string | null;
  now?: () => Date;
};

export async function processReceivedNotification(
  payload: unknown,
  deps: ProcessDeps,
): Promise<ProcessResult> {
  const notification = receivedNotificationSchema.parse(payload);
  const { action } = notification.receipt;
  if (action.bucketName !== deps.bucket)
    throw new Error(`notification names bucket ${action.bucketName}, expected ${deps.bucket}`);

  const live = await deps.db
    .select({ id: mailDomains.id, name: mailDomains.name })
    .from(mailDomains)
    .where(eq(mailDomains.inboundEnabled, true));
  const domainIds = new Map(live.map((d) => [d.name, d.id]));
  const result: ProcessResult = { outcome: 'dropped', stored: 0, duplicates: 0, dropped: [] };

  const dmarc = deps.dmarcAddress?.toLowerCase() ?? null;
  const recipients = new Set(notification.receipt.recipients.map((r) => r.toLowerCase()));
  if (dmarc && recipients.has(dmarc)) {
    recipients.delete(dmarc);
    const report = await parseRawEmail(
      await deps.objects.getRaw(action.bucketName, action.objectKey),
    );
    const stored = await storeDmarcAttachments(
      deps.db,
      report.attachments.map((a) => ({ filename: a.filename, content: a.content })),
      deps.now?.() ?? new Date(),
    );
    result.dmarcReports = stored.stored + stored.duplicates;
    if (result.dmarcReports) result.outcome = 'stored';
    else
      result.dropped.push({
        recipient: dmarc,
        reason: `no DMARC report found${stored.errors.length ? `: ${stored.errors.join('; ')}` : ''}`,
      });
  }

  const routes = [];
  for (const recipient of recipients) {
    const route = routeRecipient(recipient, {
      domains: new Set(domainIds.keys()),
      ...deps.routing,
    });
    if (route.kind === 'drop') result.dropped.push({ recipient, reason: route.reason });
    else routes.push({ ...route, recipient, domainId: domainIds.get(route.domain)! });
  }
  if (!routes.length) return result;

  const parsed = await parseRawEmail(
    await deps.objects.getRaw(action.bucketName, action.objectKey),
  );
  const verdicts = {
    spamVerdict: notification.receipt.spamVerdict?.status ?? null,
    virusVerdict: notification.receipt.virusVerdict?.status ?? null,
    spfVerdict: notification.receipt.spfVerdict?.status ?? null,
    dkimVerdict: notification.receipt.dkimVerdict?.status ?? null,
    dmarcVerdict: notification.receipt.dmarcVerdict?.status ?? null,
  };
  const quarantined = verdicts.virusVerdict === 'FAIL';
  const now = deps.now?.() ?? new Date();
  const sentAt = parsed.date && parsed.date <= now ? parsed.date : now;
  const fromAddress = parsed.from?.address ?? notification.mail.source.toLowerCase();
  const contactId = await upsertContact(deps.db, fromAddress, parsed.from?.name ?? null);

  for (const route of routes) {
    const messageId = await deps.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.sesMessageId, notification.mail.messageId),
            eq(messages.envelopeRecipient, route.recipient),
          ),
        );
      if (existing) return { id: existing.id, duplicate: true };

      const threadId =
        (await findThread(
          tx as unknown as Db,
          parsed,
          route.domainId,
          contactId,
          route.townAddress,
          now,
        )) ??
        (await createThread(tx as unknown as Db, {
          domainId: route.domainId,
          teamId: route.teamId,
          contactId,
          townAddress: route.townAddress,
          subject: parsed.subject,
          spam: verdicts.spamVerdict === 'FAIL',
          at: sentAt,
        }));
      const [row] = await tx
        .insert(messages)
        .values({
          threadId,
          direction: 'inbound',
          rfcMessageId: parsed.rfcMessageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          fromAddress,
          fromName: parsed.from?.name ?? null,
          toAddresses: parsed.to,
          ccAddresses: parsed.cc,
          envelopeRecipient: route.recipient,
          subject: parsed.subject,
          textBody: parsed.text,
          htmlBodySanitized: parsed.htmlSanitized,
          rawS3Key: action.objectKey,
          sesMessageId: notification.mail.messageId,
          ...verdicts,
          isAutomated: parsed.isAutomated,
          quarantined,
          sentAt,
        })
        .returning({ id: messages.id });
      // A reply brings a closed conversation back; spam stays spam until a person says otherwise.
      await tx
        .update(threads)
        .set({
          lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${sentAt.toISOString()}::timestamptz)`,
          status: sql`case when ${threads.status} = 'closed' then 'open'::thread_status else ${threads.status} end`,
        })
        .where(eq(threads.id, threadId));
      return { id: row!.id, duplicate: false };
    });
    if (messageId.duplicate) result.duplicates++;
    else result.stored++;
    // Outside the transaction so a crash mid-upload is finished by the retry.
    await storeAttachments(deps, messageId.id, parsed, quarantined);
  }
  result.outcome = 'stored';
  return result;
}

async function upsertContact(db: Db, email: string, name: string | null): Promise<string> {
  const [row] = await db
    .insert(contacts)
    .values({ email, name })
    .onConflictDoUpdate({
      target: contacts.email,
      set: { name: sql`coalesce(${contacts.name}, excluded.name)` },
    })
    .returning({ id: contacts.id });
  return row!.id;
}

async function findThread(
  db: Db,
  parsed: ParsedMessage,
  domainId: string,
  contactId: string,
  townAddress: string,
  now: Date,
): Promise<string | null> {
  const ids = referencedIds(parsed);
  if (ids.length) {
    // Our sent mail is known by the SES Message-ID and by the one we set (alt_message_ids).
    const matches = await db
      .select({
        threadId: messages.threadId,
        rfc: messages.rfcMessageId,
        alt: messages.altMessageIds,
      })
      .from(messages)
      .innerJoin(threads, eq(messages.threadId, threads.id))
      .where(
        and(
          or(
            inArray(messages.rfcMessageId, ids),
            sql`${messages.altMessageIds} && ${sql`array[${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )}]::text[]`}`,
          ),
          eq(threads.domainId, domainId),
        ),
      );
    // The most direct reference wins (In-Reply-To first, then the newest References entry).
    for (const id of ids) {
      const hit = matches.find((m) => m.rfc === id || m.alt.includes(id));
      if (hit) return hit.threadId;
    }
  }
  const normalized = normalizeSubject(parsed.subject);
  if (!normalized) return null;
  const since = new Date(now.getTime() - THREAD_FALLBACK_DAYS * 86_400_000);
  const [fallback] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.contactId, contactId),
        eq(threads.townAddress, townAddress),
        eq(threads.normalizedSubject, normalized),
        ne(threads.status, 'spam'),
        gte(threads.lastMessageAt, since),
      ),
    )
    .orderBy(desc(threads.lastMessageAt))
    .limit(1);
  return fallback?.id ?? null;
}

async function createThread(
  db: Db,
  t: {
    domainId: string;
    teamId: string;
    contactId: string;
    townAddress: string;
    subject: string;
    spam: boolean;
    at: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(threads)
    .values({
      domainId: t.domainId,
      teamId: t.teamId,
      contactId: t.contactId,
      townAddress: t.townAddress,
      subject: t.subject || '(no subject)',
      normalizedSubject: normalizeSubject(t.subject),
      status: t.spam ? 'spam' : 'open',
      lastMessageAt: t.at,
    })
    .returning({ id: threads.id });
  return row!.id;
}

/** Safe for S3 keys and download names: letters, digits, dot, dash, underscore. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._]+/, '')
    .slice(-120);
  return cleaned || 'attachment';
}

async function storeAttachments(
  deps: ProcessDeps,
  messageId: string,
  parsed: ParsedMessage,
  quarantined: boolean,
) {
  if (!parsed.attachments.length) return;
  const have = new Set(
    (
      await deps.db
        .select({ position: attachmentsTable.position })
        .from(attachmentsTable)
        .where(eq(attachmentsTable.messageId, messageId))
    ).map((a) => a.position),
  );
  for (const a of parsed.attachments) {
    if (have.has(a.position)) continue;
    // Quarantined (virus FAIL): record what was there, never extract the bytes.
    const s3Key = quarantined
      ? null
      : `attachments/${messageId}/${a.position}-${safeFilename(a.filename)}`;
    if (s3Key) await deps.objects.putAttachment(s3Key, a.content, a.contentType);
    await deps.db
      .insert(attachmentsTable)
      .values({
        messageId,
        position: a.position,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        s3Key,
        contentId: a.contentId,
        inline: a.inline,
      })
      .onConflictDoNothing();
  }
}
