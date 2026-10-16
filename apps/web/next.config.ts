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
    '@towncore/directory',
    '@towncore/email',
    '@towncore/launcher',
    '@towncore/mail',
    '@towncore/pipeline',
    '@towncore/prompts',
  ],
  poweredByHeader: false,
  // Share images read the display faces' static .woff files at run time (lib/og.tsx).
  outputFileTracingIncludes: {
    '/sites/[host]/news/[slug]/og': ['./node_modules/@fontsource/*/files/*-latin-*-normal.woff'],
  },
  experimental: {
    // Reply attachments go through a server action (10 MB in total, plus form overhead).
    serverActions: { bodySizeLimit: '12mb' },
  },
};

export default nextConfig;
