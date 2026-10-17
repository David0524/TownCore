import { loadEnv } from '@towncore/config';
import { eq, mailDomains, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type { Providers } from '@towncore/mail';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeDns, fakeSes } from '../../mail/test/fakes';
import { mailStep, mailTodos } from '../src/mail-step';
import type { NamesDetail } from '../src/names-step';
import { mailCheck } from '../src/report-step';

// Launch step 2b (owner, 2026-10-17): warm-up starts the moment we own the domain. The purchase
// approval covers onboarding; nothing here stops the launch.

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

const env = loadEnv({
  VERCEL_DNS_TOKEN: 'x',
  AWS_ACCESS_KEY_ID: 'x',
  DMARC_REPORT_ADDRESS: 'dmarc@towncore.net',
  SES_CONFIG_SET_CONVERSATIONAL: 'towncore-dev-conversational',
  SES_CONFIG_SET_BULK: 'towncore-dev-bulk',
});

const names = (domain: string, bought: boolean): NamesDetail => ({
  proposals: [],
  neighbors: [],
  manual: [],
  outlets: [],
  picked: { siteName: 'Delray Daily', domain, townFile: 'x.yaml' },
  purchase: bought
    ? { orderId: 'ord_123', status: 'completed', price: 11.25 }
    : { status: 'not bought', reason: 'dry run (no --approve-spend)' },
});

function world(zones: Parameters<typeof fakeDns>[0]) {
  const dns = fakeDns(zones);
  const ses = fakeSes(dns.zones);
  const providers: Providers = { dns: dns.provider, ses: ses.provider, offline: false };
  return { dns, providers };
}

describe('launch step 2b: mail domain and warm-up', () => {
  it('plans onboarding in a dry run and writes nothing', async () => {
    const { dns, providers } = world({ 'delraydaily.com': [] });
    const { detail } = await mailStep({
      db,
      deps: { env, providers },
      names: names('delraydaily.com', false),
      cohort: '2026-12',
    });
    expect(detail).toMatchObject({
      state: 'planned',
      approvedBy: null,
      cohort: '2026-12',
      startBy: '2026-11-10',
    });
    expect(detail.actions.length).toBeGreaterThan(0);
    expect(detail.ramp.slice(0, 3)).toEqual([
      { day: 1, cap: 50 },
      { day: 4, cap: 100 },
      { day: 7, cap: 200 },
    ]);
    expect(dns.zones['delraydaily.com']).toEqual([]);
    expect(await db.select().from(mailDomains)).toHaveLength(0);
    expect(mailCheck(detail, null).status).toBe('pass');
  });

  it('onboards right after the purchase under that approval, and warm-up starts at 50 a day', async () => {
    const { dns, providers } = world({ 'delraydaily.com': [] });
    const { detail } = await mailStep({
      db,
      deps: { env, providers },
      names: names('delraydaily.com', true),
    });
    expect(detail).toMatchObject({ state: 'live', approvedBy: 'domain order ord_123' });
    expect(dns.zones['delraydaily.com']).toHaveLength(14);
    const [row] = await db
      .select()
      .from(mailDomains)
      .where(eq(mailDomains.name, 'delraydaily.com'));
    expect(row).toMatchObject({ status: 'live', bulkStatus: 'warming', bulkDailyCap: 50 });
    expect(
      mailCheck(detail, { status: 'live', bulkStatus: 'warming', warmupDay: 1, bulkDailyCap: 50 }),
    ).toMatchObject({ status: 'pass', detail: 'Live; bulk warming, day 1 at 50 a day.' });
    expect(mailTodos(detail)).toEqual([]);
  });

  it('turns a DNS conflict into a launch to-do without overwriting it', async () => {
    const google = { id: 'mx1', type: 'MX', name: '', value: 'smtp.google.com', priority: 1 };
    const { dns, providers } = world({ 'jupiterledger.com': [google] });
    const { detail } = await mailStep({
      db,
      deps: { env, providers },
      names: names('jupiterledger.com', true),
    });
    expect(detail.state).toBe('failed');
    expect(dns.zones['jupiterledger.com']).toEqual([google]);
    expect(mailCheck(detail, null).status).toBe('fail');
    expect(mailTodos(detail)[0]).toMatch(
      /Mail DNS conflict on jupiterledger\.com: wants MX @.*pnpm mail:onboard bought --execute/,
    );
  });

  it('records a to-do when the mail credentials are missing, and never stops the launch', async () => {
    const { providers } = world({});
    const { detail } = await mailStep({
      db,
      deps: { env: loadEnv({}), providers },
      names: names('tequestalocal.com', true),
    });
    expect(detail.state).toBe('not started');
    expect(mailTodos(detail)[0]).toMatch(/Start mail onboarding for tequestalocal\.com: needs/);
    const none = await mailStep({ db, names: names('tequestalocal.com', false) });
    expect(none.detail).toMatchObject({
      state: 'planned',
      detail: 'Starts when the domain is bought.',
    });
  });
});
