/** Signs newsletter links in e2e (Mail-5); the server and the specs share it. Test-only value. */
export const E2E_MAIL_TOKEN_SECRET = 'e2e-only-newsletter-token-secret-0123456789';

/** Signs Stripe webhook events in e2e (M6 PR D). Test-only value, never a real secret. */
export const E2E_STRIPE_WEBHOOK_SECRET = 'whsec_e2e_only_not_a_real_secret';
