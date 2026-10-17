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
  /**
   * The item has no date of its own (a project on a city's development map): ingest dates it
   * when it's first stored and keeps that date when its content changes. Items stored on a
   * source's first successful run stay undated, since they were already there, not news.
   */
  datedOnSight?: boolean;
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
  /**
   * Environment variables the adapter can't run without (an API key). Ingest skips its sources
   * while one is missing, rather than failing them every run (missingEnv in registry.ts).
   */
  requiresEnv?: readonly string[];
  /**
   * Launcher discovery (M7): source settings for a page this adapter runs, for the kind wanted.
   * Each proposal is then health-checked live before it enters a town's config.
   */
  propose?(
    url: string,
    html: string,
    kind: SourceKind,
    ctx: AdapterContext,
  ): Promise<SourceProposal[]>;
}

/** A source an adapter can run for a discovered page: what goes in the town YAML. */
export type SourceProposal = {
  kind: SourceKind;
  url: string;
  options?: Record<string, string>;
  /** What it is, for the launch report ("CivicPlus calendar: City Council & Public Meetings"). */
  label: string;
};
