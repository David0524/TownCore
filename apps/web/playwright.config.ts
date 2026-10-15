import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Specs that seed data (admin) need DATABASE_URL; use the repo .env locally (CI sets it).
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = 3100;
// Chromium resolves our real domains to the local server, so tests use real Host headers.
const hosts = [
  'bocatownsquare.com',
  'www.bocatownsquare.com',
  'harborpoint.test',
  'unknown-town.example',
  // Staff admin host (APP_BASE_URL below), and the fixture town admin tests publish to.
  'admin.test',
  'reviewtown.test',
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
  webServer: {
    // Expects `next build` to have run (CI runs it before e2e).
    command: `node node_modules/next/dist/bin/next start -p ${port}`,
    port,
    reuseExistingServer: true,
    // The admin lives only on APP_BASE_URL's host; ADMIN_EMAILS may sign in.
    env: {
      ...(process.env as Record<string, string>),
      APP_BASE_URL: 'http://admin.test',
      ADMIN_EMAILS: 'editor@admin.test',
    },
    timeout: 60_000,
  },
});
