export * as schema from './schema';
export * from './schema';
export { createDb, getDb, type Db } from './client';
export { syncTowns, type SyncTownsResult } from './towns';
export {
  loadRoutingTable,
  syncMailRouting,
  type RoutingTable,
  type SyncMailRoutingResult,
} from './mail-routing';
// Re-exported so apps use the same drizzle-orm instance as the schema (peer-dependency
// variants otherwise produce duplicate, incompatible types).
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
export {
  getActiveCampaign,
  getPublishedArticle,
  getSourceRecords,
  listArticleCorrections,
  listTownCorrections,
  getTownByHost,
  getTownBySlug,
  listLiveTowns,
  listPublishedArticles,
  normalizeHost,
  type Article,
  type Campaign,
  type Correction,
  type SourceRecord,
  type Town,
} from './queries';
export {
  createLoginToken,
  endSession,
  findOrCreateStaff,
  getSessionStaff,
  hashToken,
  logAdminAction,
  LOGIN_LINKS_PER_HOUR,
  LOGIN_TOKEN_TTL_MS,
  redeemLoginToken,
  SESSION_TTL_MS,
  TooManyLoginLinks,
  type StaffMember,
} from './staff-auth';
