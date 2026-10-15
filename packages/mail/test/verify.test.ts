import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/memory-store';
import { onboardDomain, type OnboardingDeps } from '../src/onboarding';
import { checkVerification } from '../src/verify';
import { fakeDns, fakeSes } from './fakes';

const DOMAIN = 'testtown.com';
const spec = { name: DOMAIN, displayName: 'T', isTest: true };

function setup() {
  const dns = fakeDns({ [DOMAIN]: [] });
  const ses = fakeSes(dns.zones);
  const store = memoryStore();
  const deps: OnboardingDeps = {
    store,
    dns: dns.provider,
    ses: ses.provider,
    region: 'us-east-1',
    dmarcReportAddress: 'd@towncore.net',
    configSets: { conversational: 'c', bulk: 'b' },
  };
  return { ses, store, deps };
}

describe('checkVerification', () => {
  it('takes a waiting domain live once SES verifies', async () => {
    const { ses, store, deps } = setup();
    ses.holdVerification(true);
    expect((await onboardDomain(spec, deps, { execute: true })).outcome).toBe('waiting');
    expect(await checkVerification(DOMAIN, { store, ses: ses.provider })).toEqual({
      outcome: 'waiting',
    });

    ses.holdVerification(false);
    expect(await checkVerification(DOMAIN, { store, ses: ses.provider })).toEqual({
      outcome: 'live',
    });
    expect(store.state.domains.get(DOMAIN)).toMatchObject({
      status: 'live',
      bulkStatus: 'warming',
      bulkDailyCap: 50,
    });
    // A later re-check only refreshes the stored status.
    expect(await checkVerification(DOMAIN, { store, ses: ses.provider })).toEqual({
      outcome: 'refreshed',
    });
  });

  it('fails the domain when SES gives up', async () => {
    const { ses, store, deps } = setup();
    ses.holdVerification(true);
    await onboardDomain(spec, deps, { execute: true });
    ses.failDkim();
    const result = await checkVerification(DOMAIN, { store, ses: ses.provider });
    expect(result.outcome).toBe('failed');
    expect(store.state.domains.get(DOMAIN)?.failureReason).toMatch(
      /^verify: SES verification failed/,
    );
  });

  it('never writes DNS or identities, and leaves unfinished onboarding to the CLI', async () => {
    const { ses, store } = setup();
    await store.ensureDomain(spec);
    await store.updateDomain([...store.state.domains.values()][0]!.id, { status: 'onboarding' });
    expect(await checkVerification(DOMAIN, { store, ses: ses.provider })).toMatchObject({
      outcome: 'skipped',
    });
    expect(ses.calls).toEqual({ creates: 0, mailFrom: 0 });
    expect(await checkVerification('unknown.com', { store, ses: ses.provider })).toMatchObject({
      outcome: 'skipped',
    });
  });
});
