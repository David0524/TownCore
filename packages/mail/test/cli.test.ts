import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '@towncore/config';
import { dnsRecords, domainIdentities, eq, mailDomains, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAllowed, GuardError, runOnboardCommand, type Providers } from '../src/cli/onboard';
import { onboardDomain } from '../src/onboarding';
import { pgOnboardingStore } from '../src/pg-store';
import { fakeDns, fakeSes } from './fakes';

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

const rawEnv = {
  MAIL_TEST_DOMAINS: 'alpha.test, beta.test',
  VERCEL_DNS_TOKEN: 'x',
  AWS_ACCESS_KEY_ID: 'x',
  DMARC_REPORT_ADDRESS: 'dmarc@towncore.net',
  SES_CONFIG_SET_CONVERSATIONAL: 'towncore-dev-conversational',
  SES_CONFIG_SET_BULK: 'towncore-dev-bulk',
};
const env = loadEnv(rawEnv);

function world(domains: string[]) {
  const dns = fakeDns(Object.fromEntries(domains.map((d) => [d, []])));
  const ses = fakeSes(dns.zones);
  const providers = (): Providers => ({ dns: dns.provider, ses: ses.provider, offline: false });
  return { dns, ses, providers };
}

async function run(argv: string[], providers?: () => Providers) {
  const lines: string[] = [];
  const code = await runOnboardCommand(argv, { db, env, out: (l) => lines.push(l), providers });
  return { code, text: lines.join('\n') };
}

describe('checkAllowed', () => {
  const testDomains = ['alpha.test'];
  it('allows dry-runs anywhere and execution on test domains', () => {
    expect(() =>
      checkAllowed(['boca.com'], { execute: false, approved: false, testDomains }),
    ).not.toThrow();
    expect(() =>
      checkAllowed(['alpha.test'], { execute: true, approved: false, testDomains }),
    ).not.toThrow();
  });
  it('needs --approved for any other domain', () => {
    expect(() =>
      checkAllowed(['alpha.test', 'boca.com'], { execute: true, approved: false, testDomains }),
    ).toThrow(GuardError);
    expect(() =>
      checkAllowed(['boca.com'], { execute: true, approved: true, testDomains }),
    ).not.toThrow();
  });
});

describe('mail:onboard', () => {
  it('dry-run is the default and writes nothing anywhere', async () => {
    const w = world(['alpha.test']);
    const { code, text } = await run(
      ['add', 'alpha.test', '--display-name', 'Alpha Times'],
      w.providers,
    );
    expect(code).toBe(0);
    expect(text).toContain('Dry-run: nothing will be changed');
    expect(text).toContain('would create SES identity alpha.test');
    expect(w.dns.calls.creates + w.ses.calls.creates).toBe(0);
    expect(await db.select().from(mailDomains)).toEqual([]);
  });

  it('refuses to execute on a non-test domain without --approved', async () => {
    const w = world(['realtown.com']);
    const { code, text } = await run(
      ['add', 'realtown.com', '--display-name', 'R', '--execute'],
      w.providers,
    );
    expect(code).toBe(3);
    expect(text).toMatch(/Refusing to change realtown\.com/);
    expect(w.dns.calls.creates).toBe(0);
  });

  it('onboards test domains from a file, records everything, and a second run is a no-op', async () => {
    const w = world(['alpha.test', 'beta.test']);
    const dir = mkdtempSync(join(tmpdir(), 'onboard-'));
    writeFileSync(join(dir, 'domains.txt'), 'alpha.test\n# comment\nBETA.test\n');
    const first = await run(
      ['add', '--from-file', join(dir, 'domains.txt'), '--display-name', 'Test', '--execute'],
      w.providers,
    );
    expect(first.code).toBe(0);
    expect(first.text).toContain('2 domain(s): 2 live');

    const [alpha] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'alpha.test'));
    expect(alpha).toMatchObject({
      status: 'live',
      isTest: true,
      inboundEnabled: true,
      bulkStatus: 'warming',
      bulkDailyCap: 50,
      leaseUntil: null,
    });
    expect(
      await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, alpha!.id)),
    ).toHaveLength(14);
    expect(
      await db.select().from(domainIdentities).where(eq(domainIdentities.domainId, alpha!.id)),
    ).toHaveLength(2);

    const writes = w.dns.calls.creates;
    const again = await run(
      ['add', 'alpha.test', 'beta.test', '--display-name', 'Test', '--execute'],
      w.providers,
    );
    expect(again.text).toContain('2 domain(s): 2 live');
    expect(w.dns.calls.creates).toBe(writes);

    const status = await run(['status', 'alpha.test']);
    expect(status.text).toContain(
      'alpha.test (test)  live  inbound:on  bulk:warming day 1, cap 50',
    );
    expect(status.text).toContain('activate:done');
  });

  it('uses the town’s site name for town domains', async () => {
    await db.insert(towns).values({
      slug: 'gamma',
      name: 'Gamma',
      state: 'FL',
      county: 'X',
      timezone: 'America/New_York',
      domain: 'gamma.test',
      siteName: 'Gamma Ledger',
      tier: 'small',
      config: {},
    });
    const w = world(['gamma.test']);
    const { text } = await run(['add', 'gamma.test', '--execute', '--approved'], w.providers);
    expect(text).toContain('gamma.test: live');
    const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'gamma.test'));
    expect(row).toMatchObject({ displayName: 'Gamma Ledger', isTest: false });
    expect(row!.townId).not.toBeNull();
  });

  it('a conflict fails the domain; retry resumes after it is fixed', async () => {
    const w = world(['beta2.test']);
    w.dns.zones['beta2.test']!.push({
      id: 'g',
      type: 'MX',
      name: '',
      value: 'aspmx.l.google.com',
      priority: 1,
    });
    const envWithBeta2 = { ...env, MAIL_TEST_DOMAINS: ['beta2.test'] };
    const out: string[] = [];
    const ctx = { db, env: envWithBeta2, out: (l: string) => out.push(l), providers: w.providers };
    expect(
      await runOnboardCommand(['add', 'beta2.test', '--display-name', 'B', '--execute'], ctx),
    ).toBe(1);
    expect(out.join('\n')).toContain(
      '! conflict: wants MX @ → inbound-smtp.us-east-1.amazonaws.com',
    );
    expect(w.ses.calls.creates).toBe(0);

    w.dns.zones['beta2.test'] = [];
    expect(await runOnboardCommand(['retry', 'beta2.test', '--execute'], ctx)).toBe(0);
    const [row] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'beta2.test'));
    expect(row).toMatchObject({ status: 'live', failureReason: null });
  });

  it('verify-all finishes domains that were waiting on SES', async () => {
    const w = world(['delta.test']);
    w.ses.holdVerification(true);
    const envDelta = { ...env, MAIL_TEST_DOMAINS: ['delta.test'] };
    const ctx = { db, env: envDelta, out: () => {}, providers: w.providers };
    await runOnboardCommand(['add', 'delta.test', '--display-name', 'D', '--execute'], ctx);
    const [waiting] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'delta.test'));
    expect(waiting!.status).toBe('onboarding');

    w.ses.holdVerification(false);
    await runOnboardCommand(['verify-all', '--execute'], ctx);
    const [done] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'delta.test'));
    expect(done!.status).toBe('live');
  });
});

