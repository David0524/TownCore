import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Use the repo-root .env (shared with the worker and scripts) in local dev.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source.
  transpilePackages: [
    '@towncore/adapters',
    '@towncore/brand',
    '@towncore/config',
    '@towncore/db',
    '@towncore/email',
    '@towncore/pipeline',
    '@towncore/prompts',
  ],
  poweredByHeader: false,
};

export default nextConfig;
