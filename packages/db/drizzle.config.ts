import { loadEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  dbCredentials: { url: loadEnv().DATABASE_URL ?? '' },
});
