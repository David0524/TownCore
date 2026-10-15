import { simpleParser, type AddressObject, type HeaderValue } from 'mailparser';
import { sanitizeEmailHtml } from './sanitize';

// Parses a raw inbound message (brief Phase 2). The raw copy stays in S3; what we store is
// the parsed headers, the text body, HTML sanitized at ingest, and the attachments.

export type ParsedAttachment = {
  position: number;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
  content: Buffer;
};

export type ParsedMessage = {
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name: string | null } | null;
  to: string[];
  cc: string[];
  subject: string;
  date: Date | null;
  text: string | null;
  htmlSanitized: string | null;
  isAutomated: boolean;
  attachments: ParsedAttachment[];
};

/** `<abc@host>` → `abc@host`. Message-IDs keep their case: the spec makes them case-sensitive. */
export function cleanMessageId(value: string | undefined | null): string | null {
  const id = value?.trim().replace(/^<|>$/g, '').trim();
  return id ? id : null;
}

function idList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(' ') : (value ?? '');
  return [...new Set((raw.match(/<[^<>\s]+>/g) ?? []).map((v) => cleanMessageId(v)!))];
}

function addresses(field: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  return list
    .flatMap((group) => group.value)
    .flatMap((a) => (a.group ? a.group : [a]))
    .map((a) => a.address?.trim().toLowerCase())
    .filter((a): a is string => Boolean(a));
}

const headerText = (value: HeaderValue | undefined): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

/**
 * Loop protection (brief §7.5): mail that announces itself as automatic. We never auto-reply
 * to anything; this flag keeps such mail out of notifications and metrics.
 */
export function isAutomatedMail(headers: Map<string, HeaderValue>): boolean {
  const autoSubmitted = headerText(headers.get('auto-submitted')).trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  const precedence = headerText(headers.get('precedence')).trim().toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return true;
  return headers.has('x-autoreply') || headers.has('x-autorespond');
}

export async function parseRawEmail(raw: Buffer | string): Promise<ParsedMessage> {
  const mail = await simpleParser(raw, { skipTextToHtml: true, skipImageLinks: true });
  const fromValue = mail.from?.value[0];
  return {
    rfcMessageId: cleanMessageId(mail.messageId),
    inReplyTo: idList(mail.inReplyTo)[0] ?? null,
    references: idList(mail.references),
    from: fromValue?.address
      ? { address: fromValue.address.trim().toLowerCase(), name: fromValue.name?.trim() || null }
      : null,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject?.trim() ?? '',
    date: mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : null,
    text: mail.text?.trim() ? mail.text : null,
    htmlSanitized: typeof mail.html === 'string' ? sanitizeEmailHtml(mail.html) : null,
    isAutomated: isAutomatedMail(mail.headers),
    attachments: mail.attachments.map((a, position) => ({
      position,
      filename: a.filename?.trim() || `attachment-${position + 1}`,
      contentType: a.contentType || 'application/octet-stream',
      size: a.size ?? a.content.length,
      contentId: cleanMessageId(a.contentId),
      inline: a.contentDisposition === 'inline' || Boolean(a.related),
      content: a.content,
    })),
  };
}
