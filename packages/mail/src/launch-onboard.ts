import type { Env } from '@towncore/config';
import type { Db } from '@towncore/db';
import type { OnboardingStore } from './onboarding';
import { providersFromEnv, type Providers } from './providers';
import { onboardDomain, type OnboardingReport } from './onboarding';
import { dryRunStore, pgOnboardingStore } from './pg-store';

// Mail onboarding started by the cohort orchestrator (docs/plans/agentic-ops.md): the same state
// machine as `pnpm mail:onboard add`, for one bought town domain. The cohort's batch purchase
// approval is the owner's approval for these DNS and SES changes (it stands in for --approved);
// a DNS conflict still fails the domain with nothing overwritten. Dry run unless `execute`.

export async function onboardLaunchDomain(
  db: Db,
  env: Env,
  spec: { name: string; displayName: string; townId: string | null },
  options: { execute: boolean },
  providers: Providers = providersFromEnv(env),
  /** A dry run's in-memory store, when the caller already prepared one. */
  dryStore?: OnboardingStore,
): Promise<OnboardingReport> {
  const name = spec.name.toLowerCase();
  const refuse = (error: string): OnboardingReport => ({
    domain: name,
    outcome: 'failed',
    actions: [],
    conflicts: [],
    error,
  });
  if (options.execute) {
    if (providers.offline)
      return refuse('Mail onboarding needs VERCEL_DNS_TOKEN and AWS credentials.');
    const missing = (
      ['DMARC_REPORT_ADDRESS', 'SES_CONFIG_SET_CONVERSATIONAL', 'SES_CONFIG_SET_BULK'] as const
    ).filter((k) => !env[k]);
    if (missing.length) return refuse(`Mail onboarding needs ${missing.join(', ')}.`);
  }
  return onboardDomain(
    {
      name,
      displayName: spec.displayName,
      townId: spec.townId,
      isTest: (env.MAIL_TEST_DOMAINS ?? []).includes(name),
    },
    {
      store: options.execute ? pgOnboardingStore(db) : (dryStore ?? (await dryRunStore(db, name))),
      dns: providers.dns,
      ses: providers.ses,
      region: env.AWS_REGION ?? 'us-east-1',
      dmarcReportAddress: env.DMARC_REPORT_ADDRESS ?? '<DMARC_REPORT_ADDRESS>',
      configSets: {
        conversational: env.SES_CONFIG_SET_CONVERSATIONAL ?? '<SES_CONFIG_SET_CONVERSATIONAL>',
        bulk: env.SES_CONFIG_SET_BULK ?? '<SES_CONFIG_SET_BULK>',
      },
    },
    options,
  );
}
