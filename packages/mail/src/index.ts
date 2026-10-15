// Multi-domain mail platform (docs/plans/MAIL.md): routing and domain onboarding so far; SES
// sending, MIME, threading, suppression and bulk sending arrive phase by phase.
export { parseAddress, type ParsedAddress } from './address';
export {
  desiredRecords,
  MAIL_FROM_LABEL,
  NEWS_LABEL,
  planDns,
  type Conflict,
  type DnsPlan,
  type DnsPurpose,
  type DnsRecordSpec,
  type ExistingRecord,
} from './dns';
export {
  cleanMessageId,
  isAutomatedMail,
  parseRawEmail,
  type ParsedAttachment,
  type ParsedMessage,
} from './inbound/parse';
export { sanitizeEmailHtml } from './inbound/sanitize';
export { normalizeSubject, referencedIds, THREAD_FALLBACK_DAYS } from './inbound/threading';
export { memoryStore, type MemoryState } from './memory-store';
export {
  ACTIVATE,
  newsIdentityName,
  onboardDomain,
  resetFailedSteps,
  STEPS,
  type DomainState,
  type DomainStatus,
  type OnboardingDeps,
  type OnboardingOutcome,
  type OnboardingReport,
  type OnboardingStore,
  type RecordState,
  type StepName,
  type StepState,
} from './onboarding';
export { dryRunStore, pgOnboardingStore } from './pg-store';
export { RetryableError, withRetry, type RetryOptions } from './retry';
export { routeRecipient, type Route, type RoutingInput } from './routing';
export {
  identityFailed,
  identityVerified,
  sesIdentities,
  type IdentityInfo,
  type IdentityProvider,
} from './ses';
export {
  usesVercelDns,
  vercelDns,
  VercelApiError,
  type DnsProvider,
  type VercelDomain,
} from './vercel';
export { checkVerification, type VerificationResult } from './verify';
export {
  httpsSigningKeyLoader,
  isSnsUrl,
  SnsVerificationError,
  snsMessageSchema,
  stringToSign,
  verifySnsMessage,
  type SigningKeyLoader,
  type SnsMessage,
} from './sns';
export { handleSnsWebhook, type WebhookDeps, type WebhookResult } from './webhook';
export {
  MAX_EVENT_ATTEMPTS,
  processDueEvents,
  retryDelayMs,
  type BatchResult,
  type EventHandler,
} from './inbound/events';
export {
  processReceivedNotification,
  receivedNotificationSchema,
  safeFilename,
  type MailObjectStore,
  type ProcessDeps,
  type ProcessResult,
  type ReceivedNotification,
} from './inbound/process';
export { s3MailStore } from './inbound/s3';
export {
  addNote,
  assignThread,
  InboxActionError,
  moveThreadToTeam,
  setThreadStatus,
} from './inbox/actions';
export {
  getThread,
  inboxFacets,
  listThreads,
  markRead,
  PAGE_SIZE,
  threadStatuses,
  unreadCount,
  type InboxFilter,
  type InboxRow,
  type StatusFilter,
  type ThreadDetail,
  type ThreadStatus,
} from './inbox/queries';
export {
  cspFor,
  hasRemoteImages,
  messageDocument,
  rewriteCidImages,
  type RenderOptions,
} from './inbox/render';
export { INLINE_URL_TTL_MS, signAttachment, verifyAttachment } from './inbox/tokens';
export {
  DOWNLOAD_URL_TTL_S,
  INLINE_IMAGE_TYPES,
  s3AttachmentFiles,
  type AttachmentFiles,
} from './inbox/files';
