// Story finder, writer, fact-check and tier router (CLAUDE.md §6–7).
export { formatPlan, planDay, type DayPlan, type PlanLine } from './ai-plan';
export { buildByline } from './byline';
export {
  BatchPending,
  callModel,
  LlmOutputError,
  modelFor,
  NotRecordedError,
  routeFor,
  runAiBatches,
  TaskDisabled,
  portableSchema,
  providerFromEnv,
  recordingProvider,
  replayProvider,
  requestKey,
  resolveProviderName,
  SpendCapReached,
  networkSpendSince,
  todaysUsage,
  type CallResult,
  type BatchApi,
  type Effort,
  type Llm,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmTown,
  type Prompt,
} from './llm';
export { anthropicProvider } from './llm/anthropic';
export { geminiProvider } from './llm/gemini';
export { classifyInput, llmTown, runStoryFinder, type FinderReport } from './finder';
export {
  MIN_SOURCE_CHARS,
  penalties,
  scoreCandidate,
  timeliness,
  titleSimilarity,
  weights,
  type ScoreComponents,
} from './scoring';
export {
  isIssuedLicense,
  isNewsworthyAlert,
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
  weatherAlert,
  weekTrend,
  type TemplatedDraft,
  type TemplateRecord,
} from './templates';
export { nearDuplicateShare, normalizeWords } from './near-duplicate';
export { pastWeekCounts, roundupWeekRecords } from './roundup-weeks';
export { cannotBeArticle, decideTier, mentionsMinor, type Tier, type TierDecision } from './tiers';
export {
  checkDraft,
  namesIn,
  normalize,
  numbersIn,
  type CheckedClaim,
  type FactcheckReport,
  type SourceText,
} from './factcheck';
export {
  getReviewer,
  publishArticle,
  PublishBlocked,
  slugify,
  uniqueSlug,
  type Reviewer,
} from './publish';
export { roadClosurePin, severeWeatherPin, writeCandidate, type WriteOutcome } from './write';
export {
  applyUpdate,
  createChangedRecordUpdates,
  linkRelatedStories,
  matchPublished,
  mentionsDroppedCharges,
  updateParagraph,
} from './followups';
export {
  loadEvalCases,
  runEvals,
  stableUuid,
  type EvalCase,
  type EvalResult,
  type EvalSummary,
} from './evals';
export {
  engagementAdjustment,
  freshnessDecay,
  halfLifeHours,
  pickLead,
  PIN_BOOST,
  rankArticles,
  rankScore,
  type Engagement,
  type Rankable,
} from './ranking';
export { apDate } from './time';
export {
  assignArticleImage,
  ILLUSTRATION_LICENSE,
  cardAlt,
  chooseArticleImage,
  coverIllustration,
  dailyCounts,
  dailyCountsAlt,
  imageOptions,
  recordCountLabels,
  type ImageChoice,
  type ImageDeps,
} from './images';
export {
  acceptEntities,
  extractEntitiesForTown,
  linkArticleEntities,
  relatedArticleIds,
  type ExtractReport,
} from './entities';
export { COVERAGE_DAYS, STORY_SOURCE_ORDER, storyCoverage, type TownCoverage } from './coverage';
export {
  decideScore,
  decidedScores,
  pendingScores,
  ScoreDecisionError,
  ScoreRejected,
  SCORE_MAX_AGE_DAYS,
  SCORES_PER_HOUR,
  submitScore,
  type ScoreReport,
} from './scores';
export { createGuideCandidates, pagesHash, writeGuide, type GuideOutcome } from './guides';
export {
  aiSpend,
  type AiSpend,
  type AiSpendRow,
  COST_MIN_STORIES,
  COST_RISE,
  HEARTBEAT_STALE_MS,
  networkSpendToday,
  opsConditions,
  REVIEW_WAIT_HOURS,
  townHealth,
  type OpsCondition,
  type TownHealth,
} from './ops';
export {
  forecastsDue,
  refreshTownWeather,
  refreshWeather,
  WEATHER_FORECAST_EVERY_MS,
  WEATHER_FORECASTS_PER_RUN,
  weatherTargets,
  type WeatherTarget,
} from './weather-refresh';
export {
  addCounts,
  AUDIENCE_DAYS,
  byCohort,
  byPlatform,
  byState,
  emptyCounts,
  funnelRates,
  groupAudience,
  townAudience,
  type AudienceGroup,
  type FunnelCounts,
  type FunnelRates,
  type TownAudience,
} from './audience';
export {
  decideExperiment,
  ExperimentRefused,
  experimentReports,
  startExperiment,
  stopExperiment,
  variantMetric,
  type ExperimentReport,
} from './experiments';
export {
  autopostFacebook,
  canPostToPage,
  DAILY_POSTS,
  facebookBatch,
  facebookLink,
  facebookMessage,
  FacebookPostError,
  markFacebookPost,
  META_GRAPH_VERSION,
  postToFacebook,
  queueFacebookPosts,
  type FacebookPost,
} from './social';
export {
  activePoll,
  castVote,
  createPoll,
  decidePoll,
  listPolls,
  POLL_MAX_DAYS,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  PollError,
  pollResults,
  pollShares,
  voterHash,
  type Poll,
  type PollResults,
  type VoteOutcome,
} from './polls';
