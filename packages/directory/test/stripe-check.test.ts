import { readFileSync } from 'node:fs';
import { towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPricePlan, checkStripeSetup, HANDLED_EVENTS, planPrices, webhookUrl } from '../src';

// `pnpm directory:stripe check` (owner, 2026-10-17: "install Stripe on the site") against a fake
// Stripe client: no network, read-only, and no secret ever in its output.

const KEY = 'sk_test_51abcdefSECRETVALUE';
const WEBHOOK_SECRET = 'whsec_SECRETVALUE';
const APP = 'https://admin.towncore.test';

type Fake = {
  endpoints: Array<{ url: string; status: string; enabled_events: string[] }>;
  portal: Array<{
    features: {
      subscription_cancel: { enabled: boolean };
      payment_method_update: { enabled: boolean };
    };
  }>;
  /** Lookup keys this account has. */
  prices: string[];
  calls: string[];
};

function fakeStripe(fake: Fake): Stripe {
  let n = 0;
  return {
    accounts: {
      retrieveCurrent: async () => {
        fake.calls.push('account');
        return {
          id: 'acct_test_1',
          settings: { dashboard: { display_name: 'TownCore test' } },
        };
      },
    },
    webhookEndpoints: {
      list: async () => {
        fake.calls.push('webhooks');
        return { data: fake.endpoints };
      },
    },
    billingPortal: {
      configurations: {
        list: async (params: Record<string, unknown>) => {
          fake.calls.push(`portal:${JSON.stringify(params)}`);
          return { data: fake.portal };
        },
      },
    },
    prices: {
      list: async (params: { lookup_keys: string[] }) => {
        fake.calls.push(`prices:${params.lookup_keys.length}`);
        return {
          data: params.lookup_keys
            .filter((k) => fake.prices.includes(k))
            .map((k) => ({ lookup_key: k })),
        };
      },
      create: async () => {
        n++;
        return { id: `price_${n}`, product: `prod_${n}`, livemode: false };
      },
    },
  } as unknown as Stripe;
}

const allGood = (): Fake => ({
  endpoints: [
    { url: 'https://elsewhere.test/hook', status: 'enabled', enabled_events: ['*'] },
    { url: `${APP}/api/stripe/webhook`, status: 'enabled', enabled_events: [...HANDLED_EVENTS] },
  ],
  portal: [
    {
      features: {
        subscription_cancel: { enabled: true },
        payment_method_update: { enabled: true },
      },
    },
  ],
  prices: [],
  calls: [],
});

describe('pnpm directory:stripe check', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await db.insert(towns).values({
      slug: 'checktown',
      name: 'Checktown',
      state: 'FL',
      county: 'X',
      timezone: 'America/New_York',
      domain: 'checktown.test',
      siteName: 'The Checktown Post',
      tier: 'small',
      config: {},
    });
  });
  afterAll(async () => drop());

  const run = (fake: Fake, over: Partial<Parameters<typeof checkStripeSetup>[0]> = {}) =>
    checkStripeSetup({
      db,
      stripe: fakeStripe(fake),
      secretKey: KEY,
      webhookSecret: WEBHOOK_SECRET,
      appBaseUrl: APP,
      ...over,
    });

  it('refuses a missing or live key before calling Stripe', async () => {
    const fake = allGood();
    expect(await run(fake, { secretKey: undefined })).toEqual([
      expect.objectContaining({ ok: false, label: 'STRIPE_SECRET_KEY is set' }),
    ]);
    const live = await run(fake, { secretKey: 'sk_live_abc', stripe: null });
    expect(live).toEqual([expect.objectContaining({ ok: false, label: 'Test-mode key' })]);
    expect(live[0]!.detail).toContain('D-M6-5');
    expect(fake.calls).toEqual([]);
  });

  it('reports what is missing: prices not synced, then every check passes once they are', async () => {
    const fake = allGood();
    const before = await run(fake);
    expect(before.filter((i) => !i.ok).map((i) => i.label)).toEqual([
      'Products and Prices (4 monthly prices)',
    ]);
    expect(before.at(-1)!.detail).toContain('4 price(s) to create');
    expect(before.map((i) => i.label)).toContain('Stripe account: TownCore test (acct_test_1)');

    // Sync creates them; the check then finds them by lookup key in this account.
    await applyPricePlan(db, fakeStripe(fake), await planPrices(db));
    fake.prices = (await planPrices(db)).map((p) => p.lookupKey);
    const after = await run(fake);
    expect(after.every((i) => i.ok)).toBe(true);
    expect(fake.calls).toContain('portal:{"is_default":true,"active":true,"limit":1}');

    // A reset test account no longer has them.
    fake.prices = [];
    expect((await run(fake)).at(-1)).toMatchObject({ ok: false });
  });

  it('checks the webhook endpoint, its events, the secret and the portal', async () => {
    const fake = allGood();
    fake.prices = (await planPrices(db)).map((p) => p.lookupKey);
    fake.endpoints[1] = {
      url: `${APP}/api/stripe/webhook`,
      status: 'disabled',
      enabled_events: ['checkout.session.completed'],
    };
    fake.portal[0]!.features.subscription_cancel.enabled = false;
    const items = await run(fake, { webhookSecret: undefined });
    const failed = Object.fromEntries(items.filter((i) => !i.ok).map((i) => [i.label, i.detail]));
    expect(Object.keys(failed)).toEqual([
      `Webhook endpoint for ${webhookUrl(APP)}`,
      'STRIPE_WEBHOOK_SECRET is set',
      'Customer Portal',
    ]);
    expect(failed[`Webhook endpoint for ${webhookUrl(APP)}`]).toContain('it is disabled');
    expect(failed[`Webhook endpoint for ${webhookUrl(APP)}`]).toContain(
      'customer.subscription.deleted',
    );
    expect(failed['Customer Portal']).toContain('subscription cancel');

    fake.endpoints = [];
    const none = await run(fake);
    expect(none.find((i) => i.label.startsWith('Webhook'))!.detail).toContain(
      HANDLED_EVENTS.join(', '),
    );
    fake.portal = [];
    expect((await run(fake)).find((i) => i.label === 'Customer Portal')).toMatchObject({
      ok: false,
    });
  });

  it('never prints a secret, even from a Stripe error', async () => {
    const fake = allGood();
    const stripe = fakeStripe(fake);
    (stripe.accounts as unknown as { retrieveCurrent: () => Promise<never> }).retrieveCurrent =
      async () => {
        throw new Error(`Invalid API Key provided: ${KEY}`);
      };
    const items = await checkStripeSetup({
      db,
      stripe,
      secretKey: KEY,
      webhookSecret: WEBHOOK_SECRET,
      appBaseUrl: APP,
    });
    const text = JSON.stringify(items);
    expect(text).not.toContain('SECRETVALUE');
    expect(items.find((i) => i.label === 'Stripe account')).toMatchObject({ ok: false });
  });

  it('names every event the webhook handles in the runbook', () => {
    const runbook = readFileSync(
      new URL('../../../docs/directory/RUNBOOK.md', import.meta.url),
      'utf8',
    );
    for (const event of HANDLED_EVENTS) expect(runbook, event).toContain(`\`${event}\``);
    expect(runbook).toContain('pnpm directory:stripe check');
  });
});
