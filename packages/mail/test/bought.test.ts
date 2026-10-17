import { loadEnv } from '@towncore/config';
import {
  eq,
  launches,
  launchStepRecords,
  mailDomains,
  townCandidates,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boughtDomains,
  needsOnboarding,
  onboardBoughtDomain,
  onboardBy,
  type Providers,
} from '../src/bought';
import { runOnboardCommand } from '../src/cli/onboard';
import { currentConditions } from '../src/ops/alerts';
import { fakeDns, fakeSes } from './fakes';

// Mail warm-up starts the moment we own a domain (owner, 2026-10-17): a domain a launch bought
// is onboarded under the purchase's approval, soonest cohort first, and Mail health alerts when
// one is left behind.

let db: Db;
let drop: () => Promise<void>;
const env = loadEnv({
  // The bought domains are deliberately not test domains: the purchase is the approval.
  MAIL_TEST_DOMAINS: 'alpha.test',
  VERCEL_DNS_TOKEN: 'x',
  AWS_ACCESS_KEY_ID: 'x',
  DMARC_REPORT_ADDRESS: 'dmarc@towncore.net',
  SES_CONFIG_SET_CONVERSATIONAL: 'towncore-dev-conversational',
  SES_CONFIG_SET_BULK: 'towncore-dev-bulk',
});
const NOW = new Date('2026-10-17T15:00:00Z');

async function launchWith(input: {
  name: string;
  domain: string;
  cohort?: string;
  bought: boolean;
  boughtAt?: Date;
}) {
  const [candidate] = await db
    .insert(townCandidates)
    .values({
      state: 'FL',
      geoid: `12${input.name.length}${Math.floor(Math.random() * 1e5)}`,
      name: input.name,
      inputs: {},
      score: 0.5,
      rank: 1,
      rankedAt: NOW,
      status: 'approved',
    })
    .returning();
  const [launch] = await db
    .insert(launches)
    .values({
      candidateId: candidate!.id,
      geoid: candidate!.geoid,
      slug: input.name.toLowerCase().replace(/\W+/g, '-'),
      name: input.name,
      state: 'FL',
      dryRun: !input.bought,
      options: input.cohort ? { cohort: input.cohort } : {},
    })
    .returning();
  await db.insert(launchStepRecords).values({
    launchId: launch!.id,
    step: 'names',
    status: 'done',
    finishedAt: input.boughtAt ?? NOW,
    detail: {
      picked: { domain: input.domain, siteName: `${input.name} Daily`, townFile: 'x.yaml' },
      purchase: input.bought
        ? { orderId: `ord_${input.name}`, status: 'completed', price: 11.25 }
        : { status: 'not bought', reason: 'dry run (no --approve-spend)' },
    },
  });
}

function world(zones: Parameters<typeof fakeDns>[0]) {
  const dns = fakeDns(zones);
  const ses = fakeSes(dns.zones);
  const providers: Providers = { dns: dns.provider, ses: ses.provider, offline: false };
  return { dns, providers };
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await launchWith({
    name: 'Jupiter',
    domain: 'jupiterledger.com',
    cohort: '2027-01',
    bought: true,
  });
  await launchWith({
    name: 'Delray Beach',
    domain: 'delraydaily.com',
    cohort: '2026-12',
    bought: true,
    boughtAt: new Date('2026-10-17T12:00:00Z'),
  });
  await launchWith({ name: 'Tequesta', domain: 'tequestalocal.com', bought: true });
  await launchWith({ name: 'Lantana', domain: 'lantanacourier.com', bought: false });
});
afterAll(async () => drop());

describe('bought domains', () => {
  it('lists only completed purchases, soonest cohort first, with the day onboarding should start', async () => {
    const all = await boughtDomains(db);
    expect(all.map((d) => [d.domain, d.cohort, d.startBy])).toEqual([
      ['delraydaily.com', '2026-12', '2026-11-10'],
      ['jupiterledger.com', '2027-01', '2026-12-11'],
      ['tequestalocal.com', null, null],
    ]);
    expect(all.every(needsOnboarding)).toBe(true);
    expect(onboardBy('2026-12')).toBe('2026-11-10');
    expect(onboardBy('soon')).toBeNull();
  });

  it('raises a Mail health alert for a bought domain not onboarded within the hour', async () => {
    const conditions = await currentConditions(db, NOW);
    const keys = conditions.map((c) => c.key);
    // Delray was bought three hours before NOW; the others at NOW, still inside the grace period.
    expect(keys).toContain('bought_not_onboarded:delraydaily.com');
    expect(keys).not.toContain('bought_not_onboarded:jupiterledger.com');
    expect(conditions.find((c) => c.key.endsWith('delraydaily.com'))!.message).toMatch(
      /cohort 2026-12 wants it by 2026-11-10.*pnpm mail:onboard bought --execute/,
    );
  });
});

