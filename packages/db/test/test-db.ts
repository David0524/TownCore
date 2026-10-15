import { randomBytes } from 'node:crypto';
import { requireEnv } from '@towncore/config';
import postgres from 'postgres';
import { createDb, type Db } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

/**
 * Creates a fresh, migrated database for one test file and drops it afterwards, so tests
 * never touch the dev database. Needs DATABASE_URL with CREATEDB (docker-compose and CI have it).
 */
export async function createTestDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const baseUrl = new URL(requireEnv('DATABASE_URL'));
  const name = `towncore_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(baseUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const db = createDb(url.toString(), { max: 2 });

  return {
    db,
    drop: async () => {
      await db.$client.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
