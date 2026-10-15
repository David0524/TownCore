import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { requireEnv, type Env } from '@towncore/config';
import { eq, mailDomains, onboardingSteps, or, sql, towns, type Db } from '@towncore/db';
import type { ExistingRecord } from '../dns';
import {
  onboardDomain,
  resetFailedSteps,
  STEPS,
  type OnboardingDeps,
  type OnboardingReport,
} from '../onboarding';
import { dryRunStore, pgOnboardingStore } from '../pg-store';
import { applyRemoval, describeRemoval, planRemoval } from '../removal';
import { sesIdentities, type IdentityProvider } from '../ses';
import { vercelDns, type DnsProvider } from '../vercel';

// `pnpm mail:onboard <add|status|retry|verify-all>` (brief Phase 1). Dry-run is the default and
// prints exactly what would happen; --execute applies it. DNS changes on anything but the
// owner's test domains also need --approved (brief §2.1: stop and ask).

export const USAGE = `Usage:
  pnpm mail:onboard add <domain...> [--from-file domains.txt] [--display-name "Name"] [--execute] [--approved]
  pnpm mail:onboard status [domain]
  pnpm mail:onboard retry <domain> [--execute] [--approved]
  pnpm mail:onboard verify-all [--execute]
  pnpm mail:onboard remove <domain> [--execute] [--approved]

Dry-run is the default. --execute writes SES identities and DNS records (remove deletes them).
--approved is required to change any domain not in MAIL_TEST_DOMAINS, and for more than
one domain at a time outside the test list.`;

export type Providers = { dns: DnsProvider; ses: IdentityProvider; offline: boolean };

export type CommandContext = {
  db: Db;
  env: Env;
  out: (line: string) => void;
  /** Real API clients by default; tests pass fakes. */
  providers?: (env: Env) => Providers;
};

export class GuardError extends Error {}

/** Brief §2.1 C: DNS changes outside the test domains, and bulk runs, need the owner's OK. */
export function checkAllowed(
  domains: readonly string[],
  options: { execute: boolean; approved: boolean; testDomains: readonly string[] },
): void {
  if (!options.execute || options.approved) return;
  const outside = domains.filter((d) => !options.testDomains.includes(d));
  if (outside.length) {
    throw new GuardError(
      `Refusing to change ${outside.join(', ')}: not in MAIL_TEST_DOMAINS. ` +
        'Get the owner’s approval, then re-run with --approved.',
    );
  }
}

