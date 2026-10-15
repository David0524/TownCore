import type { DnsRecordSpec, ExistingRecord } from '../src/dns';
import type { IdentityInfo, IdentityProvider } from '../src/ses';
import type { DnsProvider, VercelDomain } from '../src/vercel';

/** A Vercel-like zone per domain. */
export function fakeDns(
  zones: Record<string, ExistingRecord[]>,
  domainInfo?: Partial<VercelDomain>,
) {
  let nextId = 1;
  const calls = { creates: 0 };
  let failOnCreate: number | null = null;
  const provider: DnsProvider = {
    async getDomain(domain) {
      if (!(domain in zones)) return null;
      return {
        name: domain,
        serviceType: 'zeit.world',
        nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
        intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
        ...domainInfo,
      };
    },
    async listRecords(domain) {
      return [...(zones[domain] ?? [])];
    },
    async createRecord(domain, record: DnsRecordSpec) {
      calls.creates++;
      if (failOnCreate !== null && calls.creates === failOnCreate)
        throw new Error('connection reset');
      const id = `rec_${nextId++}`;
      zones[domain]!.push({
        id,
        type: record.type,
        name: record.name,
        value: record.value,
        priority: record.priority ?? null,
      });
      return id;
    },
    async deleteRecord(domain, recordId) {
      zones[domain] = (zones[domain] ?? []).filter((r) => r.id !== recordId);
    },
  };
  return { provider, zones, calls, failOnCreateNumber: (n: number | null) => (failOnCreate = n) };
}

/**
 * SES that verifies an identity once its three DKIM CNAMEs and MAIL FROM MX are in the zone,
 * like the real service does after it sees the DNS.
 */
export function fakeSes(zones: Record<string, ExistingRecord[]>) {
  const identities = new Map<string, IdentityInfo>();
  const calls = { creates: 0, mailFrom: 0 };
  let dkimFails = false;
  let hold = false;
  const zoneOf = (identity: string) => identity.replace(/^news\./, '');
  const refresh = (info: IdentityInfo): IdentityInfo => {
    const zone = zones[zoneOf(info.name)] ?? [];
    const suffix = info.name.startsWith('news.') ? '.news' : '';
    const dkimOk = info.dkimTokens.every((t) =>
      zone.some((r) => r.name === `${t}._domainkey${suffix}`),
    );
    const mailFromLabel = info.mailFromDomain?.slice(0, -(zoneOf(info.name).length + 1));
    const mailFromOk = zone.some((r) => r.type === 'MX' && r.name === mailFromLabel);
    const dkimStatus = dkimFails ? 'FAILED' : dkimOk && !hold ? 'SUCCESS' : 'PENDING';
    return {
      ...info,
      dkimStatus,
      verificationStatus: dkimStatus,
      mailFromStatus: info.mailFromDomain ? (mailFromOk ? 'SUCCESS' : 'PENDING') : null,
    };
  };
  const provider: IdentityProvider = {
    async getIdentity(name) {
      const info = identities.get(name);
      return info ? refresh(info) : null;
    },
    async createIdentity(name, configurationSetName) {
      calls.creates++;
      if (!identities.has(name)) {
        const prefix = name.replace(/[^a-z0-9]/g, '').slice(0, 6);
        identities.set(name, {
          name,
          verificationStatus: 'PENDING',
          dkimStatus: 'PENDING',
          dkimTokens: [1, 2, 3].map((i) => `${prefix}tok${i}`),
          signingHostedZone: 'dkim.amazonses.com',
          mailFromDomain: null,
          mailFromStatus: null,
          configurationSetName,
        });
      }
      return refresh(identities.get(name)!);
    },
    async setMailFrom(name, mailFromDomain) {
      calls.mailFrom++;
      identities.get(name)!.mailFromDomain = mailFromDomain;
    },
    async deleteIdentity(name) {
      identities.delete(name);
    },
  };
  return {
    provider,
    identities,
    calls,
    failDkim: () => (dkimFails = true),
    /** Keep DKIM pending even with the records in place (DNS not propagated yet). */
    holdVerification: (value: boolean) => (hold = value),
  };
}
