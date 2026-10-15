import {
  attachments as attachmentsTable,
  contacts,
  desc,
  eq,
  logAdminAction,
  mailDomains,
  messages,
  roleAddresses,
  signatures,
  sql,
  threads,
  type Db,
} from '@towncore/db';
import { parseAddress } from '../address';
import { markRead } from '../inbox/queries';
import { routeRecipient } from '../routing';
import { sanitizeEmailHtml } from '../inbound/sanitize';
import { normalizeSubject } from '../inbound/threading';
import { safeFilename } from '../inbound/process';
import {
  bodyParts,
  fromDisplayName,
  mailbox,
  pickSignature,
  renderSignature,
  replySubject,
} from './compose';
import { buildMime, newMessageId, sesMessageIdCandidates, type OutboundAttachment } from './mime';
import { suppressedAddresses, type SuppressedAddress } from './suppression';
import type { MailTransport } from './transport';

// Sending a reply or a new message (brief Phase 4). A person pressing Send is the approval
// Rule 10 asks for (D-MAIL-11). The message is stored first, then sent through the
// conversational configuration set with domain and stream tags; a failure is kept on the
// message so nobody wonders whether it went.

export const MAX_RECIPIENTS = 50;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class SendError extends Error {}
export class SuppressedRecipientsError extends SendError {
  constructor(readonly addresses: SuppressedAddress[]) {
    super(
      `Suppressed: ${addresses.map((a) => `${a.email} (${a.reason.replace('_', ' ')})`).join(', ')}. Confirm to send anyway.`,
    );
  }
}

export type SendDeps = {
  db: Db;
  transport: MailTransport;
  /** Where outbound attachments are stored (S3 in production). Required only with attachments. */
  files?: { put(key: string, body: Buffer, contentType: string): Promise<void> } | null;
  region: string;
  configurationSet: string;
  now?: () => Date;
};

export type Actor = { id: string; name: string };

export type Draft = {
  to: string[];
  cc: string[];
  subject?: string;
  body: string;
  attachments: OutboundAttachment[];
  /** The person saw the suppression warning and chose to send anyway. */
  confirmSuppressed: boolean;
};

export type SendResult = {
  threadId: string;
  messageId: string;
  status: 'sent' | 'failed';
  error: string | null;
};

export async function sendReply(
  deps: SendDeps,
  actor: Actor,
  threadId: string,
  draft: Draft,
): Promise<SendResult> {
  const [thread] = await deps.db.select().from(threads).where(eq(threads.id, threadId));
  if (!thread) throw new SendError('No such conversation.');
  const [last] = await deps.db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const references = last
    ? [...last.references, ...(last.rfcMessageId ? [last.rfcMessageId] : [])].slice(-20)
    : [];
  return deliver(deps, actor, {
    thread,
    fromAddress: thread.townAddress,
    subject: draft.subject?.trim() || replySubject(thread.subject),
    inReplyTo: last?.rfcMessageId ?? null,
    references,
    draft,
  });
}

export async function sendNew(
  deps: SendDeps,
  actor: Actor,
  input: { domainId: string; localPart: string } & Draft & { subject: string },
): Promise<SendResult> {
  const [domain] = await deps.db
    .select()
    .from(mailDomains)
    .where(eq(mailDomains.id, input.domainId));
  if (!domain) throw new SendError('No such town domain.');
  const from = parseAddress(`${input.localPart}@${domain.name}`);
  if (!from || from.address.includes('+')) throw new SendError('That isn’t a valid from address.');
  const to = input.to[0];
  if (!to) throw new SendError('Add at least one recipient.');
  const roles = await deps.db.select().from(roleAddresses);
  const route = routeRecipient(from.address, {
    domains: new Set([domain.name]),
    roles: new Map(roles.filter((r) => r.localPart).map((r) => [r.localPart!, r.teamId])),
    catchAllTeamId: roles.find((r) => r.isCatchAll)!.teamId,
  });
  if (route.kind !== 'team') throw new SendError('That isn’t a valid from address.');
  const contactId = await upsertContact(deps.db, to);
  const subject = input.subject.trim();
  if (!subject) throw new SendError('Add a subject.');
  const [thread] = await deps.db
    .insert(threads)
    .values({
      domainId: domain.id,
      teamId: route.teamId,
      assigneeId: actor.id,
      contactId,
      townAddress: from.address,
      subject,
      normalizedSubject: normalizeSubject(subject),
      status: 'open',
      lastMessageAt: deps.now?.() ?? new Date(),
    })
    .returning();
  return deliver(deps, actor, {
    thread: thread!,
    fromAddress: from.address,
    subject,
    inReplyTo: null,
    references: [],
    draft: input,
  });
}

async function upsertContact(db: Db, email: string): Promise<string> {
  const [row] = await db
    .insert(contacts)
    .values({ email: email.toLowerCase() })
    .onConflictDoUpdate({ target: contacts.email, set: { email: sql`excluded.email` } })
    .returning({ id: contacts.id });
  return row!.id;
}

