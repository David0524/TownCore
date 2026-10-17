import Stripe from 'stripe';

// Stripe for the directory (M6 PR D). Test mode only until the owner says otherwise (D-M6-5):
// a live secret key is refused here, so nothing in this code can charge a real card by mistake.
// Customers pay only through Checkout, by their own action; staff never charge a card, and
// refunds happen in the Stripe dashboard.

export class LiveModeRefused extends Error {}

export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/**
 * A Stripe client for a test-mode key, or null when no key is set. `apiBase` points it at a
 * local fake Stripe (end-to-end tests only; never with a live key, which is refused above).
 */
export function stripeClient(secretKey: string | undefined, apiBase?: string): Stripe | null {
  if (!secretKey) return null;
  if (isLiveKey(secretKey))
    throw new LiveModeRefused(
      'Stripe live mode is not enabled (D-M6-5). Use a test-mode key (sk_test_…) until the owner approves live payments.',
    );
  const base = apiBase ? new URL(apiBase) : null;
  return new Stripe(secretKey, {
    maxNetworkRetries: base ? 0 : 2,
    appInfo: { name: 'TownCore directory' },
    ...(base
      ? {
          host: base.hostname,
          port: Number(base.port) || (base.protocol === 'http:' ? 80 : 443),
          protocol: base.protocol === 'http:' ? 'http' : 'https',
        }
      : {}),
  });
}

export type { Stripe };
