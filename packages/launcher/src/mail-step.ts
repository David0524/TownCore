import { warmup, type Env } from '@towncore/config';
import type { Db } from '@towncore/db';
import {
  onboardBoughtDomain,
  onboardBy,
  warmupCap,
  type Conflict,
  type MailStart,
  type Providers,
} from '@towncore/mail';
import type { NamesDetail } from './names-step';

// Launch step 2b (owner, 2026-10-17): mail warm-up starts the moment we own the domain. Right
// after step 2 buys it, the launcher onboards it for mail (SES identities for the root and
// news., Easy DKIM, custom MAIL FROM, and the SPF, DMARC and MX records on Vercel). The purchase
// approval covers this (Rule 10), so no second approval and no MAIL_TEST_DOMAINS limit. The
// worker's 5-minute check takes the domain live once DNS verifies, and warm-up starts at 50 a
// day: staff test issues and news@ replies build its reputation while the site is a draft.
// Nothing here stops the launch: a conflict or a missing credential becomes a launch to-do,
// `pnpm mail:onboard bought --execute` catches it up, and Mail health alerts until it does.

export type MailDeps = {
  env: Env;
  /** Vercel DNS and SES clients (offline stand-ins without credentials). */
  providers: Providers;
};

export type MailDetail = {
  domain: string;
  /**
   * - planned: the domain isn't bought yet (dry run); `plan` is what onboarding will do.
   * - waiting: identities and records are in; SES is verifying the DNS (the worker takes it live).
   * - live: verified, warming up from 50 a day.
   * - not started: bought, but credentials are missing; caught up later.
   * - failed: a conflicting record or an API error; nothing was overwritten.
   */
  state: 'planned' | 'waiting' | 'live' | 'not started' | 'failed';
  /** Why, in a sentence. */
  detail: string;
  /** The purchase that approved onboarding (Rule 10). */
  approvedBy: string | null;
  actions: string[];
  conflicts: Conflict[];
  cohort: string | null;
  /** The day onboarding should start for the cohort to be warm at go-live. */
  startBy: string | null;
  /** The warm-up ramp from day 1, for the report. */
  ramp: Array<{ day: number; cap: number }>;
};

const RAMP_DAYS = [1, 4, 7, 10, 13, 16, 19, 22, 28];

export async function mailStep(input: {
  db: Db;
  deps?: MailDeps;
  names: NamesDetail;
  cohort?: string;
}): Promise<{ detail: MailDetail }> {
  const { names } = input;
  const domain = names.picked?.domain;
  if (!domain) throw new Error('No domain picked in step 2.');
  const purchase = names.purchase;
  const bought = purchase && 'orderId' in purchase && purchase.status === 'completed';
  const base = {
    domain,
    cohort: input.cohort ?? null,
    startBy: onboardBy(input.cohort ?? null),
    ramp: RAMP_DAYS.map((day) => ({ day, cap: warmupCap(day, warmup.targetCap) })),
  };
  if (!input.deps)
    return {
      detail: {
        ...base,
        state: bought ? 'not started' : 'planned',
        detail: bought
          ? 'No mail settings were given to this run; run pnpm mail:onboard bought --execute.'
          : 'Starts when the domain is bought.',
        approvedBy: bought ? `domain order ${purchase.orderId}` : null,
        actions: [],
        conflicts: [],
      },
    };

  let report: MailStart;
  try {
    report = await onboardBoughtDomain(
      input.db,
      {
        domain,
        displayName: names.picked!.siteName,
        orderId: bought ? purchase.orderId : '',
      },
      { env: input.deps.env, providers: input.deps.providers, execute: Boolean(bought) },
    );
  } catch (error) {
    report = {
      domain,
      outcome: 'failed',
      actions: [],
      conflicts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const approvedBy = bought ? `domain order ${purchase.orderId}` : null;
  if (report.outcome === 'not started')
    return {
      detail: {
        ...base,
        state: 'not started',
        detail: report.reason,
        approvedBy,
        actions: [],
        conflicts: [],
      },
    };
  const { actions, conflicts } = report;
  if (!bought)
    return {
      detail: {
        ...base,
        state: conflicts.length ? 'failed' : 'planned',
        detail: conflicts.length
          ? `Onboarding would stop on ${conflicts.length} conflicting DNS record(s); fix them before buying or after.`
          : `Starts when the domain is bought: ${actions.length} action(s) planned, no conflicts.`,
        approvedBy,
        actions,
        conflicts,
      },
    };
  const state =
    report.outcome === 'live' ? 'live' : report.outcome === 'failed' ? 'failed' : 'waiting';
  return {
    detail: {
      ...base,
      state,
      detail:
        state === 'live'
          ? 'Verified: warming up from 50 emails a day.'
          : state === 'waiting'
            ? 'Identities and DNS records are in; SES is verifying them. The worker takes the domain live and starts warm-up at 50 a day.'
            : `Onboarding stopped: ${report.error ?? 'see Admin → Mail domains'}. Nothing was overwritten.`,
      approvedBy,
      actions,
      conflicts,
    },
  };
}

/** The launch report's to-dos for the mail step. */
export function mailTodos(mail: MailDetail | undefined): string[] {
  if (!mail) return [];
  const out: string[] = [];
  for (const c of mail.conflicts)
    out.push(
      `Mail DNS conflict on ${mail.domain}: wants ${c.want.type} ${c.want.name || '@'} → ${c.want.value}; ${c.reason}. Fix the record in Vercel, then \`pnpm mail:onboard bought --execute\`.`,
    );
  if (mail.state === 'not started')
    out.push(`Start mail onboarding for ${mail.domain}: ${mail.detail}`);
  else if (mail.state === 'failed' && !mail.conflicts.length)
    out.push(
      `Mail onboarding for ${mail.domain} failed: ${mail.detail} Retry with \`pnpm mail:onboard bought --execute\`.`,
    );
  return out;
}
