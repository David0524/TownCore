import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

// MIME for outbound mail (brief Phase 4): From, To, Cc, Subject, threading headers, text and
// HTML parts, attachments. SES replaces our Message-ID with its own (checked in the SES docs,
// "Amazon SES header fields"); we still set one and keep it as an alternate id.

export type OutboundAttachment = { filename: string; contentType: string; content: Buffer };

export type MimeInput = {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: OutboundAttachment[];
  replyTo?: string;
  /** Automatic account mail (sign-in links, verifications): marked so auto-responders stay quiet. */
  autoSubmitted?: boolean;
};

export function newMessageId(domain: string): string {
  return `${randomUUID()}@${domain}`;
}

const angle = (id: string) => `<${id}>`;

export async function buildMime(input: MimeInput): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.from,
    to: input.to,
    cc: input.cc.length ? input.cc : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: angle(input.messageId),
    inReplyTo: input.inReplyTo ? angle(input.inReplyTo) : undefined,
    references: input.references?.length ? input.references.map(angle).join(' ') : undefined,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
    replyTo: input.replyTo,
    headers: input.autoSubmitted
      ? { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }
      : { 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
  });
  return new Promise((resolve, reject) =>
    composer.compile().build((error, message) => (error ? reject(error) : resolve(message))),
  );
}

/** The Message-IDs recipients may see once SES has rewritten ours (both known formats). */
export function sesMessageIdCandidates(sesMessageId: string, region: string): string[] {
  return [`${sesMessageId}@email.amazonses.com`, `${sesMessageId}@${region}.amazonses.com`];
}
