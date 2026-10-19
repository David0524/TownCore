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
  dayRange,
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
export {
  attachCaptions,
  CAPTION_MAX_BYTES,
  captionMeetings,
  CaptionUploadError,
  type CaptionMeeting,
} from './captions';
export {
  chooseSplit,
  meetingItemOf,
  meetingSplitEnabled,
  splitMeeting,
  type MeetingItem,
} from './meeting-split';
export { nearDuplicateShare, normalizeWords } from './near-duplicate';
export { pastWeekCounts, roundupWeekRecords } from './roundup-weeks';
export {
  cannotBeArticle,
  decideTier,
  mentionsMinor,
  sensitiveTopics,
  type Tier,
  type TierDecision,
} from './tiers';
export { lintStyle, styleRevisionLines, STYLE_WHY, type StyleHit } from './style-lint';
export {
  legalReviewOn,
  reviewLibel,
  tierAfterLegal,
  verifyLegalFlags,
  type LegalFlag,
  type LegalReport,
} from './legal';
export {
  checkDraft,
  namesIn,
  normalize,
  numbersIn,
  quotedSpans,
  quoteInRecord,
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
export { rerenderRoundups, type RerenderChange } from './rerender';
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
  REVIEW_BACKLOG_CEILING,
  REVIEW_WAIT_HOURS,
  reviewBacklogWeekAgo,
  townHealth,
  type OpsAlertKind,
  type OpsCondition,
  type TownHealth,
} from './ops';
export {
  MAX_RELEASE_CHARS,
  MIN_RELEASE_CHARS,
  NEWSROOM_KINDS,
  NewsroomError,
  newsroomKindLabels,
  newsroomRecords,
  releaseText,
  releaseTitle,
  sendToNewsroom,
  suggestKind,
  type NewsroomKind,
} from './press-releases';
export {
  bandFor,
  bandRows,
  CALIBRATION_DAYS,
  calibrate,
  MIN_DECIDED_PER_BAND,
  MIN_DECIDED_TOTAL,
  outcomeOf,
  SCORE_BANDS,
  scoreCalibration,
  type BandRow,
  type Calibration,
  type CandidateOutcome,
  type ScoreBand,
} from './calibration';
export {
  daysCadence,
  forecastsDue,
  refreshTownWeather,
  refreshWeather,
  WEATHER_FORECAST_EVERY_MS,
  WEATHER_FORECASTS_PER_RUN,
  refreshTropics,
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
export {
  cohortGates,
  GATE_CORRECTIONS_PER_TOWN,
  GATE_FACTCHECK_MIN,
  GATE_SIGNUPS_PER_TOWN,
  type CohortGate,
  type GateResult,
  type GateStatus,
} from './cohort-gates';
export {
  decideProposal,
  experimentProposals,
  gateProposal,
  latestGateDecision,
  listProposals,
  MIN_LIFT,
  MIN_TOWNS_PER_VARIANT,
  ProposalDecisionRefused,
  readVariantReports,
  routingDiff,
  routingProposals,
  runLearningLoops,
  upsertProposal,
  type LearningRun,
  type Proposal,
  type ProposalInput,
} from './proposals';
export {
  buildDigest,
  DIGEST_SECTIONS,
  digestText,
  listDigests,
  markDigestEmailed,
  storeDigest,
  type Digest,
  type DigestItem,
} from './digest';
export { EVAL_VARIANTS, type VariantReport } from './evals';
export {
  checkSites,
  DOWN_AFTER,
  lightFor,
  lightLabels,
  parseCheckUrls,
  uptimeFor,
  type Light,
  type Uptime,
} from './uptime';
export {
  ANALYTICS_RANGES,
  networkAnalytics,
  siteAnalytics,
  type AnalyticsRange,
  type DailyPoint,
  type SiteDetail,
  type SiteRow,
  type SiteTotals,
} from './analytics';
