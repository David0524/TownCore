import { warmup } from '@towncore/config';
import {
  desiredRecords,
  MAIL_FROM_LABEL,
  NEWS_LABEL,
  planDns,
  type Conflict,
  type DkimInfo,
  type DnsRecordSpec,
} from './dns';
import { identityFailed, identityVerified, type IdentityInfo, type IdentityProvider } from './ses';
import { usesVercelDns, type DnsProvider } from './vercel';

// Domain onboarding (brief §4.4, Phase 1): a resumable, per-domain state machine. Each step is
// idempotent and records its status, so a crashed or interrupted run picks up where it left
// off, and a second run on a finished domain changes nothing.
//
// In dry-run (`execute: false`) nothing outside the store is written: SES identities and DNS
// records are only reported. The CLI gives dry-runs an in-memory copy of the store.

export const STEPS = [
  'check_vercel',
  'check_conflicts',
  'root_identity',
  'news_identity',
  'write_dns',
  'verify',
  'activate',
] as const;
export type StepName = (typeof STEPS)[number];
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed';
export type StepState = { status: StepStatus; attempts: number; lastError: string | null };

export type DomainStatus = 'pending' | 'onboarding' | 'live' | 'paused' | 'failed' | 'removed';
export type DomainState = {
  id: string;
  name: string;
  displayName: string;
  status: DomainStatus;
  failureReason: string | null;
};

export type RecordState = DnsRecordSpec & {
  status: 'planned' | 'created' | 'existing';
  providerId: string | null;
};

export interface OnboardingStore {
  ensureDomain(spec: {
    name: string;
    displayName: string;
    townId?: string | null;
    isTest: boolean;
  }): Promise<DomainState>;
  getDomain(name: string): Promise<DomainState | null>;
  updateDomain(
    id: string,
    patch: Partial<{
      status: DomainStatus;
      failureReason: string | null;
      inboundEnabled: boolean;
      bulkStatus: 'not_started' | 'warming';
      warmupDay: number;
      bulkDailyCap: number;
    }>,
  ): Promise<void>;
  /** Takes the domain's lease; false if another run holds it. */
  acquireLease(id: string, ms: number): Promise<boolean>;
  releaseLease(id: string): Promise<void>;
  getSteps(id: string): Promise<Partial<Record<StepName, StepState>>>;
  setStep(id: string, step: StepName, state: StepState): Promise<void>;
  saveIdentity(id: string, kind: 'root' | 'news', info: IdentityInfo): Promise<void>;
  saveRecords(id: string, records: RecordState[]): Promise<void>;
}

export type OnboardingDeps = {
  store: OnboardingStore;
  dns: DnsProvider;
  ses: IdentityProvider;
  region: string;
  dmarcReportAddress: string;
  configSets: { conversational: string; bulk: string };
  log?: (line: string) => void;
};

export type OnboardingOutcome = 'live' | 'waiting' | 'failed' | 'planned' | 'busy';

export type OnboardingReport = {
  domain: string;
  outcome: OnboardingOutcome;
  /** What was done, or in a dry-run what would be done. */
  actions: string[];
  conflicts: Conflict[];
  error: string | null;
};

class StepFailure extends Error {
  constructor(
    message: string,
    readonly conflicts: Conflict[] = [],
  ) {
    super(message);
  }
}

const PLACEHOLDER: DkimInfo = {
  tokens: ['<dkim-1>', '<dkim-2>', '<dkim-3>'],
  signingHostedZone: '<ses-dkim-zone>',
};
export const LEASE_MS = 15 * 60_000;

/** A verified domain goes live for inbound and starts warming up for bulk (brief §7.4). */
export const ACTIVATE = {
  status: 'live',
  failureReason: null,
  inboundEnabled: true,
  bulkStatus: 'warming',
  warmupDay: 1,
  bulkDailyCap: warmup.startCap,
} as const;

export const newsIdentityName = (domain: string) => `${NEWS_LABEL}.${domain}`;

