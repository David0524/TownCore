export * as schema from './schema';
export * from './schema';
export { createDb, getDb, type Db } from './client';
export { syncTowns, type SyncTownsResult } from './towns';
// Re-exported so apps use the same drizzle-orm instance as the schema (peer-dependency
// variants otherwise produce duplicate, incompatible types).
export { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
export {
  getActiveCampaign,
  getTownByHost,
  getTownBySlug,
  listLiveTowns,
  listPublishedArticles,
  normalizeHost,
  type Article,
  type Campaign,
  type Town,
} from './queries';
