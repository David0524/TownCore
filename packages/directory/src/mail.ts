import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, mailDomains, towns, type Db } from '@towncore/db';
import {
  buildMime,
  newMessageId,
  parseAddress,
  suppressedAddresses,
  type MailTransport,
} from '@towncore/mail';

// Account mail for the directory (M6 PR C): claim verification, owner sign-in links and the
// claim decision. Every message goes only to an address a person typed into our form or one
// staff approved (D-M6-4, D-M6-11): the standing Rule 10 exception, like double opt-in. It is
// sent from the town's own domain on the conversational stream, never to a suppressed address.

export type DirectoryMailDeps = {
  db: Db;
  transport: MailTransport;
  /** The conversational configuration set (SES_CONFIG_SET_CONVERSATIONAL). */
  configurationSet: string;
  /** Origin for links on a town site; https://<domain> unless overridden (dev, tests). */
  siteOrigin?: (domain: string) => string;
  now?: () => Date;
  /** MAIL_TOKEN_SECRET, for unsubscribe links in reports and follow-ups (none: not sent). */
  tokenSecret?: string;
  /** MAIL_POSTAL_ADDRESS, the footer of reports and follow-ups. */
  postalAddress?: string | null;
};

export const LISTINGS_LOCAL_PART = 'listings';
/** Replies go to the shared inbox's sales team (Mail-0 role address). */
export const LISTINGS_REPLY_TO = 'sales';

export type TownMail = { domain: string; domainId: string; siteName: string };

/** The live mail domain a town sends from, or null while it has none. */
export async function townMailDomain(db: Db, townId: string): Promise<TownMail | null> {
  const [row] = await db
    .select({ domain: mailDomains.name, domainId: mailDomains.id, siteName: towns.siteName })
    .from(mailDomains)
    .innerJoin(towns, eq(towns.id, mailDomains.townId))
    .where(and(eq(mailDomains.townId, townId), eq(mailDomains.status, 'live')))
    .limit(1);
  return row ?? null;
}

export const siteOrigin = (deps: Pick<DirectoryMailDeps, 'siteOrigin'>, domain: string) =>
  deps.siteOrigin?.(domain) ?? `https://${domain}`;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type MailOutcome = 'sent' | 'suppressed' | 'invalid';

/** A short plain message with one link. Returns without sending to suppressed addresses. */
export async function sendDirectoryMail(
  deps: DirectoryMailDeps,
  mail: TownMail,
  message: {
    to: string;
    subject: string;
    lines: string[];
    link: { href: string; label: string };
    kind: string;
    /** Where replies go (a quote request: the reader who asked). Default: the town's sales@. */
    replyTo?: string;
    /**
     * Mail the owner didn't ask for this time (reports, follow-ups): one-click List-Unsubscribe
     * (RFC 8058) and a footer link, and unsubscribes are honored like bulk mail.
     */
    unsubscribe?: { page: string; oneClick: string };
    /** The physical address footer (MAIL_POSTAL_ADDRESS), with `unsubscribe`. */
    postalAddress?: string | null;
  },
): Promise<MailOutcome> {
  const to = parseAddress(message.to)?.address;
  if (!to) return 'invalid';
  const blocked = await suppressedAddresses(deps.db, [to], {
    domainId: mail.domainId,
    stream: message.unsubscribe ? 'bulk' : 'conversational',
  });
  if (blocked.length) return 'suppressed';
  const from = `${LISTINGS_LOCAL_PART}@${mail.domain}`;
  const foot = message.unsubscribe
    ? [
        `Don’t want these emails? Unsubscribe: ${message.unsubscribe.page}`,
        ...(message.postalAddress ? [`${mail.siteName} · ${message.postalAddress}`] : []),
      ]
    : [];
  const text = `${message.lines.join('\n\n')}\n\n${message.link.label}: ${message.link.href}\n\n— ${mail.siteName}\n${foot.map((f) => `\n${f}\n`).join('')}`;
  const html =
    message.lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    `<p><a href="${esc(message.link.href)}" style="font-weight:bold">${esc(message.link.label)}</a></p>` +
    `<p>— ${esc(mail.siteName)}</p>` +
    (message.unsubscribe
      ? `<p style="font-size:12px;color:#5B6475">Don’t want these emails? <a href="${esc(message.unsubscribe.page)}">Unsubscribe</a>.${message.postalAddress ? `<br>${esc(mail.siteName)} · ${esc(message.postalAddress)}` : ''}</p>`
      : '');
  const raw = await buildMime({
    from: `"${mail.siteName.replace(/"/g, '')}" <${from}>`,
    to: [to],
    cc: [],
    subject: message.subject,
    text,
    html,
    messageId: newMessageId(mail.domain),
    replyTo: message.replyTo ?? `${LISTINGS_REPLY_TO}@${mail.domain}`,
    autoSubmitted: true,
    ...(message.unsubscribe
      ? {
          headers: {
            'List-Unsubscribe': `<${message.unsubscribe.oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
  });
  await deps.transport.send({
    raw,
    from,
    to: [to],
    cc: [],
    configurationSet: deps.configurationSet,
    tags: {
      domain: mail.domain,
      domain_id: mail.domainId,
      stream: 'conversational',
      kind: message.kind,
    },
  });
  return 'sent';
}

// Owner mail opt-out links: an HMAC over the business id with MAIL_TOKEN_SECRET (a purpose of its
// own, so a newsletter token can't stand in for it), joined with '~' like subscriber tokens.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ownerMac = (secret: string, businessId: string) =>
  createHmac('sha256', secret).update(`owner-mail\n${businessId}`).digest('base64url');

export function ownerMailToken(secret: string, businessId: string): string {
  return `${businessId}~${ownerMac(secret, businessId)}`;
}

/** The business id, or null if the token isn't ours. */
export function verifyOwnerMailToken(secret: string, token: string): string | null {
  const [id, sig, ...rest] = token.split('~');
  if (!id || !sig || rest.length || !UUID.test(id)) return null;
  const want = Buffer.from(ownerMac(secret, id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** The unsubscribe links for an owner's reports and follow-ups on a town site. */
export function ownerUnsubscribe(origin: string, token: string) {
  const t = encodeURIComponent(token);
  return { page: `${origin}/owner/stop/${t}`, oneClick: `${origin}/api/owner/unsubscribe/${t}` };
}
