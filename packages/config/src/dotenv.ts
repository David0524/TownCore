import { existsSync } from 'node:fs';
import { resetEnvCache } from './env';

// Node-only helper for scripts and the worker. Kept out of the package index because bundlers
// (Turbopack) treat `new URL(..., import.meta.url)` as an asset import.

/** Loads the repo-root .env into process.env, if the file exists. */
export function loadDotEnv(file: URL = new URL('../../../.env', import.meta.url)): void {
  if (existsSync(file)) process.loadEnvFile(file);
  resetEnvCache();
}
