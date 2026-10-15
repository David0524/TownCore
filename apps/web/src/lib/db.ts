import { createDb, type Db } from '@towncore/db';
import { requireEnv } from '@towncore/config';

// One pool per server process; survives dev hot reloads.
const globalForDb = globalThis as unknown as { towncoreDb?: Db };

export function db(): Db {
  globalForDb.towncoreDb ??= createDb(requireEnv('DATABASE_URL'), { max: 5 });
  return globalForDb.towncoreDb;
}
