// The ports the e2e servers listen on. Defaults match CI; set E2E_PORT / E2E_STRIPE_PORT to run
// a second copy of the suite beside another app on the same machine.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const FAKE_STRIPE_PORT = Number(process.env.E2E_STRIPE_PORT ?? 3199);
/** The app, addressed directly rather than through a mapped town hostname. */
export const DIRECT = `http://127.0.0.1:${E2E_PORT}`;
/** The fake Stripe API (e2e/fake-stripe.mjs). */
export const FAKE_STRIPE = `http://127.0.0.1:${FAKE_STRIPE_PORT}`;
