import type { Db } from '@towncore/db';
import type Stripe from 'stripe';
import { isLiveKey } from './client';
import { planPrices } from './prices';
import { HANDLED_EVENTS } from './webhook';

// `pnpm directory:stripe check` (owner, 2026-10-17: "install Stripe on the site"): a read-only
// checklist of everything the directory needs from a Stripe account in test mode. It never
// creates or changes anything in Stripe and never prints a secret, only whether one is set.

/** Where Stripe sends events: the admin host (APP_BASE_URL), never a town site. */
export const WEBHOOK_PATH = '/api/stripe/webhook';

export type CheckItem = { ok: boolean; label: string; detail?: string };

/** Stripe error messages can quote a masked key; nothing that looks like one is printed. */
const redact = (text: string) => text.replace(/\b(sk|rk|whsec|pk)_[A-Za-z0-9_*]+/g, '[redacted]');
const failure = (error: unknown) => redact(error instanceof Error ? error.message : String(error));

/** The webhook endpoint URL for an APP_BASE_URL. */
export const webhookUrl = (appBaseUrl: string) =>
  `${appBaseUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

export async function checkStripeSetup(input: {
  /** The database, to compare Products and Prices with what `sync` would create. */
  db: Db | null;
  /** A client for the key (null when the key is missing or live). */
  stripe: Stripe | null;
  secretKey: string | undefined;
  webhookSecret: string | undefined;
  appBaseUrl: string | undefined;
}): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const { stripe } = input;
  if (!input.secretKey) {
    items.push({ ok: false, label: 'STRIPE_SECRET_KEY is set', detail: 'Add a test-mode key.' });
    return items;
  }
  if (isLiveKey(input.secretKey)) {
    items.push({
      ok: false,
      label: 'Test-mode key',
      detail: 'A live key is refused until the owner approves live payments (D-M6-5).',
    });
    return items;
  }
  if (!/^(sk|rk)_test_/.test(input.secretKey) || !stripe) {
    items.push({
      ok: false,
      label: 'Test-mode key',
      detail: 'STRIPE_SECRET_KEY should start with sk_test_ (or rk_test_ for a restricted key).',
    });
    return items;
  }
  items.push({ ok: true, label: 'Test-mode key' });

  try {
    const account = await stripe.accounts.retrieveCurrent();
    const name =
      account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? 'no name set';
    items.push({ ok: true, label: `Stripe account: ${name} (${account.id})` });
  } catch (error) {
    items.push({ ok: false, label: 'Stripe account', detail: failure(error) });
  }

  if (!input.appBaseUrl) {
    items.push({
      ok: false,
      label: 'Webhook endpoint',
      detail: `APP_BASE_URL isn't set, so the endpoint (${WEBHOOK_PATH} on the admin host) can't be checked.`,
    });
  } else {
    const url = webhookUrl(input.appBaseUrl);
    try {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      const endpoint = endpoints.data.find((e) => e.url === url);
      if (!endpoint) {
        items.push({
          ok: false,
          label: `Webhook endpoint for ${url}`,
          detail: `None found. Add one in Developers → Webhooks for these events: ${HANDLED_EVENTS.join(', ')}.`,
        });
      } else {
        const missing = endpoint.enabled_events.includes('*')
          ? []
          : HANDLED_EVENTS.filter((e) => !endpoint.enabled_events.includes(e));
        const problems = [
          endpoint.status !== 'enabled' ? `it is ${endpoint.status}` : null,
          missing.length ? `it doesn't send ${missing.join(', ')}` : null,
        ].filter(Boolean);
        items.push({
          ok: problems.length === 0,
          label: `Webhook endpoint for ${url}`,
          ...(problems.length
            ? { detail: `Fix it in Developers → Webhooks: ${problems.join('; ')}.` }
            : {}),
        });
      }
    } catch (error) {
      items.push({ ok: false, label: `Webhook endpoint for ${url}`, detail: failure(error) });
    }
  }

  items.push(
    input.webhookSecret
      ? { ok: true, label: 'STRIPE_WEBHOOK_SECRET is set' }
      : {
          ok: false,
          label: 'STRIPE_WEBHOOK_SECRET is set',
          detail: "Copy the endpoint's signing secret (whsec_…) into the environment.",
        },
  );

  try {
    const configs = await stripe.billingPortal.configurations.list({
      is_default: true,
      active: true,
      limit: 1,
    });
    const config = configs.data[0];
    const off = config
      ? [
          config.features.subscription_cancel.enabled ? null : 'subscription cancel',
          config.features.payment_method_update.enabled ? null : 'payment method update',
        ].filter(Boolean)
      : [];
    items.push(
      !config
        ? {
            ok: false,
            label: 'Customer Portal',
            detail:
              'No active default configuration. Save one in Settings → Billing → Customer portal.',
          }
        : off.length
          ? {
              ok: false,
              label: 'Customer Portal',
              detail: `Turn on ${off.join(' and ')} in Settings → Billing → Customer portal.`,
            }
          : { ok: true, label: 'Customer Portal: cancel and card updates on' },
    );
  } catch (error) {
    items.push({ ok: false, label: 'Customer Portal', detail: failure(error) });
  }

  if (!input.db) {
    items.push({
      ok: false,
      label: 'Products and Prices',
      detail: "DATABASE_URL isn't set, so the price plan can't be compared.",
    });
    return items;
  }
  try {
    const plan = await planPrices(input.db);
    const toCreate = plan.filter((p) => p.action === 'create');
    // Prices we have on record must exist in this Stripe account (a reset test account, or a
    // different one, would leave them dangling). Stripe takes up to 10 lookup keys a request.
    const recorded = plan.filter((p) => p.action === 'current').map((p) => p.lookupKey);
    const found = new Set<string>();
    for (let i = 0; i < recorded.length; i += 10) {
      const page = await stripe.prices.list({
        lookup_keys: recorded.slice(i, i + 10),
        active: true,
        limit: 10,
      });
      for (const price of page.data) if (price.lookup_key) found.add(price.lookup_key);
    }
    const absent = recorded.filter((key) => !found.has(key));
    const problems = [
      toCreate.length
        ? `${toCreate.length} price(s) to create: run pnpm directory:stripe sync --execute`
        : null,
      absent.length
        ? `${absent.length} recorded price(s) missing in this Stripe account (${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', …' : ''})`
        : null,
    ].filter(Boolean);
    items.push({
      ok: problems.length === 0,
      label: `Products and Prices (${plan.length} monthly price${plan.length === 1 ? '' : 's'})`,
      ...(problems.length ? { detail: problems.join('; ') } : {}),
    });
  } catch (error) {
    items.push({ ok: false, label: 'Products and Prices', detail: failure(error) });
  }
  return items;
}
