import { loadEnv } from '@towncore/config';
import { LiveModeRefused, stripeClient, type Stripe } from '@towncore/directory';

// Stripe for town sites and the webhook (M6 PR D): test mode only (D-M6-5). With no key, or a
// live key, the directory says paid listings aren't open yet.

let cached: { key: string | undefined; client: Stripe | null } | null = null;

export function stripe(): Stripe | null {
  const key = loadEnv().STRIPE_SECRET_KEY;
  if (cached && cached.key === key) return cached.client;
  let client: Stripe | null = null;
  try {
    client = stripeClient(key, loadEnv().STRIPE_API_BASE);
  } catch (error) {
    if (!(error instanceof LiveModeRefused)) throw error;
    console.error(error.message);
  }
  cached = { key, client };
  return client;
}
