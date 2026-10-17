import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { E2E_MAIL_TOKEN_SECRET, E2E_STRIPE_WEBHOOK_SECRET } from './e2e/newsletter-secret';

// Specs that seed data (admin) need DATABASE_URL; use the repo .env locally (CI sets it).
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = 3100;
/** The fake Stripe API (e2e/fake-stripe.mjs). */
const FAKE_STRIPE_PORT = 3199;
// Chromium resolves our real domains to the local server, so tests use real Host headers.
const hosts = [
  'bocatownsquare.com',
  'www.bocatownsquare.com',
  'harborpoint.test',
  'pinehollow.test',
  'unknown-town.example',
  // Staff admin host (APP_BASE_URL below), and the fixture town admin tests publish to.
  'admin.test',
  'reviewtown.test',
  'feedtown.test',
  // Newsletter signup tests (Mail-5).
  'lettertown.test',
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Optional override for machines with a preinstalled Chromium (CI installs the matching one).
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Expects `next build` to have run (CI runs it before e2e).
      command: `node node_modules/next/dist/bin/next start -p ${port}`,
      port,
      reuseExistingServer: true,
      // The admin lives only on APP_BASE_URL's host; ADMIN_EMAILS may sign in.
      env: {
        ...(process.env as Record<string, string>),
        APP_BASE_URL: 'http://admin.test',
        ADMIN_EMAILS: 'editor@admin.test',
        // Outbound mail goes to the server log in tests, never anywhere real (Rule 10).
        MAIL_TRANSPORT: 'log',
        MAIL_TOKEN_SECRET: E2E_MAIL_TOKEN_SECRET,
        MAIL_POSTAL_ADDRESS: '1 Test Street, Letter Town, ME 04000',
        // Stripe test mode with placeholder values: no request ever reaches Stripe in e2e; the
        // webhook tests sign their own events with this secret.
        STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
        STRIPE_WEBHOOK_SECRET: E2E_STRIPE_WEBHOOK_SECRET,
        // Checkout sessions go to the local fake Stripe below.
        STRIPE_API_BASE: `http://127.0.0.1:${FAKE_STRIPE_PORT}`,
        // Built-but-off products, shown in tests only (D-M6-6).
        DIRECTORY_PRODUCTS_PREVIEW: 'newsletter,exclusive',
      },
      timeout: 60_000,
    },
    {
      command: `node e2e/fake-stripe.mjs ${FAKE_STRIPE_PORT}`,
      port: FAKE_STRIPE_PORT,
      reuseExistingServer: true,
    },
  ],
});
