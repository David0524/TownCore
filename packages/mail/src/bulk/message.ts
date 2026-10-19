import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { micromark } from 'micromark';
import { mailbox } from '../outbound/compose';
import { newMessageId } from '../outbound/mime';

// Bulk messages (brief §7.3): From news.<domain>, Reply-To on the root domain, RFC 8058
// one-click unsubscribe headers, a visible unsubscribe link, the postal address and a plain-text
// part. Confirmation emails share the From, footer and address but carry no list headers.

export const NEWSLETTER_LOCAL_PART = 'newsletter';
export const NEWSLETTER_REPLY_TO = 'news';

export type BulkBrand = { siteName: string; domain: string; postalAddress: string };

export function bulkFromAddress(domain: string): string {
  return `${NEWSLETTER_LOCAL_PART}@news.${domain}`;
}

export function unsubscribeUrls(domain: string, token: string) {
  return {
    /** RFC 8058 target: POST only, no login. */
    oneClick: `https://${domain}/api/newsletter/unsubscribe/${encodeURIComponent(token)}`,
    /** The footer link: a page on the town site with the same button and a preference. */
    page: `https://${domain}/u/${encodeURIComponent(token)}`,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown from staff → HTML (raw HTML in the source is escaped, not passed through). */
export function markdownToHtml(markdown: string): string {
  return micromark(markdown);
}

export function renderVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => vars[key] ?? all);
}

function footer(brand: BulkBrand, unsubscribePage: string | null) {
  const legal = `${brand.siteName}, published by TownCore · ${brand.postalAddress}`;
  const html =
    `<hr style="border:0;border-top:1px solid #ccc;margin:32px 0 16px">` +
    `<p style="font-size:13px;color:#555">` +
    (unsubscribePage
      ? `You get this because you subscribed at ${esc(brand.domain)}. ` +
        `<a href="${esc(unsubscribePage)}">Unsubscribe</a><br>`
      : '') +
    `${esc(legal)}</p>`;
  const text =
    `\n\n--\n` +
    (unsubscribePage
      ? `You get this because you subscribed at ${brand.domain}.\nUnsubscribe: ${unsubscribePage}\n`
      : '') +
    legal;
  return { html, text };
}

function page(bodyHtml: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:24px 16px;font-family:Georgia,serif;font-size:17px;line-height:1.55;color:#1a1a1a">` +
    `<div style="max-width:620px;margin:0 auto">${bodyHtml}</div></body></html>`
  );
}

export type BulkMessage = {
  brand: BulkBrand;
  to: string;
  subject: string;
  /** Body HTML (no footer); the footer and page wrapper are added here. */
  html: string;
  text: string;
  unsubscribeToken: string;
  /** Gmail Feedback-ID parts: campaign id and kind. */
  campaignId: string;
  kind: 'campaign' | 'newsletter' | 'placement';
};

function compile(composer: MailComposer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    composer.compile().build((error, message) => (error ? reject(error) : resolve(message))),
  );
}

export function bulkHeaders(
  m: Pick<BulkMessage, 'brand' | 'unsubscribeToken' | 'campaignId' | 'kind'>,
) {
  const urls = unsubscribeUrls(m.brand.domain, m.unsubscribeToken);
  return {
    'List-Unsubscribe': `<${urls.oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'List-Id': `${m.brand.siteName.replace(/[<>"\r\n]/g, '')} <newsletter.news.${m.brand.domain}>`,
    'Feedback-ID': `${m.campaignId.slice(0, 8)}:${m.brand.domain}:${m.kind}:towncore`,
    Precedence: 'bulk',
    'X-Auto-Response-Suppress': 'OOF, AutoReply',
  };
}

export async function buildBulkMime(m: BulkMessage): Promise<Buffer> {
  const urls = unsubscribeUrls(m.brand.domain, m.unsubscribeToken);
  const foot = footer(m.brand, urls.page);
  return compile(
    new MailComposer({
      from: mailbox(m.brand.siteName, bulkFromAddress(m.brand.domain)),
      replyTo: `${NEWSLETTER_REPLY_TO}@${m.brand.domain}`,
      to: m.to,
      subject: m.subject,
      text: `${m.text.trimEnd()}${foot.text}`,
      html: page(`${m.html}${foot.html}`),
      messageId: `<${newMessageId(`news.${m.brand.domain}`)}>`,
      headers: bulkHeaders(m),
    }),
  );
}

/** The double opt-in email (D-MAIL-11 standing exception). */
export async function buildConfirmationMime(input: {
  brand: BulkBrand;
  to: string;
  confirmUrl: string;
}): Promise<Buffer> {
  const { brand } = input;
  const foot = footer(brand, null);
  const subject = `Confirm your subscription to ${brand.siteName}`;
  const text =
    `Please confirm that you want the daily newsletter from ${brand.siteName} by opening this link:\n\n` +
    `${input.confirmUrl}\n\n` +
    `If you didn't ask for it, ignore this email and you won't hear from us again.`;
  const html =
    `<p>Please confirm that you want the daily newsletter from ${esc(brand.siteName)}.</p>` +
    `<p><a href="${esc(input.confirmUrl)}" style="font-weight:bold">Confirm my subscription</a></p>` +
    `<p>If you didn’t ask for it, ignore this email and you won’t hear from us again.</p>`;
  return compile(
    new MailComposer({
      from: mailbox(brand.siteName, bulkFromAddress(brand.domain)),
      replyTo: `${NEWSLETTER_REPLY_TO}@${brand.domain}`,
      to: input.to,
      subject,
      text: `${text}${foot.text}`,
      html: page(`${html}${foot.html}`),
      messageId: `<${newMessageId(`news.${brand.domain}`)}>`,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    }),
  );
}

/** What staff see in the admin: the email body in the same wrapper, with a note for the footer. */
export function campaignPreviewHtml(bodyHtml: string): string {
  const note =
    '<hr style="border:0;border-top:1px solid #ccc;margin:32px 0 16px">' +
    '<p style="font-size:13px;color:#555">Added when sent: the unsubscribe link and the postal address.</p>';
  return page(`${bodyHtml}${note}`).replace(
    '<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">`,
  );
}
