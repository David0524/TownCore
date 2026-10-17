import type { Fetcher } from '@towncore/adapters';
import type { SourceKind, TownConfig } from '@towncore/config';
import {
  agentRuns,
  and,
  articles,
  eq,
  gte,
  inArray,
  ne,
  records,
  sourceKey,
  sourceProposals,
  sources,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import {
  callModel,
  SpendCapReached,
  storyCoverage,
  TaskDisabled,
  type Llm,
} from '@towncore/pipeline';
import { discoverV1 } from '@towncore/prompts';
import { verifyUrl } from './discover';

// The standing source-discovery agent (owner, 2026-10-17; docs/plans/agentic-ops.md). Weekly,
// for each town below its Rule 7 target, largest gap first: the `discover` task searches the
// web for official sources the town doesn't have; code fetches every URL under Rule 8 (robots.txt,
// the never-scrape list, 1 request a second) and matches it to an adapter with detect(). Known
// platforms become proposed source configs with an estimate of the items a day they would add;
// unknown platforms become adapter requests. Nothing is added until staff approve it in
// Admin → Proposals, and nothing here can widen the documented-API list.

export type DiscoveryDeps = {
  db: Db;
  fetcher: Fetcher;
  /** A provider with web search; without one the agent records a skipped run and stops. */
  llm?: Llm;
  /** Towns a run looks at, largest gap first (default 10, inside the task's daily cap). */
  maxTowns?: number;
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type DiscoveryTownResult = {
  townId: string;
  siteName: string;
  gap: number;
  suggested: number;
  proposed: number;
  adapterRequests: number;
  refused: number;
  error?: string;
};

const WINDOW_DAYS = 30;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What a new source of this platform and kind adds, from the network's own history: real items a
 * day per source over the last 30 days, first for the same platform and kind, then for the kind
 * on any platform. Null when no town has one yet; never a guess.
 */
export async function estimateItemsPerDay(
  db: Db,
  input: { platform: string; kind: SourceKind },
  now = new Date(),
): Promise<{ perDay: number | null; basis: string }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const measure = async (platform: string | null) => {
    const match = and(
      eq(sources.kind, input.kind),
      platform ? eq(sources.platform, platform) : undefined,
      sql`${sources.townId} in (select id from towns where status <> 'paused')`,
    );
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sources)
      .where(match);
    const [stories] = await db
      .select({ n: sql<number>`count(distinct ${articles.id})::int` })
      .from(articles)
      .innerJoin(records, eq(records.id, sql`${articles.sourceRecordIds}[1]`))
      .innerJoin(sources, eq(sources.id, records.sourceId))
      .where(
        and(
          match,
          inArray(articles.status, ['published', 'corrected']),
          ne(articles.kind, 'guide'),
          gte(articles.publishedAt, since),
        ),
      );
    return { sources: count?.n ?? 0, stories: stories?.n ?? 0 };
  };
  const same = await measure(input.platform);
  if (same.sources > 0)
    return {
      perDay: round1(same.stories / same.sources / WINDOW_DAYS),
      basis: `${input.platform} ${input.kind.replace('_', ' ')} sources in ${same.sources} town(s), last ${WINDOW_DAYS} days`,
    };
  const kind = await measure(null);
  if (kind.sources > 0)
    return {
      perDay: round1(kind.stories / kind.sources / WINDOW_DAYS),
      basis: `${input.kind.replace('_', ' ')} sources on any platform in ${kind.sources} town(s)`,
    };
  return { perDay: null, basis: 'No town has this kind of source yet, so no estimate' };
}

export async function runSourceDiscovery(deps: DiscoveryDeps): Promise<DiscoveryTownResult[]> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const started = now();
  const behind = (await storyCoverage(db, started)).filter((t) => t.gap > 0);
  if (!deps.llm?.provider.webSearch) {
    await db.insert(agentRuns).values({
      agent: 'source-discovery',
      status: 'skipped',
      summary: { reason: 'No model provider with web search is configured.', towns: behind.length },
      startedAt: started,
      finishedAt: now(),
    });
    return [];
  }
  const out: DiscoveryTownResult[] = [];
  for (const cov of behind.slice(0, deps.maxTowns ?? 10)) {
    const t0 = now();
    const [town] = await db.select().from(towns).where(eq(towns.id, cov.id));
    if (!town) continue;
    const result: DiscoveryTownResult = {
      townId: town.id,
      siteName: town.siteName,
      gap: cov.gap,
      suggested: 0,
      proposed: 0,
      adapterRequests: 0,
      refused: 0,
    };
    try {
      await discoverForTown(deps, town, cov.missing, result);
      await db.insert(agentRuns).values({
        agent: 'source-discovery',
        townId: town.id,
        status: 'ok',
        summary: result,
        startedAt: t0,
        finishedAt: now(),
      });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      await db.insert(agentRuns).values({
        agent: 'source-discovery',
        townId: town.id,
        status: 'failed',
        summary: result,
        startedAt: t0,
        finishedAt: now(),
      });
      out.push(result);
      // A cap or a switched-off task holds for every town this run: stop here.
      if (error instanceof SpendCapReached || error instanceof TaskDisabled) break;
      continue;
    }
    out.push(result);
  }
  return out;
}

