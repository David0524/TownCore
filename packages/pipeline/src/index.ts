// Story finder, writer, fact-check and tier router (CLAUDE.md §6–7).
export { buildByline } from './byline';
export {
  callModel,
  LlmOutputError,
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
  type TemplatedDraft,
  type TemplateRecord,
} from './templates';
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
export { createGuideCandidates, pagesHash, writeGuide, type GuideOutcome } from './guides';
export {
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
  refreshTownWeather,
  refreshWeather,
  weatherTargets,
  type WeatherTarget,
} from './weather-refresh';
