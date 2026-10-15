// Source adapters, one folder per PLATFORM (CLAUDE.md §9), plus the ingest framework.
import './adapters';
export {
  Fetcher,
  FetchPolicyError,
  NotModified,
  type FetchFn,
  type FetcherOptions,
} from './http/fetcher';
export { recordingFetch, replayFetch, type FixtureFile } from './http/fixtures';
export { isBlockedUrl, USER_AGENT } from './http/policy';
export {
  BROKEN_AFTER_FAILURES,
  contentHash,
  ingestSource,
  listIngestableSources,
  toSourceConfig,
  type IngestResult,
} from './ingest';
export { findAdapter, getAdapter, listAdapters, registerAdapter } from './registry';
export { defaultSchedule, intervalMs, isDue } from './schedule';
export type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from './types';
export { DOCUMENTED_APIS, documentedApi } from './http/policy';
export { nwsAdapter } from './nws';
export { civicplusAdapter } from './civicplus';
export { parseIcal, zonedTimeToUtc } from './lib/ical';
export { flDbprAdapter } from './fl-dbpr';
export { flSunbizAdapter } from './fl-sunbiz';
