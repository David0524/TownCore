import { describe, expect, it } from 'vitest';
import { desiredRecords, planDns, type ExistingRecord } from '../src/dns';

const input = {
  region: 'us-east-1',
  dmarcReportAddress: 'dmarc@towncore.net',
  root: { tokens: ['r1', 'r2', 'r3'], signingHostedZone: 'dkim.amazonses.com' },
  news: { tokens: ['n1', 'n2', 'n3'], signingHostedZone: 'dkim.amazonses.com.' },
};
const want = desiredRecords(input);
const row = (r: Omit<ExistingRecord, 'id'>, id = 'rec'): ExistingRecord => ({ id, ...r });

describe('desiredRecords', () => {
  it('builds the root and news. records from the SES response (brief §7.1)', () => {
    expect(want.map((r) => [r.type, r.name, r.value, r.priority ?? null])).toEqual([
      ['MX', '', 'inbound-smtp.us-east-1.amazonaws.com', 10],
      ['CNAME', 'r1._domainkey', 'r1.dkim.amazonses.com', null],
      ['CNAME', 'r2._domainkey', 'r2.dkim.amazonses.com', null],
      ['CNAME', 'r3._domainkey', 'r3.dkim.amazonses.com', null],
      ['MX', 'mail', 'feedback-smtp.us-east-1.amazonses.com', 10],
      ['TXT', 'mail', 'v=spf1 include:amazonses.com ~all', null],
      ['TXT', '', 'v=spf1 include:amazonses.com ~all', null],
      ['TXT', '_dmarc', 'v=DMARC1; p=none; rua=mailto:dmarc@towncore.net; fo=1', null],
      ['CNAME', 'n1._domainkey.news', 'n1.dkim.amazonses.com', null],
      ['CNAME', 'n2._domainkey.news', 'n2.dkim.amazonses.com', null],
      ['CNAME', 'n3._domainkey.news', 'n3.dkim.amazonses.com', null],
      ['MX', 'bounce.news', 'feedback-smtp.us-east-1.amazonses.com', 10],
      ['TXT', 'bounce.news', 'v=spf1 include:amazonses.com ~all', null],
      ['TXT', '_dmarc.news', 'v=DMARC1; p=none; rua=mailto:dmarc@towncore.net; fo=1', null],
    ]);
  });

  it('gives news. no inbound MX', () => {
    expect(want.filter((r) => r.purpose === 'inbound_mx').map((r) => r.name)).toEqual(['']);
  });

  it('uses the signing zone SES returns, whatever the region', () => {
    const other = desiredRecords({
      ...input,
      region: 'eu-south-1',
      root: { tokens: ['a'], signingHostedZone: 'dkim.eu-south-1.amazonses.com' },
    });
    expect(other).toContainEqual(
      expect.objectContaining({ name: 'a._domainkey', value: 'a.dkim.eu-south-1.amazonses.com' }),
    );
    expect(() =>
      desiredRecords({ ...input, root: { tokens: [], signingHostedZone: 'x' } }),
    ).toThrow();
  });
});

describe('planDns', () => {
  it('creates everything on an empty zone', () => {
    const plan = planDns(want, []);
    expect(plan.create).toHaveLength(want.length);
    expect(plan.conflicts).toEqual([]);
  });

  it('treats an identical existing record as present, ignoring case, quotes and dots', () => {
    const plan = planDns(want, [
      row({ type: 'MX', name: '', value: 'INBOUND-SMTP.us-east-1.amazonaws.com.', priority: 10 }),
      row({ type: 'TXT', name: '', value: '"v=spf1 include:amazonses.com ~all"' }),
      row({ type: 'CNAME', name: 'r1._domainkey', value: 'r1.dkim.amazonses.com.' }),
    ]);
    expect(plan.present).toHaveLength(3);
    expect(plan.create).toHaveLength(want.length - 3);
  });

  it('a second run against the records it created is a no-op', () => {
    const created = want.map((r, i) => row({ ...r }, `id${i}`));
    expect(planDns(want, created)).toMatchObject({ create: [], conflicts: [] });
  });

  it('never clobbers: a different MX, SPF, DMARC or a clashing CNAME is a conflict', () => {
    const plan = planDns(want, [
      row({ type: 'MX', name: '', value: 'aspmx.l.google.com', priority: 1 }),
      row({ type: 'TXT', name: '', value: 'v=spf1 include:_spf.google.com ~all' }),
      row({ type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=reject' }),
      row({ type: 'A', name: 'mail', value: '192.0.2.1' }),
      row({ type: 'CNAME', name: 'r1._domainkey', value: 'something.else.com' }),
    ]);
    expect(plan.conflicts.map((c) => [c.want.purpose, c.want.name])).toEqual([
      ['inbound_mx', ''],
      ['dkim', 'r1._domainkey'],
      ['spf', ''],
      ['dmarc', '_dmarc'],
    ]);
    expect(plan.conflicts[0]!.reason).toContain('aspmx.l.google.com');
    // An A record at mail. doesn't block the MX or SPF there.
    expect(plan.create.map((r) => r.name)).toContain('mail');
  });

  it('lets unrelated TXT records live alongside ours', () => {
    const plan = planDns(want, [
      row({ type: 'TXT', name: '', value: 'google-site-verification=abc' }),
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('a CNAME already at a name blocks any record we want there', () => {
    const plan = planDns(want, [row({ type: 'CNAME', name: 'mail', value: 'elsewhere.com' })]);
    expect(plan.conflicts.map((c) => c.want.purpose).sort()).toEqual([
      'mail_from_mx',
      'mail_from_spf',
    ]);
  });

  it('an MX with the right host but a different priority is a conflict', () => {
    const plan = planDns(want, [
      row({ type: 'MX', name: '', value: 'inbound-smtp.us-east-1.amazonaws.com', priority: 20 }),
    ]);
    expect(plan.conflicts.map((c) => c.want.purpose)).toEqual(['inbound_mx']);
  });
});
