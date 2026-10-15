import type { SourceKind } from '@towncore/config';

// How often each source is ingested (docs/plans/M2.md §4). Overridable per source in YAML.
const DEFAULTS: Partial<Record<SourceKind, string>> = {
  weather: '3h',
  events: '1h',
  agenda: '2h',
  meeting_video: '2h',
  police: '1h',
  fire: '1h',
  business_filings: '1d',
  permits: '1d',
  property_sales: '1d',
  inspections: '1d',
  schools: '6h',
};
const FALLBACK = '6h';

/** Platform-specific overrides: NWS alerts need to be fresh; DBPR files change weekly. */
const PLATFORM_DEFAULTS: Record<string, string> = { 'nws-alerts': '15m', 'fl-dbpr': '7d' };

export function defaultSchedule(kind: SourceKind, platform: string): string {
  return PLATFORM_DEFAULTS[platform] ?? DEFAULTS[kind] ?? FALLBACK;
}

export function intervalMs(schedule: string): number {
  const match = /^(\d+)([mhd])$/.exec(schedule);
  if (!match) throw new Error(`Invalid schedule "${schedule}"; use e.g. 15m, 3h, 7d`);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

export function isDue(
  source: { kind: SourceKind; platform: string; schedule: string | null; lastRunAt: Date | null },
  now: Date,
): boolean {
  if (!source.lastRunAt) return true;
  const every = intervalMs(source.schedule ?? defaultSchedule(source.kind, source.platform));
  return now.getTime() - source.lastRunAt.getTime() >= every;
}
