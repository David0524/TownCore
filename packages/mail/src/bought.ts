import { requireEnv, type Env } from '@towncore/config';
import {
  and,
  eq,
  launches,
  launchStepRecords,
  mailDomains,
  or,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { onboardLaunchDomain } from './launch-onboard';
import { resetFailedSteps, type OnboardingReport } from './onboarding';
import { dryRunStore, pgOnboardingStore } from './pg-store';
import type { Providers } from './providers';

// Mail warm-up starts the moment we own a domain (owner, 2026-10-17). A domain bought through a
// launch (step 2, Rule 10: the operator typed it back at the quoted price) is onboarded right
// after, under that same approval: the purchase counts as `--approved` for onboarding. The
// worker's 5-minute check then takes it live and warming at 50 a day, so reputation builds from
// staff test issues while the site is still a draft. This module finds those domains and
// onboards one; the launcher calls it after a purchase, `pnpm mail:onboard bought` catches any
// left behind (credentials missing at purchase time), and a Mail health alert names them.

/** Onboard a cohort's domains this many days before its go-live month, so they are warm. */
export const MAIL_LEAD_DAYS = 21;
/** A bought domain with no mail domain this long after purchase raises a Mail health alert. */
export const ONBOARD_GRACE_MS = 60 * 60_000;

export type BoughtDomain = {
  domain: string;
  siteName: string | null;
  slug: string;
  launchId: string;
  orderId: string;
  boughtAt: Date | null;
  /** The planned go-live month ("2026-12"), from `pnpm launch --cohort`; null when unplanned. */
  cohort: string | null;
  /** The day onboarding should have started for the cohort to be warm at go-live. */
  startBy: string | null;
  mail: {
    status: string;
    bulkStatus: string;
    warmupDay: number;
    bulkDailyCap: number;
    failureReason: string | null;
  } | null;
};

/** The first day of a cohort month minus the lead time, as YYYY-MM-DD. */
export function onboardBy(cohort: string | null): string | null {
  if (!cohort || !/^\d{4}-\d{2}$/.test(cohort)) return null;
  const start = new Date(`${cohort}-01T00:00:00Z`);
  return new Date(start.getTime() - MAIL_LEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every domain a launch bought (step 2's order completed), with its mail domain if it has one,
 * soonest cohort first, then oldest purchase: the order onboarding should go in.
 */
export async function boughtDomains(db: Db): Promise<BoughtDomain[]> {
  const rows = await db
    .select({
      domain: sql<string>`${launchStepRecords.detail}->'picked'->>'domain'`,
      siteName: sql<string | null>`${launchStepRecords.detail}->'picked'->>'siteName'`,
      orderId: sql<string>`${launchStepRecords.detail}->'purchase'->>'orderId'`,
      boughtAt: launchStepRecords.finishedAt,
      launchId: launches.id,
      slug: launches.slug,
      cohort: sql<string | null>`${launches.options}->>'cohort'`,
      status: mailDomains.status,
      bulkStatus: mailDomains.bulkStatus,
      warmupDay: mailDomains.warmupDay,
      bulkDailyCap: mailDomains.bulkDailyCap,
      failureReason: mailDomains.failureReason,
    })
    .from(launchStepRecords)
    .innerJoin(launches, eq(launches.id, launchStepRecords.launchId))
    .leftJoin(
      mailDomains,
      eq(mailDomains.name, sql`lower(${launchStepRecords.detail}->'picked'->>'domain')`),
    )
    .where(
      and(
        eq(launchStepRecords.step, 'names'),
        sql`${launchStepRecords.detail}->'purchase'->>'status' = 'completed'`,
        sql`${launchStepRecords.detail}->'purchase'->>'orderId' is not null`,
      ),
    )
    .orderBy(
      sql`${launches.options}->>'cohort' asc nulls last`,
      sql`${launchStepRecords.finishedAt} asc nulls last`,
    );
  return rows.map((r) => ({
    domain: r.domain.toLowerCase(),
    siteName: r.siteName,
    slug: r.slug,
    launchId: r.launchId,
    orderId: r.orderId,
    boughtAt: r.boughtAt,
    cohort: r.cohort,
    startBy: onboardBy(r.cohort),
    mail: r.status
      ? {
          status: r.status,
          bulkStatus: r.bulkStatus!,
          warmupDay: r.warmupDay!,
          bulkDailyCap: r.bulkDailyCap!,
          failureReason: r.failureReason,
        }
      : null,
  }));
}

/** Bought domains that still need onboarding: never started, unfinished, or failed. */
export const needsOnboarding = (d: BoughtDomain) =>
  d.mail === null || ['pending', 'onboarding', 'failed'].includes(d.mail.status);

export type MailStart =
  { outcome: 'not started'; domain: string; reason: string } | OnboardingReport;

/** What `--execute` onboarding needs, by name, when it's missing. */
export function missingForOnboarding(env: Env, providers: Providers): string[] {
  const missing: string[] = [];
  if (providers.offline) missing.push('VERCEL_DNS_TOKEN and AWS credentials');
  for (const name of [
    'DMARC_REPORT_ADDRESS',
    'SES_CONFIG_SET_CONVERSATIONAL',
    'SES_CONFIG_SET_BULK',
  ] as const)
    if (!env[name]) missing.push(name);
  return missing;
}

/**
 * Onboards one bought domain. The purchase is the approval (Rule 10), so no `--approved` and no
 * MAIL_TEST_DOMAINS check. Without `execute` it plans only. Never overwrites a conflicting
 * record: a conflict fails the domain with nothing changed, for a person to resolve.
 */
export async function onboardBoughtDomain(
  db: Db,
  input: { domain: string; displayName: string; orderId: string },
  ctx: { env: Env; providers: Providers; execute: boolean },
): Promise<MailStart> {
  const domain = input.domain.toLowerCase();
  if (ctx.execute) {
    const missing = missingForOnboarding(ctx.env, ctx.providers);
    if (missing.length)
      return {
        outcome: 'not started',
        domain,
        reason: `needs ${missing.join(', ')} (docs/mail/RUNBOOK.md); then run pnpm mail:onboard bought --execute`,
      };
    requireEnv('DMARC_REPORT_ADDRESS', ctx.env);
  }
  const [town] = await db
    .select({ id: towns.id })
    .from(towns)
    .where(or(eq(towns.domain, domain), sql`${domain} = any(${towns.extraDomains})`));
  // A failed earlier attempt (a conflict since fixed, a timeout) starts again from its failed
  // step; a dry run plans the same retry in memory. Then the same onboarding the cohort
  // orchestrator runs (one state machine, one lease, so the two never collide).
  const store = ctx.execute ? pgOnboardingStore(db) : await dryRunStore(db, domain);
  await resetFailedSteps(store, domain);
  return onboardLaunchDomain(
    db,
    ctx.env,
    { name: domain, displayName: input.displayName, townId: town?.id ?? null },
    { execute: ctx.execute },
    ctx.providers,
    ctx.execute ? undefined : store,
  );
}