async function discoverForTown(
  deps: DiscoveryDeps,
  town: typeof towns.$inferSelect,
  missing: SourceKind[],
  result: DiscoveryTownResult,
) {
  const { db } = deps;
  const config = town.config as Partial<TownConfig>;
  const have = await db
    .select({ kind: sources.kind, url: sources.url, key: sources.key })
    .from(sources)
    .where(eq(sources.townId, town.id));
  const seen = await db
    .select({ key: sourceProposals.key, url: sourceProposals.url, kind: sourceProposals.kind })
    .from(sourceProposals)
    .where(eq(sourceProposals.townId, town.id));
  const { value } = await callModel(deps.llm!, {
    job: 'sources.discover',
    town: {
      id: town.id,
      timezone: town.timezone,
      aiDailyCapUsd: config.ai_daily_cap_usd ?? 5,
      aiDailyCallCap: config.ai_daily_call_cap ?? 400,
    },
    prompt: discoverV1,
    input: [
      `Town: ${town.name}, ${town.state}`,
      `County: ${town.county} County`,
      `Government: ${(config.agencies ?? []).join('; ')}`,
      config.same_name_elsewhere?.length
        ? `Not to be confused with: ${config.same_name_elsewhere.join('; ')}`
        : null,
      missing.length ? `Most wanted (no source yet): ${missing.join(', ')}` : null,
      have.length
        ? `Already have (don't list these again):\n${have
            .filter((s) => s.url)
            .map((s) => `- ${s.kind}: ${s.url}`)
            .join('\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  const known = new Set([
    ...have.map((s) => `${s.kind} ${s.url}`),
    ...seen.map((s) => `${s.kind} ${s.url}`),
  ]);
  const keys = new Set([...have.map((s) => s.key), ...seen.map((s) => s.key)]);
  const now = deps.now?.() ?? new Date();
  for (const s of value.sources) {
    if (known.has(`${s.kind} ${s.url}`) || !/^https?:\/\//.test(s.url)) continue;
    known.add(`${s.kind} ${s.url}`);
    result.suggested++;
    // Rule 8 in code: fetched once through the polite Fetcher, then matched to an adapter.
    const finding = await verifyUrl(
      deps.fetcher,
      { kind: s.kind, url: s.url, origin: 'model' },
      now,
    );
    if (finding.status === 'blocked' || finding.status === 'unreadable') {
      result.refused++;
      continue;
    }
    if (finding.status === 'matched') {
      for (const { label, ...config } of finding.sources) {
        const key = sourceKey(config);
        if (keys.has(key)) continue;
        keys.add(key);
        const estimate = await estimateItemsPerDay(
          db,
          { platform: config.platform, kind: config.kind },
          now,
        );
        await db
          .insert(sourceProposals)
          .values({
            townId: town.id,
            type: 'source',
            key,
            kind: config.kind,
            url: config.url ?? s.url,
            platform: config.platform,
            config,
            label,
            origin: `discover (${s.publisher}: ${s.why})`.slice(0, 500),
            detail: finding.detail,
            estimatePerDay: estimate.perDay,
            estimateBasis: estimate.basis,
          })
          .onConflictDoNothing();
        result.proposed++;
      }
      continue;
    }
    // Unknown platform, or a known one without this kind of feed: an adapter request.
    const key = `adapter:${s.kind}:${s.url}`;
    if (keys.has(key)) continue;
    keys.add(key);
    await db
      .insert(sourceProposals)
      .values({
        townId: town.id,
        type: 'adapter',
        key,
        kind: s.kind,
        url: s.url,
        platform: finding.platform ?? finding.hint,
        label: `${finding.platform ?? finding.hint ?? 'Unknown platform'}: ${s.publisher}`.slice(
          0,
          200,
        ),
        origin: `discover (${s.why})`.slice(0, 500),
        detail: finding.detail,
        estimatePerDay: null,
        estimateBasis: 'An adapter must be built first (a Claude Code session)',
      })
      .onConflictDoNothing();
    result.adapterRequests++;
  }
}
