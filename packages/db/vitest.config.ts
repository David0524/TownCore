import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests need DATABASE_URL; pick it up from the repo .env when present.
// (Inline rather than @towncore/config: vitest loads this file before TS workspace resolution.)
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 30_000 },
});