describe('pgOnboardingStore', () => {
  it('lets only one run hold a domain at a time', async () => {
    const w = world(['epsilon.test']);
    const store = pgOnboardingStore(db);
    const deps = {
      store,
      dns: w.dns.provider,
      ses: w.ses.provider,
      region: 'us-east-1',
      dmarcReportAddress: 'd@towncore.net',
      configSets: { conversational: 'c', bulk: 'b' },
    };
    const spec = { name: 'epsilon.test', displayName: 'E', isTest: true };
    const results = await Promise.all([
      onboardDomain(spec, deps, { execute: true }),
      onboardDomain(spec, deps, { execute: true }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['busy', 'live']);
    expect(w.ses.calls.creates).toBe(2);
  });

  it('remove deletes only what we created, behind the same guard', async () => {
    const w = world(['gone.test']);
    // A record the owner had before onboarding: never touched.
    w.dns.zones['gone.test']!.push({
      id: 'owner_1',
      type: 'TXT',
      name: 'google',
      value: 'site-verification',
      priority: null,
    });
    const testEnv = loadEnv({ ...rawEnv, MAIL_TEST_DOMAINS: 'gone.test' });
    const lines: string[] = [];
    const runRemove = (argv: string[], e = testEnv) =>
      runOnboardCommand(argv, { db, env: e, out: (l) => lines.push(l), providers: w.providers });
    const added = await runRemove(['add', 'gone.test', '--display-name', 'Gone', '--execute']);
    expect(added, lines.join('\n')).toBe(0);
    const created = await db.select().from(dnsRecords).where(eq(dnsRecords.status, 'created'));
    expect(created.length).toBeGreaterThan(0);
    expect(w.ses.identities.size).toBe(2);

    lines.length = 0;
    expect(await runRemove(['remove', 'gone.test'])).toBe(0);
    expect(lines.join('\n')).toMatch(
      /would delete \d+ DNS record\(s\) we created and 2 SES identities[\s\S]*Dry run: nothing changed/,
    );
    expect(w.ses.identities.size).toBe(2);

    // Outside the test list, --execute needs --approved.
    expect(await runRemove(['remove', 'gone.test', '--execute'], loadEnv(rawEnv))).toBe(3);
    expect(w.ses.identities.size).toBe(2);

    expect(await runRemove(['remove', 'gone.test', '--execute'])).toBe(0);
    expect(w.ses.identities.size).toBe(0);
    expect(w.dns.zones['gone.test']!.map((r) => r.id)).toEqual(['owner_1']);
    const [d] = await db.select().from(mailDomains).where(eq(mailDomains.name, 'gone.test'));
    expect(d).toMatchObject({
      status: 'removed',
      inboundEnabled: false,
      bulkStatus: 'paused',
      newsletterMode: 'off',
    });
    expect(
      await db.select().from(domainIdentities).where(eq(domainIdentities.domainId, d!.id)),
    ).toEqual([]);
    // Running it again is harmless.
    expect(await runRemove(['remove', 'gone.test', '--execute'])).toBe(0);
  });
});
