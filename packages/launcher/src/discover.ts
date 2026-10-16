import type { SourceKind, TownSourceConfig } from '@towncore/config';
import {
  FetchPolicyError,
  findAdapter,
  getAdapter,
  type Fetcher,
  type SourceProposal,
} from '@towncore/adapters';
import type { DiscoverResult } from '@towncore/prompts';
import type { ResolvedTown } from './resolve';

// Launch step 3 (CLAUDE.md §10; docs/plans/M7.md §3): find the town's sources. The model suggests
// URLs (when a provider with web search is configured), `--source kind=url` flags add or override
// them, and code decides: every URL is fetched once through the Fetcher (robots.txt, never-scrape
// list, 1 request a second), matched to an adapter with detect(), and turned into source settings
// only when the adapter proposes some and they pass a live health check. A blocked host scores 0.

export type FindingStatus =
  /** An adapter runs it and at least one source passed its health check. */
  | 'matched'
  /** robots.txt or the never-scrape list forbids it (Rule 8). */
  | 'blocked'
  /** The site refused or failed the request (HTTP 403, timeout…). */
  | 'unreadable'
  /** No adapter recognizes the platform: an adapter request (D-M7-7). */
  | 'unknown'
  /** An adapter recognizes it but found no feed for this kind. */
  | 'no-feed';

export type Finding = {
  kind: SourceKind;
  url: string;
  origin: 'flag' | 'model' | 'state';
  status: FindingStatus;
  platform: string | null;
  /** For unknown platforms: what the page looks like it runs on. */
  hint: string | null;
  detail: string;
  sources: Array<TownSourceConfig & { label: string }>;
};

export type DiscoverDetail = {
  /** `model`: web search ran; `manual`: only --source flags and state adapters (D-M7-2). */
  mode: 'model' | 'manual';
  findings: Finding[];
  outlets: DiscoverResult['outlets'];
  /** The --source flags this run used; new flags on resume re-run discovery. */
  flags: string[];
};

