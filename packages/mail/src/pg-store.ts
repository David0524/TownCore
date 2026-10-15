import {
  and,
  domainIdentities,
  dnsRecords,
  eq,
  isNull,
  lt,
  mailDomains,
  onboardingSteps,
  or,
  sql,
  type Db,
} from '@towncore/db';
import { memoryStore } from './memory-store';
import type { DomainState, OnboardingStore, RecordState, StepName, StepState } from './onboarding';

// The onboarding state in Postgres, so a crashed or interrupted run resumes where it stopped.

const toState = (row: typeof mailDomains.$inferSelect): DomainState => ({
  id: row.id,
  name: row.name,
  displayName: row.displayName,
  status: row.status,
  failureReason: row.failureReason,
});

export function pgOnboardingStore(db: Db): OnboardingStore {
  return {
    async ensureDomain(spec) {
      await db
        .insert(mailDomains)
        .values({
          name: spec.name,
          displayName: spec.displayName,
          townId: spec.townId ?? null,
          isTest: spec.isTest,
        })
        .onConflictDoNothing({ target: mailDomains.name });
      const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, spec.name));
      return toState(row!);
    },
    async getDomain(name) {
      const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, name));
      return row ? toState(row) : null;
    },
    async updateDomain(id, patch) {
      await db.update(mailDomains).set(patch).where(eq(mailDomains.id, id));
    },
    async acquireLease(id, ms) {
      const rows = await db
        .update(mailDomains)
        .set({ leaseUntil: sql`now() + make_interval(secs => ${ms / 1000})` })
        .where(
          and(
            eq(mailDomains.id, id),
            or(isNull(mailDomains.leaseUntil), lt(mailDomains.leaseUntil, sql`now()`)),
          ),
        )
        .returning({ id: mailDomains.id });
      return rows.length === 1;
    },
    async releaseLease(id) {
      await db.update(mailDomains).set({ leaseUntil: null }).where(eq(mailDomains.id, id));
    },
    async getSteps(id) {
      const rows = await db.select().from(onboardingSteps).where(eq(onboardingSteps.domainId, id));
      return Object.fromEntries(
        rows.map((r) => [
          r.step,
          { status: r.status, attempts: r.attempts, lastError: r.lastError },
        ]),
      ) as Partial<Record<StepName, StepState>>;
    },
    async setStep(id, step, state) {
      const now = new Date();
      const times = {
        ...(state.status === 'running' ? { startedAt: now, finishedAt: null } : {}),
        ...(state.status === 'done' || state.status === 'failed' ? { finishedAt: now } : {}),
      };
      await db
        .insert(onboardingSteps)
        .values({ domainId: id, step, ...state, ...times })
        .onConflictDoUpdate({
          target: [onboardingSteps.domainId, onboardingSteps.step],
          set: { ...state, ...times, updatedAt: now },
        });
    },
    async saveIdentity(id, kind, info) {
      const values = {
        identityName: info.name,
        verificationStatus: info.verificationStatus,
        dkimStatus: info.dkimStatus,
        dkimTokens: info.dkimTokens,
        signingHostedZone: info.signingHostedZone,
        mailFromDomain: info.mailFromDomain,
        mailFromStatus: info.mailFromStatus,
        lastCheckedAt: new Date(),
      };
      await db
        .insert(domainIdentities)
        .values({ domainId: id, kind, ...values })
        .onConflictDoUpdate({
          target: [domainIdentities.domainId, domainIdentities.kind],
          set: { ...values, updatedAt: new Date() },
        });
    },
    async saveRecords(id, records) {
      for (const r of records) {
        await db
          .insert(dnsRecords)
          .values({
            domainId: id,
            purpose: r.purpose,
            type: r.type,
            name: r.name,
            value: r.value,
            priority: r.priority ?? null,
            vercelRecordId: r.providerId,
            status: r.status,
          })
          .onConflictDoUpdate({
            target: [dnsRecords.domainId, dnsRecords.type, dnsRecords.name, dnsRecords.value],
            set: {
              // Never downgrade a record we created to "planned".
              status: sql`case when ${dnsRecords.status} = 'created' then 'created'::dns_record_status else excluded.status end`,
              vercelRecordId: sql`coalesce(excluded.vercel_record_id, ${dnsRecords.vercelRecordId})`,
              updatedAt: new Date(),
            },
          });
      }
    },
  };
}

/** A throwaway in-memory copy of one domain's state, for dry-runs. */
export async function dryRunStore(db: Db, name: string): Promise<OnboardingStore> {
  const real = pgOnboardingStore(db);
  const domain = await real.getDomain(name);
  if (!domain) return memoryStore();
  return memoryStore({
    domains: new Map([[name, { ...domain }]]),
    steps: new Map([[domain.id, await real.getSteps(domain.id)]]),
  });
}

export type { RecordState };
