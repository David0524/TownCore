import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/memory-store';
import { onboardDomain, resetFailedSteps, type OnboardingDeps } from '../src/onboarding';
import { fakeDns, fakeSes } from './fakes';

const DOMAIN = 'testtown.com';
const spec = { name: DOMAIN, displayName: 'Test Town Times', isTest: true };

function setup(existing: Parameters<typeof fakeDns>[0][string] = []) {
  const dns = fakeDns({ [DOMAIN]: existing });
  const ses = fakeSes(dns.zones);
  const store = memoryStore();
  const deps: OnboardingDeps = {
    store,
    dns: dns.provider,
    ses: ses.provider,
    region: 'us-east-1',
    dmarcReportAddress: 'dmarc@towncore.net',
    configSets: { conversational: 'towncore-dev-conversational', bulk: 'towncore-dev-bulk' },
  };
  return { dns, ses, store, deps };
}

const domainRow = (store: ReturnType<typeof memoryStore>) => store.state.domains.get(DOMAIN)!;

describe('onboardDomain', () => {
  it('onboards end to end: identities, records, verification, then live and warming', async () => {
    const { dns, ses, store, deps } = setup();
    const first = await onboardDomain(spec, deps, { execute: true });
    // The fake SES sees the records it needs on the next check, like real DNS propagation.
    expect(first.outcome).toBe('live');
    expect(ses.identities.get(DOMAIN)?.configurationSetName).toBe('towncore-dev-conversational');
    expect(ses.identities.get(`news.${DOMAIN}`)?.configurationSetName).toBe('towncore-dev-bulk');
    expect(ses.identities.get(DOMAIN)?.mailFromDomain).toBe(`mail.${DOMAIN}`);
    expect(ses.identities.get(`news.${DOMAIN}`)?.mailFromDomain).toBe(`bounce.news.${DOMAIN}`);
    expect(dns.zones[DOMAIN]).toHaveLength(14);
    expect(domainRow(store)).toMatchObject({
      status: 'live',
      inboundEnabled: true,
      bulkStatus: 'warming',
      warmupDay: 1,
      bulkDailyCap: 50,
    });
  });

  it('a second run is a no-op', async () => {
    const { dns, ses, deps } = setup();
    await onboardDomain(spec, deps, { execute: true });
    const before = { creates: dns.calls.creates, ses: { ...ses.calls } };
    const again = await onboardDomain(spec, deps, { execute: true });
    expect(again).toMatchObject({ outcome: 'live', actions: [] });
    expect(dns.calls.creates).toBe(before.creates);
    expect(ses.calls).toEqual(before.ses);
  });

  it('waits while SES hasn’t verified, and finishes on a later run', async () => {
    const { dns, ses, store, deps } = setup();
    ses.holdVerification(true);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('waiting');
    expect(domainRow(store).status).toBe('onboarding');
    const writes = dns.calls.creates;

    ses.holdVerification(false);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('live');
    expect(dns.calls.creates).toBe(writes);
  });

  it('dry-run reports every write and makes none', async () => {
    const { dns, ses, deps } = setup();
    const report = await onboardDomain(spec, deps, { execute: false });
    expect(report.outcome).toBe('planned');
    expect(report.actions[0]).toMatch(/^would create SES identity testtown\.com/);
    expect(ses.calls).toEqual({ creates: 0, mailFrom: 0 });
    expect(dns.calls.creates).toBe(0);
  });

  it('stops on a DNS conflict before touching SES, and changes nothing', async () => {
    const { dns, ses, store, deps } = setup([
      { id: 'g', type: 'MX', name: '', value: 'aspmx.l.google.com', priority: 1 },
    ]);
    const report = await onboardDomain(spec, deps, { execute: true });
    expect(report.outcome).toBe('failed');
    expect(report.error).toMatch(/DNS conflict.*aspmx\.l\.google\.com/);
    expect(report.conflicts).toHaveLength(1);
    expect(ses.calls.creates).toBe(0);
    expect(dns.calls.creates).toBe(0);
    expect(domainRow(store)).toMatchObject({ status: 'failed' });
    expect(domainRow(store).failureReason).toMatch(/^check_conflicts: DNS conflict/);

    // Stays failed until someone resolves it and retries.
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('failed');
    dns.zones[DOMAIN] = [];
    await resetFailedSteps(store, DOMAIN);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('live');
  });

  it('resumes after a crash mid-way without duplicating anything', async () => {
    const { dns, ses, store, deps } = setup();
    dns.failOnCreateNumber(5);
    const crashed = await onboardDomain(spec, deps, { execute: true });
    expect(crashed).toMatchObject({ outcome: 'failed', error: 'connection reset' });
    expect(dns.zones[DOMAIN]).toHaveLength(4);

    dns.failOnCreateNumber(null);
    await resetFailedSteps(store, DOMAIN);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('live');
    expect(dns.zones[DOMAIN]).toHaveLength(14);
    expect(ses.calls.creates).toBe(2);
    // Steps that had finished were not run again.
    const steps = store.state.steps.get(domainRow(store).id)!;
    expect(steps.root_identity?.attempts).toBe(1);
    expect(steps.write_dns?.attempts).toBe(2);
  });

  it('refuses a domain not on Vercel DNS', async () => {
    const { deps } = setup();
    deps.dns = fakeDns(
      { [DOMAIN]: [] },
      { serviceType: 'external', nameservers: ['ns1.godaddy.com'] },
    ).provider;
    const report = await onboardDomain(spec, deps, { execute: true });
    expect(report).toMatchObject({ outcome: 'failed' });
    expect(report.error).toMatch(/doesn't use Vercel nameservers/);
    const missing = await onboardDomain({ ...spec, name: 'unknown.com' }, deps, { execute: true });
    expect(missing.error).toMatch(/not in the Vercel team/);
  });

  it('fails the domain when SES gives up on DKIM', async () => {
    const { ses, deps } = setup();
    ses.failDkim();
    const report = await onboardDomain(spec, deps, { execute: true });
    expect(report.outcome).toBe('failed');
    expect(report.error).toMatch(/SES verification failed/);
  });

  it('never runs two onboardings of one domain at once', async () => {
    const { store, deps } = setup();
    const domain = await store.ensureDomain(spec);
    await store.acquireLease(domain.id, 60_000);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('busy');
  });
});
