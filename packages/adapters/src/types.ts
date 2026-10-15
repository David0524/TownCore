import type { SourceKind } from '@towncore/config';
import type { Fetcher } from './http/fetcher';

// Source adapters (CLAUDE.md §9): one per PLATFORM, reused by every town on that platform.

/** A source row as an adapter sees it. */
export type SourceConfig = {
  id: string;
  townId: string;
  kind: SourceKind;
  platform: string;
  url: string | null;
  /** Platform-specific settings from town YAML, e.g. { zone: 'FLZ168' }. */
  config: Record<string, unknown>;
};

/** One item as fetched, before it becomes a `records` row. */
export type RawRecord = {
  /** Stable ID within the source (e.g. a feed GUID or alert ID); used to dedupe. */
  externalId: string;
  type: string;
  title?: string | null;
  text?: string | null;
  url?: string | null;
  occurredAt?: Date | null;
  raw: unknown;
};

export type AdapterContext = { fetcher: Fetcher; now: Date };

export interface SourceAdapter {
  platform: string;
  kinds: readonly SourceKind[];
  /** 0–1 confidence that this platform runs the page at `url`. */
  detect(url: string, html: string): Promise<number>;
  fetch(source: SourceConfig, since: Date | null, ctx: AdapterContext): Promise<RawRecord[]>;
  healthCheck(source: SourceConfig, ctx: AdapterContext): Promise<{ ok: boolean; detail?: string }>;
}
