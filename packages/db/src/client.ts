import { requireEnv } from '@towncore/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}): Db {
  const client = postgres(url, { max: 10, onnotice: () => {}, ...options });
  return drizzle(client, { schema, casing: 'snake_case' }) as Db;
}

let shared: Db | undefined;

/** Process-wide client using DATABASE_URL. */
export function getDb(): Db {
  shared ??= createDb(requireEnv('DATABASE_URL'));
  return shared;
}
