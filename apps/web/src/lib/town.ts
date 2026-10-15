import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadEnv } from '@towncore/config';
import { getTownByHost, getTownBySlug, normalizeHost, type Town } from '@towncore/db';
import { db } from './db';

const TTL_MS = 60_000;
const memo = new Map<string, { town: Town | null; expires: number }>();

async function lookup(host: string): Promise<Town | null> {
  const town = await getTownByHost(db(), host);
  if (town) return town;

  // Local dev: <slug>.localhost resolves by slug. *.localhost never resolves over public DNS,
  // so this can't expose anything a real domain doesn't already serve.
  if (host.endsWith('.localhost')) {
    return getTownBySlug(db(), host.slice(0, -'.localhost'.length));
  }

  // Previews: unmatched hosts (e.g. *.vercel.app) fall back to DEV_TOWN_SLUG when set.
  // Never set DEV_TOWN_SLUG in the production environment.
  const devSlug = loadEnv().DEV_TOWN_SLUG;
  return devSlug ? getTownBySlug(db(), devSlug) : null;
}

/** Resolves a raw Host header (as passed through the proxy) to a town, cached for 60s. */
export const resolveTown = cache(async (rawHost: string): Promise<Town | null> => {
  const host = normalizeHost(decodeURIComponent(rawHost));
  if (!host) return null;

  const hit = memo.get(host);
  if (hit && hit.expires > Date.now()) return hit.town;

  const town = await lookup(host);
  memo.set(host, { town, expires: Date.now() + TTL_MS });
  return town;
});

/** Formats a date in the town's timezone, e.g. "Oct. 15, 2026". */
export function formatTownDate(date: Date, town: Pick<Town, 'timezone'>): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: town.timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * For layouts and pages under /sites/[host]: the town, or a 404. Next renders a layout and its
 * page in parallel, so every segment must handle an unknown host itself.
 */
export async function requireTown(params: Promise<{ host: string }>): Promise<Town> {
  const town = await resolveTown((await params).host);
  if (!town) notFound();
  return town;
}
