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
