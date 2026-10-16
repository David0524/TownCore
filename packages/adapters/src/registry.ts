import { loadEnv } from '@towncore/config';
import type { SourceAdapter } from './types';

// Every adapter, keyed by platform. Adapters register here as they're built (one per platform).
const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  if (adapters.has(adapter.platform))
    throw new Error(`Adapter ${adapter.platform} registered twice`);
  adapters.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): SourceAdapter | undefined {
  return adapters.get(platform);
}

export function listAdapters(): SourceAdapter[] {
  return [...adapters.values()];
}

/** The adapter most confident it runs this page (launcher source discovery, M7). */
export async function findAdapter(
  url: string,
  html: string,
): Promise<{ adapter: SourceAdapter; confidence: number } | null> {
  let best: { adapter: SourceAdapter; confidence: number } | null = null;
  for (const adapter of adapters.values()) {
    const confidence = await adapter.detect(url, html);
    if (confidence > 0 && (!best || confidence > best.confidence)) best = { adapter, confidence };
  }
  return best;
}

/** The environment variables an adapter needs that aren't set (empty when it can run). */
export function missingEnv(
  adapter: SourceAdapter,
  env: Record<string, unknown> = loadEnv(),
): string[] {
  return (adapter.requiresEnv ?? []).filter((key) => !env[key]);
}