export async function runOnboardCommand(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      execute: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      approved: { type: 'boolean', default: false },
      'from-file': { type: 'string' },
      'display-name': { type: 'string' },
      concurrency: { type: 'string', default: '4' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.execute && values['dry-run']) {
    ctx.out('Pick one of --execute and --dry-run.');
    return 2;
  }
  const execute = values.execute;
  const concurrency = Math.max(1, Math.min(16, Number(values.concurrency) || 4));

  switch (command) {
    case 'status':
      await printStatus(ctx, rest[0]);
      return 0;
    case 'add': {
      const fromFile = values['from-file']
        ? readFileSync(values['from-file'], 'utf8')
            .split(/\r?\n/)
            .map((l) => l.replace(/#.*/, '').trim())
            .filter(Boolean)
        : [];
      const domains = [...new Set([...rest, ...fromFile].map((d) => d.toLowerCase()))];
      if (!domains.length) {
        ctx.out(USAGE);
        return 2;
      }
      return runMany(ctx, domains, {
        execute,
        approved: values.approved,
        concurrency,
        displayName: values['display-name'],
      });
    }
    case 'retry': {
      const domain = rest[0]?.toLowerCase();
      if (!domain) {
        ctx.out(USAGE);
        return 2;
      }
      try {
        checkAllowedFor(ctx, [domain], execute, values.approved);
      } catch (error) {
        if (!(error instanceof GuardError)) throw error;
        ctx.out(error.message);
        return 3;
      }
      if (execute && !(await resetFailedSteps(pgOnboardingStore(ctx.db), domain))) {
        ctx.out(`${domain} has never been onboarded; use add.`);
        return 1;
      }
      return runMany(ctx, [domain], {
        execute,
        approved: values.approved,
        concurrency: 1,
        retry: !execute,
      });
    }
    case 'remove': {
      const domain = rest[0]?.toLowerCase();
      if (!domain) {
        ctx.out(USAGE);
        return 2;
      }
      const plan = await planRemoval(ctx.db, domain);
      if (!plan) {
        ctx.out(`${domain} isn't a mail domain.`);
        return 1;
      }
      for (const line of describeRemoval(plan)) ctx.out(line);
      if (!execute) {
        ctx.out(
          'Dry run: nothing changed. Re-run with --execute (and --approved outside MAIL_TEST_DOMAINS).',
        );
        return 0;
      }
      try {
        checkAllowedFor(ctx, [domain], execute, values.approved);
      } catch (error) {
        if (!(error instanceof GuardError)) throw error;
        ctx.out(error.message);
        return 3;
      }
      const providers = (ctx.providers ?? realProviders)(ctx.env);
      if (providers.offline) {
        ctx.out('No Vercel token or AWS credentials: can’t remove anything.');
        return 1;
      }
      await applyRemoval(ctx.db, plan, providers);
      ctx.out(`${domain} removed.`);
      return 0;
    }
    case 'verify-all': {
      const rows = await ctx.db
        .select({ name: mailDomains.name })
        .from(mailDomains)
        .where(eq(mailDomains.status, 'onboarding'));
      if (!rows.length) {
        ctx.out('No domains are waiting on verification.');
        return 0;
      }
      // Verification only reads SES and writes our own rows, but a resumed run may still have
      // DNS left to write, so the same guard applies.
      return runMany(
        ctx,
        rows.map((r) => r.name),
        { execute, approved: values.approved, concurrency },
      );
    }
    default:
      ctx.out(USAGE);
      return command ? 2 : 0;
  }
}

function checkAllowedFor(
  ctx: CommandContext,
  domains: string[],
  execute: boolean,
  approved: boolean,
) {
  checkAllowed(domains, { execute, approved, testDomains: ctx.env.MAIL_TEST_DOMAINS ?? [] });
}

async function runMany(
  ctx: CommandContext,
  domains: string[],
  options: {
    execute: boolean;
    approved: boolean;
    concurrency: number;
    displayName?: string;
    retry?: boolean;
  },
): Promise<number> {
  try {
    checkAllowedFor(ctx, domains, options.execute, options.approved);
  } catch (error) {
    if (error instanceof GuardError) {
      ctx.out(error.message);
      return 3;
    }
    throw error;
  }
  const providers = (ctx.providers ?? realProviders)(ctx.env);
  if (providers.offline) {
    if (options.execute) {
      ctx.out('--execute needs VERCEL_DNS_TOKEN and AWS credentials (see docs/mail/RUNBOOK.md).');
      return 1;
    }
    ctx.out(
      'Offline dry-run: no Vercel token or AWS credentials, so assuming empty zones and no SES identities.',
    );
  }
  ctx.out(
    options.execute
      ? 'Executing.'
      : 'Dry-run: nothing will be changed. Re-run with --execute to apply.',
  );

  const testDomains = ctx.env.MAIL_TEST_DOMAINS ?? [];
  const reports: OnboardingReport[] = [];
  const queue = [...domains];
  const worker = async () => {
    for (let domain = queue.shift(); domain; domain = queue.shift()) {
      try {
        const town = await townFor(ctx.db, domain);
        const known = await pgOnboardingStore(ctx.db).getDomain(domain);
        const displayName = town?.siteName ?? known?.displayName ?? options.displayName;
        if (!displayName) {
          reports.push(failed(domain, 'not a town domain; pass --display-name'));
          continue;
        }
        const store = options.execute
          ? pgOnboardingStore(ctx.db)
          : await dryRunStore(ctx.db, domain);
        if (!options.execute && options.retry) await resetFailedSteps(store, domain);
        const deps: OnboardingDeps = {
          store,
          dns: providers.dns,
          ses: providers.ses,
          region: ctx.env.AWS_REGION ?? 'us-east-1',
          dmarcReportAddress: ctx.env.DMARC_REPORT_ADDRESS ?? '<DMARC_REPORT_ADDRESS>',
          configSets: {
            conversational:
              ctx.env.SES_CONFIG_SET_CONVERSATIONAL ?? '<SES_CONFIG_SET_CONVERSATIONAL>',
            bulk: ctx.env.SES_CONFIG_SET_BULK ?? '<SES_CONFIG_SET_BULK>',
          },
        };
        if (options.execute) {
          requireEnv('DMARC_REPORT_ADDRESS', ctx.env);
          requireEnv('SES_CONFIG_SET_CONVERSATIONAL', ctx.env);
          requireEnv('SES_CONFIG_SET_BULK', ctx.env);
        }
        reports.push(
          await onboardDomain(
            {
              name: domain,
              displayName,
              townId: town?.id ?? null,
              isTest: testDomains.includes(domain),
            },
            deps,
            { execute: options.execute },
          ),
        );
      } catch (error) {
        reports.push(failed(domain, error instanceof Error ? error.message : String(error)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, domains.length) }, worker));

  for (const report of reports.sort((a, b) => a.domain.localeCompare(b.domain))) {
    ctx.out('');
    ctx.out(`${report.domain}: ${report.outcome}${report.error ? ` — ${report.error}` : ''}`);
    for (const action of report.actions) ctx.out(`  - ${action}`);
    for (const c of report.conflicts)
      ctx.out(
        `  ! conflict: wants ${c.want.type} ${c.want.name || '@'} → ${c.want.value}; ${c.reason}`,
      );
  }
  const count = (o: string) => reports.filter((r) => r.outcome === o).length;
  ctx.out('');
  ctx.out(
    `${reports.length} domain(s): ${count('live')} live, ${count('waiting')} waiting on SES, ${count('planned')} planned, ${count('failed')} failed, ${count('busy')} busy.`,
  );
  return count('failed') ? 1 : 0;
}

const failed = (domain: string, error: string): OnboardingReport => ({
  domain,
  outcome: 'failed',
  actions: [],
  conflicts: [],
  error,
});

async function townFor(db: Db, domain: string) {
  const [town] = await db
    .select({ id: towns.id, siteName: towns.siteName })
    .from(towns)
    .where(or(eq(towns.domain, domain), sql`${domain} = any(${towns.extraDomains})`));
  return town ?? null;
}

async function printStatus(ctx: CommandContext, domain?: string) {
  const rows = await ctx.db
    .select()
    .from(mailDomains)
    .where(domain ? eq(mailDomains.name, domain.toLowerCase()) : undefined)
    .orderBy(mailDomains.name);
  if (!rows.length) {
    ctx.out(domain ? `${domain} has not been onboarded.` : 'No mail domains yet.');
    return;
  }
  for (const row of rows) {
    const steps = await ctx.db
      .select()
      .from(onboardingSteps)
      .where(eq(onboardingSteps.domainId, row.id));
    const byStep = new Map(steps.map((s) => [s.step, s]));
    const progress = STEPS.map((s) => `${s}:${byStep.get(s)?.status ?? 'pending'}`).join(' ');
    ctx.out(
      `${row.name}${row.isTest ? ' (test)' : ''}  ${row.status}  inbound:${row.inboundEnabled ? 'on' : 'off'}  bulk:${row.bulkStatus}` +
        (row.bulkStatus === 'warming' ? ` day ${row.warmupDay}, cap ${row.bulkDailyCap}` : ''),
    );
    ctx.out(`  ${progress}`);
    if (row.failureReason) ctx.out(`  failed: ${row.failureReason}`);
  }
}

function realProviders(env: Env): Providers {
  const region = env.AWS_REGION ?? 'us-east-1';
  if (!env.VERCEL_DNS_TOKEN || !env.AWS_ACCESS_KEY_ID) return offlineProviders();
  return {
    dns: vercelDns({ token: env.VERCEL_DNS_TOKEN, teamId: env.VERCEL_TEAM_ID }),
    ses: sesIdentities({ region }),
    offline: false,
  };
}

/** For a dry-run before any credentials exist: every zone empty, no SES identities. */
export function offlineProviders(): Providers {
  const none: ExistingRecord[] = [];
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
      createRecord: async () => {
        throw new Error('offline');
      },
      deleteRecord: async () => {
        throw new Error('offline');
      },
    },
    ses: {
      getIdentity: async () => null,
      createIdentity: async () => {
        throw new Error('offline');
      },
      setMailFrom: async () => {
        throw new Error('offline');
      },
      deleteIdentity: async () => {
        throw new Error('offline');
      },
    },
  };
}
