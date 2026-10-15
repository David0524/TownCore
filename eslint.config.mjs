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
    files: ['packages/config/src/env.ts', '**/*.config.{js,mjs,cjs,ts}'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