export async function onboardDomain(
  spec: { name: string; displayName: string; townId?: string | null; isTest: boolean },
  deps: OnboardingDeps,
  options: { execute: boolean },
): Promise<OnboardingReport> {
  const { store, dns, ses } = deps;
  const name = spec.name.toLowerCase();
  const report: OnboardingReport = {
    domain: name,
    outcome: 'planned',
    actions: [],
    conflicts: [],
    error: null,
  };
  const act = (line: string) => {
    report.actions.push(options.execute ? line : `would ${line}`);
    deps.log?.(`[${name}] ${options.execute ? '' : '(dry-run) '}${line}`);
  };

  const domain = await store.ensureDomain({ ...spec, name });
  if (domain.status === 'live' || domain.status === 'paused') {
    report.outcome = 'live';
    return report;
  }
  if (!(await store.acquireLease(domain.id, LEASE_MS))) {
    report.outcome = 'busy';
    return report;
  }

  const identities: Partial<Record<'root' | 'news', IdentityInfo>> = {};
  const identityFor = async (kind: 'root' | 'news') => {
    const id = kind === 'root' ? name : newsIdentityName(name);
    return (identities[kind] ??= (await ses.getIdentity(id)) ?? undefined);
  };

  const steps: Record<StepName, () => Promise<'done' | 'waiting' | 'planned'>> = {
    async check_vercel() {
      const info = await dns.getDomain(name);
      if (!info) throw new StepFailure(`${name} is not in the Vercel team`);
      if (!usesVercelDns(info))
        throw new StepFailure(
          `${name} doesn't use Vercel nameservers (has ${info.nameservers.join(', ') || 'none'}; expected ${info.intendedNameservers.join(', ')})`,
        );
      return 'done';
    },

    async check_conflicts() {
      // Before touching SES: would any non-DKIM record clash? DKIM names aren't known yet.
      const want = desiredRecords({
        ...recordInput(),
        root: PLACEHOLDER,
        news: PLACEHOLDER,
      }).filter((r) => r.purpose !== 'dkim');
      const plan = planDns(want, await dns.listRecords(name));
      if (plan.conflicts.length)
        throw new StepFailure(conflictMessage(plan.conflicts), plan.conflicts);
      return 'done';
    },

    root_identity: () =>
      identityStep('root', name, deps.configSets.conversational, `${MAIL_FROM_LABEL.root}.${name}`),
    news_identity: () =>
      identityStep(
        'news',
        newsIdentityName(name),
        deps.configSets.bulk,
        `${MAIL_FROM_LABEL.news}.${name}`,
      ),

    async write_dns() {
      const root = await identityFor('root');
      const news = await identityFor('news');
      const want = desiredRecords({
        ...recordInput(),
        root: root ? dkimOf(root) : PLACEHOLDER,
        news: news ? dkimOf(news) : PLACEHOLDER,
      });
      const plan = planDns(want, await dns.listRecords(name));
      if (plan.conflicts.length)
        throw new StepFailure(conflictMessage(plan.conflicts), plan.conflicts);
      const states: RecordState[] = plan.present.map(({ want: w, existing }) => ({
        ...w,
        status: 'existing',
        providerId: existing.id,
      }));
      for (const record of plan.create) {
        act(`create ${record.type} ${record.name || '@'} → ${record.value}`);
        const providerId = options.execute
          ? await dns.createRecord(name, record, `TownCore mail: ${record.purpose}`)
          : null;
        states.push({ ...record, status: options.execute ? 'created' : 'planned', providerId });
      }
      await store.saveRecords(domain.id, states);
      if (!options.execute && (plan.create.length > 0 || !root || !news)) return 'planned';
      return 'done';
    },

    async verify() {
      const all = [await identityFor('root'), await identityFor('news')];
      if (all.some((i) => !i)) {
        act('wait for SES to verify both identities (DKIM and MAIL FROM)');
        return options.execute ? 'waiting' : 'planned';
      }
      // Fresh status from SES on every check.
      identities.root = (await ses.getIdentity(name)) ?? undefined;
      identities.news = (await ses.getIdentity(newsIdentityName(name))) ?? undefined;
      for (const [kind, info] of Object.entries(identities) as ['root' | 'news', IdentityInfo][]) {
        await store.saveIdentity(domain.id, kind, info);
        if (identityFailed(info))
          throw new StepFailure(
            `SES verification failed for ${info.name} (DKIM ${info.dkimStatus}, MAIL FROM ${info.mailFromStatus}). Check the DNS records, then retry.`,
          );
      }
      return Object.values(identities).every((i) => i && identityVerified(i)) ? 'done' : 'waiting';
    },

    async activate() {
      act(`mark live for inbound, warming for bulk (cap ${warmup.startCap}/day)`);
      if (options.execute) {
        await store.updateDomain(domain.id, ACTIVATE);
      }
      return options.execute ? 'done' : 'planned';
    },
  };

  async function identityStep(
    kind: 'root' | 'news',
    identity: string,
    configSet: string,
    mailFrom: string,
  ) {
    let info = await identityFor(kind);
    if (!info) {
      act(`create SES identity ${identity} (Easy DKIM, default configuration set ${configSet})`);
      if (!options.execute) {
        act(`set MAIL FROM of ${identity} to ${mailFrom}`);
        return 'planned' as const;
      }
      info = await ses.createIdentity(identity, configSet, {
        domain: name,
        stream: kind === 'root' ? 'conversational' : 'bulk',
      });
      identities[kind] = info;
    }
    if (info.mailFromDomain !== mailFrom) {
      act(`set MAIL FROM of ${identity} to ${mailFrom}`);
      if (!options.execute) return 'planned' as const;
      await ses.setMailFrom(identity, mailFrom);
      info = { ...info, mailFromDomain: mailFrom, mailFromStatus: 'PENDING' };
      identities[kind] = info;
    }
    await store.saveIdentity(domain.id, kind, info);
    return 'done' as const;
  }

  function recordInput() {
    return { region: deps.region, dmarcReportAddress: deps.dmarcReportAddress };
  }

  try {
    const states = await store.getSteps(domain.id);
    // A step still marked failed waits for `onboard retry`; the domain stays failed until then.
    const stuck = STEPS.find((step) => states[step]?.status === 'failed');
    if (stuck) {
      report.outcome = 'failed';
      report.error = `${stuck}: ${states[stuck]!.lastError ?? 'failed'}`;
      return report;
    }
    if (options.execute)
      await store.updateDomain(domain.id, { status: 'onboarding', failureReason: null });
    for (const step of STEPS) {
      const before = states[step] ?? { status: 'pending', attempts: 0, lastError: null };
      if (before.status === 'done') continue;
      const attempts = before.attempts + 1;
      await store.setStep(domain.id, step, { status: 'running', attempts, lastError: null });
      let result: 'done' | 'waiting' | 'planned';
      try {
        result = await steps[step]();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.setStep(domain.id, step, { status: 'failed', attempts, lastError: message });
        await store.updateDomain(domain.id, {
          status: 'failed',
          failureReason: `${step}: ${message}`,
        });
        report.outcome = 'failed';
        report.error = message;
        if (error instanceof StepFailure) report.conflicts = error.conflicts;
        return report;
      }
      if (result === 'planned') {
        // Dry-run: the write was only reported. Leave the step pending and keep going, so the
        // report covers every step.
        await store.setStep(domain.id, step, {
          status: 'pending',
          attempts: before.attempts,
          lastError: null,
        });
        continue;
      }
      await store.setStep(domain.id, step, { status: result, attempts, lastError: null });
      if (result === 'waiting') {
        report.outcome = 'waiting';
        return report;
      }
    }
    report.outcome = options.execute ? 'live' : 'planned';
    return report;
  } finally {
    await store.releaseLease(domain.id);
  }
}

/** Puts failed steps back to pending so the next run tries them again (`onboard retry`). */
export async function resetFailedSteps(store: OnboardingStore, name: string): Promise<boolean> {
  const domain = await store.getDomain(name.toLowerCase());
  if (!domain) return false;
  const steps = await store.getSteps(domain.id);
  for (const [step, state] of Object.entries(steps) as [StepName, StepState][]) {
    if (state.status === 'failed')
      await store.setStep(domain.id, step, { ...state, status: 'pending' });
  }
  await store.updateDomain(domain.id, { status: 'onboarding', failureReason: null });
  return true;
}

function dkimOf(info: IdentityInfo): DkimInfo {
  return { tokens: info.dkimTokens, signingHostedZone: info.signingHostedZone };
}

function conflictMessage(conflicts: Conflict[]): string {
  return `DNS conflict, nothing changed: ${conflicts.map((c) => c.reason).join('; ')}`;
}
