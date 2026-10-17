import type { Env } from '@towncore/config';
import type { ExistingRecord } from './dns';
import { sesIdentities, type IdentityProvider } from './ses';
import { vercelDns, type DnsProvider } from './vercel';

// The DNS and SES clients onboarding talks to: real ones when the credentials are set, offline
// stand-ins (empty zones, no identities) for a dry run before they are.

export type Providers = { dns: DnsProvider; ses: IdentityProvider; offline: boolean };

/** Real Vercel DNS and SES clients, or offline stand-ins when the credentials aren't set. */
export function providersFromEnv(env: Env): Providers {
  if (!env.VERCEL_DNS_TOKEN || !env.AWS_ACCESS_KEY_ID) return offlineProviders();
  return {
    dns: vercelDns({ token: env.VERCEL_DNS_TOKEN, teamId: env.VERCEL_TEAM_ID }),
    ses: sesIdentities({ region: env.AWS_REGION ?? 'us-east-1' }),
    offline: false,
  };
}

/** For a dry-run before any credentials exist: every zone empty, no SES identities. */
export function offlineProviders(): Providers {
  const none: ExistingRecord[] = [];
  const offline = async () => {
    throw new Error('offline');
  };
  return {
    offline: true,
    dns: {
      getDomain: async (name) => ({
        name,
        serviceType: 'zeit.world',
        nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
        intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
      }),
      listRecords: async () => none,
      createRecord: offline,
      deleteRecord: offline,
    },
    ses: {
      getIdentity: async () => null,
      createIdentity: offline,
      setMailFrom: offline,
      deleteIdentity: offline,
    },
  };
}
