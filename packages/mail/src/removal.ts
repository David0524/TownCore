import {
  and,
  dnsRecords,
  domainIdentities,
  eq,
  isNotNull,
  mailDomains,
  onboardingSteps,
  type Db,
} from '@towncore/db';
import type { IdentityProvider } from './ses';
import type { DnsProvider } from './vercel';

// Removing a domain cleanly (brief Phase 6; docs/plans/MAIL.md, Mail-6). Deletes only what we
// created: the DNS records onboarding wrote (by their Vercel record ids) and the domain's two
// SES identities. Records that existed before us are never touched. Mail history stays.

export type RemovalPlan = {
  domain: string;
  domainId: string;
  records: { id: string; vercelRecordId: string; type: string; name: string; value: string }[];
  identities: string[];
};

export async function planRemoval(db: Db, name: string): Promise<RemovalPlan | null> {
  const [domain] = await db.select().from(mailDomains).where(eq(mailDomains.name, name));
  if (!domain) return null;
  const records = await db
    .select()
    .from(dnsRecords)
    .where(
      and(
        eq(dnsRecords.domainId, domain.id),
        eq(dnsRecords.status, 'created'),
        isNotNull(dnsRecords.vercelRecordId),
      ),
    );
  return {
    domain: domain.name,
    domainId: domain.id,
    records: records.map((r) => ({
      id: r.id,
      vercelRecordId: r.vercelRecordId!,
      type: r.type,
      name: r.name,
      value: r.value,
    })),
    identities: [domain.name, `news.${domain.name}`],
  };
}

export function describeRemoval(plan: RemovalPlan): string[] {
  return [
    `${plan.domain}: would delete ${plan.records.length} DNS record(s) we created and ${plan.identities.length} SES identities.`,
    ...plan.records.map(
      (r) =>
        `  DNS  ${r.type.padEnd(5)} ${r.name || '@'} → ${r.value}  (Vercel ${r.vercelRecordId})`,
    ),
    ...plan.identities.map((i) => `  SES  identity ${i}`),
    '  Then: status removed, inbound off, bulk paused, newsletter off. Mail history is kept.',
  ];
}

/** Deletes the records and identities, then marks the domain removed. Safe to re-run. */
export async function applyRemoval(
  db: Db,
  plan: RemovalPlan,
  providers: { dns: DnsProvider; ses: IdentityProvider },
): Promise<void> {
  for (const r of plan.records) {
    await providers.dns.deleteRecord(plan.domain, r.vercelRecordId);
    await db.delete(dnsRecords).where(eq(dnsRecords.id, r.id));
  }
  for (const identity of plan.identities) await providers.ses.deleteIdentity(identity);
  await db.delete(domainIdentities).where(eq(domainIdentities.domainId, plan.domainId));
  // A later `add` starts from scratch instead of trusting steps whose work was undone.
  await db.delete(onboardingSteps).where(eq(onboardingSteps.domainId, plan.domainId));
  await db
    .update(mailDomains)
    .set({
      status: 'removed',
      inboundEnabled: false,
      bulkStatus: 'paused',
      pausedReason: 'Domain removed',
      newsletterMode: 'off',
      newsletterApprovedAt: null,
      newsletterApprovedBy: null,
    })
    .where(eq(mailDomains.id, plan.domainId));
}
