import { parseAddress } from '../address';

// Composing replies and new messages (brief Phase 4, §7.5): who it's from, who it goes to,
// the subject, and the signature. Pure functions; the send step stores and sends.

/** Default signature when nobody has set one (brief §6 variables). */
export const DEFAULT_SIGNATURE = '{{user_name}}\n{{town_name}}\n{{role}}@{{domain}}';

export type SignatureVars = {
  town_name: string;
  user_name: string;
  role: string;
  domain: string;
};

export function renderSignature(template: string, vars: SignatureVars): string {
  return template.replace(
    /\{\{\s*(town_name|user_name|role|domain)\s*\}\}/g,
    (_m, key: keyof SignatureVars) => vars[key],
  );
}

/** Most specific wins: this person, then this role address, then the default. */
export function pickSignature(
  rows: readonly { staffId: string | null; localPart: string | null; bodyTemplate: string }[],
  staffId: string,
  localPart: string,
): string {
  return (
    rows.find((r) => r.staffId === staffId && r.localPart === localPart)?.bodyTemplate ??
    rows.find((r) => r.staffId === staffId && r.localPart === null)?.bodyTemplate ??
    rows.find((r) => r.staffId === null && r.localPart === localPart)?.bodyTemplate ??
    rows.find((r) => r.staffId === null && r.localPart === null)?.bodyTemplate ??
    DEFAULT_SIGNATURE
  );
}

const ROLE_TITLES: Record<string, string> = { news: 'Newsroom', editor: 'Editor', tips: 'Tips' };

/**
 * The From display name (brief §7.5): the town brand plus the role, e.g. "Boca Town Square
 * Sales". Catch-all addresses (no role) show the brand alone.
 */
export function fromDisplayName(siteName: string, role: string | null): string {
  if (!role) return siteName;
  const title =
    ROLE_TITLES[role] ?? role.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${siteName} ${title}`;
}

/** RFC 5322 mailbox with a quoted display name. */
export function mailbox(name: string, address: string): string {
  return `"${name.replace(/["\\\r\n]/g, '')}" <${address}>`;
}

export function replySubject(subject: string): string {
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject || '(no subject)'}`;
}

/**
 * Who a reply goes to. Reply: the person who wrote the last inbound message (Reply-To is not
 * stored yet, so From). Reply all: also everyone else on its To and Cc, minus our own town
 * addresses and duplicates.
 */
export function replyRecipients(
  last: { fromAddress: string; toAddresses: string[]; ccAddresses: string[] },
  options: { mode: 'reply' | 'replyAll'; ourDomains: ReadonlySet<string> },
): { to: string[]; cc: string[] } {
  const ours = (a: string) => {
    const parsed = parseAddress(a);
    return (
      !parsed ||
      options.ourDomains.has(parsed.domain) ||
      options.ourDomains.has(parsed.domain.replace(/^news\./, ''))
    );
  };
  const to = [last.fromAddress.toLowerCase()];
  if (options.mode === 'reply') return { to, cc: [] };
  const seen = new Set(to);
  const cc = [...last.toAddresses, ...last.ccAddresses]
    .map((a) => a.toLowerCase())
    .filter((a) => !ours(a) && !seen.has(a) && seen.add(a));
  return { to, cc };
}

/** Comma/semicolon/space separated input → normalized addresses, or the ones that don't parse. */
export function parseRecipientList(input: string): { ok: string[]; bad: string[] } {
  const parts = input
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(/^<|>$/g, ''))
    .filter(Boolean);
  const ok: string[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    const parsed = parseAddress(p);
    if (parsed) {
      if (!ok.includes(parsed.address)) ok.push(parsed.address);
    } else bad.push(p);
  }
  return { ok, bad };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text body + signature → the text part and a simple HTML part. */
export function bodyParts(text: string, signature: string): { text: string; html: string } {
  const full = `${text.trimEnd()}\n\n-- \n${signature}`;
  const paragraphs = text
    .trimEnd()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const sig = `<p style="color:#5B6475">${esc(signature).replace(/\n/g, '<br>')}</p>`;
  return {
    text: full,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${paragraphs}${sig}</body></html>`,
  };
}
