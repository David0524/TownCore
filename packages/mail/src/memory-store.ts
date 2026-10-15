import { randomUUID } from 'node:crypto';
import type { IdentityInfo } from './ses';
import type { DomainState, OnboardingStore, RecordState, StepName, StepState } from './onboarding';

// An in-memory OnboardingStore: dry-runs work on a copy of the real state through it, and tests
// use it directly.

export type MemoryState = {
  domains: Map<string, DomainState & Record<string, unknown>>;
  steps: Map<string, Partial<Record<StepName, StepState>>>;
  identities: Map<string, IdentityInfo>;
  records: Map<string, RecordState[]>;
  leases: Map<string, number>;
};

export function memoryStore(
  seed?: Partial<MemoryState>,
  now: () => number = Date.now,
): OnboardingStore & { state: MemoryState } {
  const state: MemoryState = {
    domains: new Map(seed?.domains),
    steps: new Map([...(seed?.steps ?? new Map())].map(([k, v]) => [k, { ...v }])),
    identities: new Map(seed?.identities),
    records: new Map(seed?.records),
    leases: new Map(seed?.leases),
  };
  const byId = (id: string) => [...state.domains.values()].find((d) => d.id === id)!;
  return {
    state,
    async ensureDomain(spec) {
      const existing = state.domains.get(spec.name);
      if (existing) return { ...existing };
      const created = {
        id: randomUUID(),
        name: spec.name,
        displayName: spec.displayName,
        status: 'pending' as const,
        failureReason: null,
      };
      state.domains.set(spec.name, created);
      return { ...created };
    },
    async getDomain(name) {
      const d = state.domains.get(name);
      return d ? { ...d } : null;
    },
    async updateDomain(id, patch) {
      Object.assign(byId(id), patch);
    },
    async acquireLease(id, ms) {
      const until = state.leases.get(id);
      if (until && until > now()) return false;
      state.leases.set(id, now() + ms);
      return true;
    },
    async releaseLease(id) {
      state.leases.delete(id);
    },
    async getSteps(id) {
      return { ...(state.steps.get(id) ?? {}) };
    },
    async setStep(id, step, value) {
      state.steps.set(id, { ...(state.steps.get(id) ?? {}), [step]: { ...value } });
    },
    async saveIdentity(id, kind, info) {
      state.identities.set(`${id}:${kind}`, { ...info });
    },
    async saveRecords(id, records) {
      const key = (r: RecordState) => `${r.type}|${r.name}|${r.value}`;
      const merged = new Map((state.records.get(id) ?? []).map((r) => [key(r), r]));
      for (const r of records) merged.set(key(r), { ...r });
      state.records.set(id, [...merged.values()]);
    },
  };
}
