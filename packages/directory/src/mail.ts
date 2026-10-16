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
  },
): Promise<MailOutcome> {
  const to = parseAddress(message.to)?.address;
  if (!to) return 'invalid';
  const blocked = await suppressedAddresses(deps.db, [to], {
    domainId: mail.domainId,
    stream: 'conversational',
  });
  if (blocked.length) return 'suppressed';
  const from = `${LISTINGS_LOCAL_PART}@${mail.domain}`;
  const text = `${message.lines.join('\n\n')}\n\n${message.link.label}: ${message.link.href}\n\n— ${mail.siteName}\n`;
  const html =
    message.lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    `<p><a href="${esc(message.link.href)}" style="font-weight:bold">${esc(message.link.label)}</a></p>` +
    `<p>— ${esc(mail.siteName)}</p>`;
  const raw = await buildMime({
    from: `"${mail.siteName.replace(/"/g, '')}" <${from}>`,
    to: [to],
    cc: [],
    subject: message.subject,
    text,
    html,
    messageId: newMessageId(mail.domain),
    replyTo: `${LISTINGS_REPLY_TO}@${mail.domain}`,
    autoSubmitted: true,
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
