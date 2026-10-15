export * as schema from './schema.js';
export * from './schema.js';
export { createDb, getDb, type Db } from './client.js';
export { migrationsFolder, runMigrations } from './migrate.js';
export { syncTowns, type SyncTownsResult } from './towns.js';
// Re-exported so apps use the same drizzle-orm instance as the schema (peer-dependency
// variants otherwise produce duplicate, incompatible types).
export { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