/** Parses `--source agenda=https://…` values. */
export function parseSourceFlags(flags: string[]): Array<{ kind: SourceKind; url: string }> {
  return flags.map((flag) => {
    const i = flag.indexOf('=');
    const kind = flag.slice(0, i) as SourceKind;
    const url = flag.slice(i + 1);
    if (i < 1 || !/^https?:\/\//.test(url))
      throw new Error(`--source takes kind=url, like agenda=https://example.gov/ (got "${flag}")`);
    return { kind, url };
  });
}

/** Known meeting and website platforms, so an adapter request names what to build. */
const PLATFORM_HINTS: Array<[RegExp, string]> = [
  [/granicus\.com|granicus/i, 'Granicus'],
  [/legistar\.com|legistar/i, 'Legistar'],
  [/civicclerk/i, 'CivicClerk'],
  [/boarddocs\.com/i, 'BoardDocs'],
  [/novusagenda/i, 'NovusAgenda'],
  [/primegov/i, 'PrimeGov'],
  [/iqm2\.com/i, 'IQM2 (Granicus Meeting Portal)'],
  [/municode/i, 'Municode'],
  [/opengov\.com/i, 'OpenGov'],
  [/(youtube\.com|youtu\.be)/i, 'YouTube'],
  [/wp-content|wordpress/i, 'WordPress'],
  [/drupal/i, 'Drupal'],
  [/revize/i, 'Revize'],
  [/vision(internet|live)|visioncms/i, 'Granicus govAccess (Vision)'],
];

export function platformHint(url: string, html: string): string | null {
  for (const [pattern, name] of PLATFORM_HINTS)
    if (pattern.test(url) || pattern.test(html)) return name;
  return null;
}

/** Fetches one suggested URL under Rule 8 and decides what it is. */
export async function verifyUrl(
  fetcher: Fetcher,
  candidate: { kind: SourceKind; url: string; origin: Finding['origin'] },
  now: Date = new Date(),
): Promise<Finding> {
  const base = { ...candidate, platform: null, hint: null, sources: [] };
  let html: string;
  try {
    html = await fetcher.getText(candidate.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof FetchPolicyError)
      return { ...base, status: 'blocked', detail: `Not fetched: ${message}` };
    return { ...base, status: 'unreadable', detail: message };
  }
  const match = await findAdapter(candidate.url, html);
  if (!match)
    return {
      ...base,
      status: 'unknown',
      hint: platformHint(candidate.url, html),
      detail: 'No adapter recognizes this page; an adapter request is in the report.',
    };
  const { adapter } = match;
  const ctx = { fetcher, now };
  let proposals: SourceProposal[];
  try {
    proposals = (await adapter.propose?.(candidate.url, html, candidate.kind, ctx)) ?? [];
  } catch (error) {
    return {
      ...base,
      platform: adapter.platform,
      status: 'no-feed',
      detail: `${adapter.platform} found, but proposing a source failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const sources: Finding['sources'] = [];
  const failures: string[] = [];
  for (const p of proposals) {
    const health = await adapter.healthCheck(
      {
        id: 'discovery',
        townId: 'discovery',
        kind: p.kind,
        platform: adapter.platform,
        url: p.url,
        config: { ...(p.options ?? {}) },
      },
      ctx,
    );
    if (health.ok)
      sources.push({
        kind: p.kind,
        platform: adapter.platform,
        url: p.url,
        ...(p.options ? { options: p.options } : {}),
        label: p.label,
      });
    else failures.push(`${p.label}: ${health.detail ?? 'health check failed'}`);
  }
  return {
    ...base,
    platform: adapter.platform,
    status: sources.length ? 'matched' : 'no-feed',
    detail: sources.length
      ? sources.map((s) => s.label).join('; ')
      : failures.join('; ') || `${adapter.platform} has no ${candidate.kind} feed on this site.`,
    sources,
  };
}

/**
 * State-level sources every town in the state gets (CLAUDE.md §9: written once, reused), each
 * health-checked live. Florida: DBPR licenses and new food service approvals, Sunbiz filings,
 * filtered to the town's mailing city.
 */
export async function stateSources(
  fetcher: Fetcher,
  town: Pick<ResolvedTown, 'state' | 'name'>,
  now: Date = new Date(),
): Promise<Finding[]> {
  if (town.state !== 'FL') return [];
  const city = town.name.toUpperCase();
  const planned: Array<{
    platform: string;
    url: string;
    options: Record<string, string | string[]>;
    label: string;
  }> = [
    {
      platform: 'fl-dbpr',
      url: 'https://www.myfloridalicense.com/',
      options: { city },
      label: 'Florida DBPR contractor and trade licenses',
    },
    {
      platform: 'fl-dbpr',
      url: 'https://www.myfloridalicense.com/',
      options: { city, files: ['newfood.csv'] },
      label: 'Florida DBPR new food service approvals',
    },
    {
      platform: 'fl-sunbiz',
      url: 'https://sftp.floridados.gov/',
      options: { city },
      label: 'Florida Division of Corporations daily filings',
    },
  ];
  const findings: Finding[] = [];
  for (const p of planned) {
    const adapter = getAdapter(p.platform)!;
    const health = await adapter.healthCheck(
      {
        id: 'discovery',
        townId: 'discovery',
        kind: 'business_filings',
        platform: p.platform,
        url: null,
        config: p.options,
      },
      { fetcher, now },
    );
    findings.push({
      kind: 'business_filings',
      url: p.url,
      origin: 'state',
      status: health.ok ? 'matched' : 'unreadable',
      platform: p.platform,
      hint: null,
      detail: health.ok ? p.label : `${p.label}: ${health.detail ?? 'health check failed'}`,
      sources: health.ok
        ? [{ kind: 'business_filings', platform: p.platform, options: p.options, label: p.label }]
        : [],
    });
  }
  return findings;
}

/**
 * Every verified source, once each: two URLs (or kinds) on one site can propose the same feed,
 * which is then ingested once, under the first kind found.
 */
export function verifiedSources(findings: Finding[]): TownSourceConfig[] {
  const seen = new Set<string>();
  const out: TownSourceConfig[] = [];
  for (const f of findings)
    for (const { label: _label, ...source } of f.sources) {
      const key = JSON.stringify([source.platform, source.url ?? '', source.options ?? {}]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(source);
    }
  return out;
}
