// The email DNS records every town domain needs (brief §7.1), and a plan that compares them with
// what the zone already holds. Names are relative to the zone ('' for the apex), as Vercel uses.
// DKIM values always come from the SES API response (token + SigningHostedZone), never hardcoded.

export type DnsPurpose = 'inbound_mx' | 'dkim' | 'mail_from_mx' | 'mail_from_spf' | 'spf' | 'dmarc';
export type DnsType = 'MX' | 'TXT' | 'CNAME';

export type DnsRecordSpec = {
  purpose: DnsPurpose;
  type: DnsType;
  name: string;
  value: string;
  priority?: number;
};

export type DkimInfo = { tokens: readonly string[]; signingHostedZone: string };

export type RecordInput = {
  region: string;
  dmarcReportAddress: string;
  root: DkimInfo;
  news: DkimInfo;
};

/** Subdomain (relative) used as the custom MAIL FROM for each stream. */
export const MAIL_FROM_LABEL = { root: 'mail', news: 'bounce.news' } as const;
export const NEWS_LABEL = 'news';

const SPF = 'v=spf1 include:amazonses.com ~all';
const dmarc = (rua: string) => `v=DMARC1; p=none; rua=mailto:${rua}; fo=1`;

function dkim(info: DkimInfo, suffix: string): DnsRecordSpec[] {
  if (info.tokens.length === 0) throw new Error('SES returned no DKIM tokens');
  return info.tokens.map((token) => ({
    purpose: 'dkim' as const,
    type: 'CNAME' as const,
    name: `${token}._domainkey${suffix}`,
    value: `${token}.${info.signingHostedZone.replace(/\.$/, '')}`,
  }));
}

export function desiredRecords(input: RecordInput): DnsRecordSpec[] {
  const feedback = `feedback-smtp.${input.region}.amazonses.com`;
  return [
    // Root domain: inbound mail and the conversational stream.
    {
      purpose: 'inbound_mx',
      type: 'MX',
      name: '',
      value: `inbound-smtp.${input.region}.amazonaws.com`,
      priority: 10,
    },
    ...dkim(input.root, ''),
    {
      purpose: 'mail_from_mx',
      type: 'MX',
      name: MAIL_FROM_LABEL.root,
      value: feedback,
      priority: 10,
    },
    { purpose: 'mail_from_spf', type: 'TXT', name: MAIL_FROM_LABEL.root, value: SPF },
    { purpose: 'spf', type: 'TXT', name: '', value: SPF },
    { purpose: 'dmarc', type: 'TXT', name: '_dmarc', value: dmarc(input.dmarcReportAddress) },
    // news. subdomain: the bulk stream. No inbound MX: replies go to the root by Reply-To.
    ...dkim(input.news, `.${NEWS_LABEL}`),
    {
      purpose: 'mail_from_mx',
      type: 'MX',
      name: MAIL_FROM_LABEL.news,
      value: feedback,
      priority: 10,
    },
    { purpose: 'mail_from_spf', type: 'TXT', name: MAIL_FROM_LABEL.news, value: SPF },
    {
      purpose: 'dmarc',
      type: 'TXT',
      name: `_dmarc.${NEWS_LABEL}`,
      value: dmarc(input.dmarcReportAddress),
    },
  ];
}

/** A record already in the zone (from the DNS provider). */
export type ExistingRecord = {
  id: string;
  type: string;
  name: string;
  value: string;
  priority?: number | null;
};

export type Conflict = { want: DnsRecordSpec; existing: ExistingRecord; reason: string };

export type DnsPlan = {
  create: DnsRecordSpec[];
  present: { want: DnsRecordSpec; existing: ExistingRecord }[];
  conflicts: Conflict[];
};

const normName = (name: string) => name.trim().toLowerCase().replace(/\.$/, '');
const normValue = (type: string, value: string) => {
  let v = value.trim();
  if (type === 'TXT') v = v.replace(/^"(.*)"$/s, '$1');
  else v = v.toLowerCase().replace(/\.$/, '');
  return v.replace(/\s+/g, ' ');
};
const same = (want: DnsRecordSpec, have: ExistingRecord) =>
  want.type === have.type.toUpperCase() &&
  normName(want.name) === normName(have.name) &&
  normValue(want.type, want.value) === normValue(want.type, have.value) &&
  (want.type !== 'MX' || (have.priority ?? want.priority) === want.priority);

/**
 * What to create, what's already there, and what would clash. Never clobbers: a different MX,
 * SPF, DMARC or CNAME at a name we need is a conflict, and the domain stops for a human (brief
 * §7.1). Unrelated TXT records (site verification and the like) can live alongside ours.
 */
export function planDns(
  want: readonly DnsRecordSpec[],
  existing: readonly ExistingRecord[],
): DnsPlan {
  const plan: DnsPlan = { create: [], present: [], conflicts: [] };
  for (const record of want) {
    const atName = existing.filter((e) => normName(e.name) === normName(record.name));
    const match = atName.find((e) => same(record, e));
    if (match) {
      plan.present.push({ want: record, existing: match });
      continue;
    }
    // Our own DMARC record after an admin stepped its policy up (quarantine, reject): it is
    // still ours, kept as it is, never a conflict and never put back to p=none.
    const stepped = atName.find((e) => sameDmarcButPolicy(record, e));
    if (stepped) {
      plan.present.push({ want: { ...record, value: stepped.value }, existing: stepped });
      continue;
    }
    const clash = atName.find((e) => clashes(record, e));
    if (clash) {
      plan.conflicts.push({ want: record, existing: clash, reason: clashReason(record, clash) });
      continue;
    }
    plan.create.push(record);
  }
  return plan;
}

const withoutPolicy = (value: string) =>
  normValue('TXT', value)
    .toLowerCase()
    .replace(/(^|;)\s*p=\s*(none|quarantine|reject)\s*(?=;|$)/, '$1 p=*');

function sameDmarcButPolicy(want: DnsRecordSpec, have: ExistingRecord): boolean {
  return (
    want.purpose === 'dmarc' &&
    have.type.toUpperCase() === 'TXT' &&
    txtKind(have.value) === 'dmarc' &&
    withoutPolicy(want.value) === withoutPolicy(have.value)
  );
}

function txtKind(value: string): 'spf' | 'dmarc' | 'other' {
  const v = normValue('TXT', value).toLowerCase();
  if (v.startsWith('v=spf1')) return 'spf';
  if (v.startsWith('v=dmarc1')) return 'dmarc';
  return 'other';
}

function clashes(want: DnsRecordSpec, have: ExistingRecord): boolean {
  const type = have.type.toUpperCase();
  // A CNAME can't share its name with any other record, in either direction.
  if (want.type === 'CNAME' || type === 'CNAME') return true;
  if (want.type === 'MX') return type === 'MX';
  // TXT: only another SPF (for SPF) or another DMARC policy (for DMARC) clashes.
  return (
    type === 'TXT' && txtKind(have.value) !== 'other' && txtKind(have.value) === txtKind(want.value)
  );
}

function clashReason(want: DnsRecordSpec, have: ExistingRecord): string {
  const where = want.name || '@';
  if (have.type.toUpperCase() === 'CNAME' || want.type === 'CNAME')
    return `${where} already has a ${have.type} record (${have.value}); a CNAME can't coexist with it`;
  if (want.type === 'MX') return `${where} already has an MX record pointing to ${have.value}`;
  return `${where} already has a different ${txtKind(want.value).toUpperCase()} record: "${have.value}"`;
}