describe('onboarding a bought domain', () => {
  it('needs no --approved and no test-domain listing: the purchase approved it', async () => {
    const { dns, providers } = world({ 'delraydaily.com': [] });
    const report = await onboardBoughtDomain(
      db,
      { domain: 'delraydaily.com', displayName: 'Delray Daily', orderId: 'ord_Delray Beach' },
      { env, providers, execute: true },
    );
    expect(report.outcome).toBe('live');
    expect(dns.zones['delraydaily.com']).toHaveLength(14);
    const [row] = await db
      .select()
      .from(mailDomains)
      .where(eq(mailDomains.name, 'delraydaily.com'));
    expect(row).toMatchObject({
      status: 'live',
      isTest: false,
      bulkStatus: 'warming',
      warmupDay: 1,
      bulkDailyCap: 50,
    });
    // Onboarded domains stop alerting.
    const keys = (await currentConditions(db, NOW)).map((c) => c.key);
    expect(keys).not.toContain('bought_not_onboarded:delraydaily.com');
  });

  it('never overwrites a conflicting record: the domain fails for a person to fix', async () => {
    const google = { id: 'mx1', type: 'MX', name: '', value: 'smtp.google.com', priority: 1 };
    const { dns, providers } = world({ 'jupiterledger.com': [google] });
    const report = await onboardBoughtDomain(
      db,
      { domain: 'jupiterledger.com', displayName: 'Jupiter Ledger', orderId: 'ord_Jupiter' },
      { env, providers, execute: true },
    );
    expect(report.outcome).toBe('failed');
    expect('conflicts' in report && report.conflicts.length).toBeGreaterThan(0);
    expect(dns.zones['jupiterledger.com']).toEqual([google]);
  });

  it('records what is missing instead of failing when the credentials are not set', async () => {
    const report = await onboardBoughtDomain(
      db,
      { domain: 'tequestalocal.com', displayName: 'Tequesta Local', orderId: 'ord_Tequesta' },
      { env: loadEnv({}), providers: world({}).providers, execute: true },
    );
    expect(report).toMatchObject({ outcome: 'not started' });
    expect('reason' in report && report.reason).toMatch(
      /DMARC_REPORT_ADDRESS.*pnpm mail:onboard bought --execute/,
    );
  });
});

describe('pnpm mail:onboard bought', () => {
  it('plans by default and onboards the ones left, soonest cohort first, with --execute', async () => {
    const { providers } = world({ 'jupiterledger.com': [], 'tequestalocal.com': [] });
    const run = async (argv: string[]) => {
      const lines: string[] = [];
      const code = await runOnboardCommand(argv, {
        db,
        env,
        out: (l) => lines.push(l),
        providers: () => providers,
      });
      return { code, text: lines.join('\n') };
    };
    const dry = await run(['bought']);
    expect(dry.code).toBe(0);
    expect(dry.text).toMatch(/delraydaily\.com: live, bulk warming \(day 1, cap 50\)/);
    expect(dry.text).toMatch(/Dry-run: 2 bought domain\(s\) to onboard/);
    expect(dry.text.indexOf('jupiterledger.com [cohort 2027-01]')).toBeLessThan(
      dry.text.indexOf('tequestalocal.com'),
    );

    const done = await run(['bought', '--execute']);
    expect(done.code).toBe(0);
    // Jupiter's earlier conflict is gone from this zone, so the retry picks up and goes live.
    expect(done.text).toMatch(/jupiterledger\.com \[cohort 2027-01\]: live/);
    expect(done.text).toMatch(/tequestalocal\.com: live/);
    expect((await boughtDomains(db)).some(needsOnboarding)).toBe(false);
    expect((await run(['bought'])).text).toMatch(/Every bought domain is onboarded/);
  });
});
