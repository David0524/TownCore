export * as schema from './schema';
export * from './schema';
export { clientUrl, createDb, getDb, type Db } from './client';
export { guideSourceKey, syncTowns, type SyncTownsResult } from './towns';
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
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
export {
  getActiveCampaign,
  getActiveCampaigns,
  getPublishedArticle,
  listArticlesByIds,
  getSourceRecords,
  getRecordSources,
  listArticleCorrections,
  listTownCorrections,
  getTownByHost,
  getTownBySlug,
  listLiveTowns,
  listPublishedArticles,
  listPublishedGuides,
  normalizeHost,
  type Article,
  type Campaign,
  type Correction,
  type SourceRecord,
  type RecordSource,
  type Town,
} from './queries';
export {
  createLoginToken,
  createStaffSession,
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
export {
  activePinIds,
  countEngagement,
  engagementByArticle,
  listRankableArticles,
  type CounterKind,
  type RankableArticle,
} from './ranking-queries';
export {
  claimWeatherRefresh,
  getTownWeather,
  saveTownWeatherAlerts,
  saveTownWeather,
  WEATHER_MAX_AGE_MS,
} from './weather';
export { countReferral, experimentKeys, experimentStates, townVariant } from './audience';
