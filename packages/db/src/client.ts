import { requireEnv } from '@towncore/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

/**
 * A connection URL postgres.js can use. It sends any URL option it doesn't know to the server as
 * a setting, and the server rejects `channel_binding` (a libpq option that Neon's connection
 * strings include), so every connection would fail. postgres.js negotiates SCRAM itself.
 */
export function clientUrl(url: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has('channel_binding')) return url;
  parsed.searchParams.delete('channel_binding');
  return parsed.toString();
}

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}): Db {
  const client = postgres(clientUrl(url), { max: 10, onnotice: () => {}, ...options });
  return drizzle(client, { schema, casing: 'snake_case' }) as Db;
}

let shared: Db | undefined;

/** Process-wide client using DATABASE_URL. */
export function getDb(): Db {
  shared ??= createDb(requireEnv('DATABASE_URL'));
  return shared;
}
