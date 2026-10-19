import type { SourceKind } from '@towncore/config';

// How often each source is ingested (docs/plans/M2.md §4). Overridable per source in YAML.
const DEFAULTS: Partial<Record<SourceKind, string>> = {
  weather: '3h',
  events: '1h',
  agenda: '2h',
  meeting_video: '2h',
  police: '1h',
  fire: '1h',
  city_news: '1h',
  business_filings: '1d',
  permits: '1d',
  property_sales: '1d',
  inspections: '1d',
  schools: '6h',
};
const FALLBACK = '6h';

/** Platform overrides: NWS carries alerts, so it runs often; DBPR files change weekly. */
const PLATFORM_DEFAULTS: Record<string, string> = {
  nws: '15m',
  'fl-dbpr': '7d',
  'fl-sunbiz': '6h',
  // Guide pages: checked daily, so a changed official page refreshes its guide within a day.
  page: '1d',
  // CMS refreshes nursing-home data once a month and asks for 10 seconds between requests.
  cms: '7d',
};

/**
 * Module overrides (`platform:module` from the source config): CivicPlus Agenda Center re-reads
 * recent minutes PDFs each run (they carry no posted time), so it runs four times a day.
 */
const MODULE_DEFAULTS: Record<string, string> = {
  'civicplus:agenda-center': '6h',
};

export function defaultSchedule(kind: SourceKind, platform: string, config?: unknown): string {
  const module = (config as { module?: unknown } | null | undefined)?.module;
  const byModule = typeof module === 'string' ? MODULE_DEFAULTS[`${platform}:${module}`] : null;
  return byModule ?? PLATFORM_DEFAULTS[platform] ?? DEFAULTS[kind] ?? FALLBACK;
}

export function intervalMs(schedule: string): number {
  const match = /^(\d+)([mhd])$/.exec(schedule);
  if (!match) throw new Error(`Invalid schedule "${schedule}"; use e.g. 15m, 3h, 7d`);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

/** Failed runs in a row that mark a source broken (ingest). */
export const BROKEN_AFTER_FAILURES = 3;

/** A broken source is retried after 6 hours, then 12, then every 24 while it keeps failing. */
const BROKEN_RETRY_FIRST_MS = 6 * 3_600_000;
const BROKEN_RETRY_MAX_MS = 24 * 3_600_000;
/** A source refused by policy (robots.txt, never-scrape list) re-checks robots.txt weekly. */
const POLICY_RETRY_MS = 7 * 86_400_000;

/** True when a stored error is a Fetcher policy refusal (FetchPolicyError's messages). */
export function isPolicyRefusal(lastError: string | null | undefined): boolean {
  return !!lastError && /^Refusing to (fetch|POST)\b/.test(lastError);
}

/**
 * How long to wait after a run before the next one. A broken source backs off instead of
 * polling a dead URL on its normal schedule: 6 h, 12 h, then daily; one good run makes it `ok`
 * again (ingest), so it returns to its schedule. A policy refusal won't fix itself in hours, so
 * it is retried weekly, which re-reads robots.txt. Never more often than the normal schedule.
 */
export function retryIntervalMs(source: {
  kind: SourceKind;
  platform: string;
  schedule: string | null;
  config?: unknown;
  health?: string | null;
  consecutiveFailures?: number | null;
  lastError?: string | null;
}): number {
  const every = intervalMs(
    source.schedule ?? defaultSchedule(source.kind, source.platform, source.config),
  );
  if (source.health !== 'broken') return every;
  if (isPolicyRefusal(source.lastError)) return Math.max(every, POLICY_RETRY_MS);
  const extra = Math.max(0, (source.consecutiveFailures ?? 0) - BROKEN_AFTER_FAILURES);
  const backoff = Math.min(BROKEN_RETRY_MAX_MS, BROKEN_RETRY_FIRST_MS * 2 ** Math.min(extra, 8));
  return Math.max(every, backoff);
}

export function isDue(
  source: {
    kind: SourceKind;
    platform: string;
    schedule: string | null;
    lastRunAt: Date | null;
    config?: unknown;
    health?: string | null;
    consecutiveFailures?: number | null;
    lastError?: string | null;
  },
  now: Date,
): boolean {
  if (!source.lastRunAt) return true;
  return now.getTime() - source.lastRunAt.getTime() >= retryIntervalMs(source);
}