async function deliver(
  deps: SendDeps,
  actor: Actor,
  m: {
    thread: typeof threads.$inferSelect;
    fromAddress: string;
    subject: string;
    inReplyTo: string | null;
    references: string[];
    draft: Draft;
  },
): Promise<SendResult> {
  const { db } = deps;
  const { draft } = m;
  const now = deps.now?.() ?? new Date();
  if (!draft.to.length) throw new SendError('Add at least one recipient.');
  if (draft.to.length + draft.cc.length > MAX_RECIPIENTS)
    throw new SendError(`At most ${MAX_RECIPIENTS} recipients.`);
  if (!draft.body.trim()) throw new SendError('Write a message first.');
  const bytes = draft.attachments.reduce((n, a) => n + a.content.length, 0);
  if (bytes > MAX_ATTACHMENT_BYTES)
    throw new SendError('Attachments are limited to 10 MB in total.');
  if (draft.attachments.length && !deps.files)
    throw new SendError('Attachments need the mail bucket (not configured).');

  const [domain] = await db.select().from(mailDomains).where(eq(mailDomains.id, m.thread.domainId));
  if (!domain || (domain.status !== 'live' && domain.status !== 'paused'))
    throw new SendError(`${domain?.name ?? 'This domain'} isn’t live for mail yet.`);

  const suppressed = await suppressedAddresses(db, [...draft.to, ...draft.cc], {
    domainId: domain.id,
    stream: 'conversational',
  });
  if (suppressed.length && !draft.confirmSuppressed)
    throw new SuppressedRecipientsError(suppressed);

  const from = parseAddress(m.fromAddress)!;
  const roles = await db.select({ localPart: roleAddresses.localPart }).from(roleAddresses);
  const role = roles.some((r) => r.localPart === from.role) ? from.role : null;
  const sigRows = await db.select().from(signatures);
  const signature = renderSignature(pickSignature(sigRows, actor.id, from.role), {
    town_name: domain.displayName,
    user_name: actor.name,
    role: from.role,
    domain: domain.name,
  });
  const { text, html } = bodyParts(draft.body, signature);
  const fromHeader = mailbox(fromDisplayName(domain.displayName, role), from.address);
  const ourId = newMessageId(domain.name);

  const [row] = await db
    .insert(messages)
    .values({
      threadId: m.thread.id,
      direction: 'outbound',
      rfcMessageId: ourId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      fromAddress: from.address,
      fromName: fromDisplayName(domain.displayName, role),
      toAddresses: draft.to,
      ccAddresses: draft.cc,
      subject: m.subject,
      textBody: text,
      htmlBodySanitized: sanitizeEmailHtml(html),
      sentByStaffId: actor.id,
      deliveryStatus: 'sending',
      sentAt: now,
    })
    .returning();
  const messageId = row!.id;
  await db
    .update(threads)
    .set({
      lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(threads.id, m.thread.id));
  await markRead(db, m.thread.id, actor.id, now);

  let status: SendResult['status'] = 'sent';
  let error: string | null = null;
  try {
    for (const [position, a] of draft.attachments.entries()) {
      const key = `attachments/${messageId}/${position}-${safeFilename(a.filename)}`;
      await deps.files!.put(key, a.content, a.contentType);
      await db.insert(attachmentsTable).values({
        messageId,
        position,
        filename: a.filename,
        contentType: a.contentType,
        size: a.content.length,
        s3Key: key,
      });
    }
    const raw = await buildMime({
      from: fromHeader,
      to: draft.to,
      cc: draft.cc,
      subject: m.subject,
      text,
      html,
      messageId: ourId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      attachments: draft.attachments,
    });
    const { sesMessageId } = await deps.transport.send({
      raw,
      from: from.address,
      to: draft.to,
      cc: draft.cc,
      configurationSet: deps.configurationSet,
      tags: { domain: domain.name, stream: 'conversational' },
    });
    // Recipients see the SES Message-ID; keep ours too so a reply to either threads back.
    const [seen, ...alternates] =
      deps.transport.name === 'ses' ? sesMessageIdCandidates(sesMessageId, deps.region) : [ourId];
    await db
      .update(messages)
      .set({
        sesMessageId,
        rfcMessageId: seen,
        altMessageIds: [...new Set([...alternates, ourId].filter((id) => id !== seen))],
        deliveryStatus: 'sent',
      })
      .where(eq(messages.id, messageId));
  } catch (e) {
    status = 'failed';
    error = e instanceof Error ? e.message : String(e);
    await db
      .update(messages)
      .set({ deliveryStatus: 'failed', deliveryError: error.slice(0, 1000) })
      .where(eq(messages.id, messageId));
  }
  await logAdminAction(db, {
    staffId: actor.id,
    action: status === 'sent' ? 'mail_send' : 'mail_send_failed',
    target: { type: 'thread', id: m.thread.id },
    detail: {
      messageId,
      to: draft.to,
      cc: draft.cc,
      transport: deps.transport.name,
      suppressedConfirmed: suppressed.map((s) => s.email),
      error,
    },
  });
  return { threadId: m.thread.id, messageId, status, error };
}
