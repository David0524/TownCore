import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.next/',
      '**/.turbo/',
      '**/coverage/',
      'packages/db/migrations/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Secrets and config are read in one place only (CLAUDE.md rule 11).
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables through @towncore/config (loadEnv / requireEnv).',
        },
      ],
    },
  },
  {
    // Rule 8: adapters fetch only through the polite Fetcher (robots.txt, rate limit, UA).
    files: ['packages/adapters/src/**/*.ts'],
    ignores: ['packages/adapters/src/http/fetcher.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Use the Fetcher from packages/adapters/src/http/fetcher.ts (Rule 8).',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'fetch', message: 'Use the Fetcher (Rule 8).' },
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables through @towncore/config.',
        },
      ],
    },
  },
  {
    files: ['packages/config/src/env.ts', '**/*.config.{js,mjs,cjs,ts}'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
