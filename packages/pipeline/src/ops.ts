import { NETWORK_AI_DAILY_CAP_USD, type TownConfig } from '@towncore/config';
import {
  aiUsage,
  and,
  articles,
  corrections,
  eq,
  gte,
  inArray,
  lt,
  ne,
  placements,
  sources,
  sql,
  subscribers,
  towns,
  workerHeartbeats,
  type Db,
} from '@towncore/db';
import { networkSpendSince, todaysUsage } from './llm';

// Operations (CLAUDE.md §8, §12; docs/plans/M8.md). What the worker alerts staff about, beside
// the mail conditions (same alert table and emails), and the numbers Admin → Health shows.

export type OpsCondition = { key: string; severity: 'warning' | 'critical'; message: string };

/** A story waiting longer than this in review opens an alert (D-M8-3). */
export const REVIEW_WAIT_HOURS = 24;
/** Cost per published story rising this much week over week opens an alert (§8, D-M8-4). */
export const COST_RISE = 0.5;
/** Each week needs at least this many published stories for the comparison to mean anything. */
export const COST_MIN_STORIES = 5;
/** A worker heartbeat older than this means no worker is running. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;

const DAY = 86_400_000;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** AI spend across every town since midnight UTC (the network-wide cap, D-M8-2). */
export async function networkSpendToday(db: Db, now: Date): Promise<number> {
  return networkSpendSince(
    db,
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
}

async function costPerStory(db: Db, townId: string, from: Date, to: Date) {
  const [cost] = await db
    .select({ usd: sql<string>`coalesce(sum(${aiUsage.estCostUsd}), 0)` })
    .from(aiUsage)
    .where(
      and(eq(aiUsage.townId, townId), gte(aiUsage.createdAt, from), lt(aiUsage.createdAt, to)),
    );
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        inArray(articles.status, ['published', 'corrected']),
        ne(articles.kind, 'guide'),
        gte(articles.publishedAt, from),
        lt(articles.publishedAt, to),
      ),
    );
  const stories = count?.n ?? 0;
  return {
    usd: Number(cost?.usd ?? 0),
    stories,
    perStory: stories ? Number(cost?.usd ?? 0) / stories : 0,
  };
}

export async function opsConditions(db: Db, now = new Date()): Promise<OpsCondition[]> {
  const out: OpsCondition[] = [];
  const active = await db.select().from(towns).where(ne(towns.status, 'paused'));

  // Adapter failures: a broken source (3 failed runs in a row).
  const broken = await db
    .select({
      id: sources.id,
      kind: sources.kind,
      platform: sources.platform,
      townId: sources.townId,
    })
    .from(sources)
    .where(eq(sources.health, 'broken'));
  for (const s of broken) {
    const town = active.find((t) => t.id === s.townId);
    if (!town) continue;
    out.push({
      key: `source_broken:${s.id}`,
      severity: town.status === 'live' ? 'critical' : 'warning',
      message: `${town.siteName}: the ${s.kind} source (${s.platform}) is broken: 3 or more runs failed in a row.`,
    });
  }

  for (const town of active) {
    const config = town.config as Partial<TownConfig>;
    // Spend caps (§8): a town that hit its daily cap writes nothing more today.
    const today = await todaysUsage(db, { id: town.id, timezone: town.timezone }, now);
    const capUsd = config.ai_daily_cap_usd ?? 5;
    const capCalls = config.ai_daily_call_cap ?? 400;
    if (today.costUsd >= capUsd || today.calls >= capCalls)
      out.push({
        key: `town_cap:${town.id}`,
        severity: 'warning',
        message: `${town.siteName} reached its daily AI cap (${usd(today.costUsd)} of ${usd(capUsd)}, ${today.calls} of ${capCalls} calls).`,
      });
    // Cost per published story, this week against last week (§8).
    const thisWeek = await costPerStory(db, town.id, new Date(now.getTime() - 7 * DAY), now);
    const lastWeek = await costPerStory(
      db,
      town.id,
      new Date(now.getTime() - 14 * DAY),
      new Date(now.getTime() - 7 * DAY),
    );
    if (
      thisWeek.stories >= COST_MIN_STORIES &&
      lastWeek.stories >= COST_MIN_STORIES &&
      lastWeek.perStory > 0 &&
      thisWeek.perStory > lastWeek.perStory * (1 + COST_RISE)
    )
      out.push({
        key: `cost_per_story:${town.id}`,
        severity: 'warning',
        message: `${town.siteName}: AI cost per published story is ${usd(thisWeek.perStory)} this week, up from ${usd(lastWeek.perStory)} (more than ${COST_RISE * 100}%).`,
      });
  }

  // Review queue: a story waiting more than a day.
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${articles.updatedAt})` })
    .from(articles)
    .where(
      and(
        eq(articles.status, 'in_review'),
        lt(articles.updatedAt, new Date(now.getTime() - REVIEW_WAIT_HOURS * 3_600_000)),
      ),
    );
  if (waiting && waiting.n > 0)
    out.push({
      key: 'review_waiting',
      severity: 'warning',
      message: `${waiting.n} stor${waiting.n === 1 ? 'y has' : 'ies have'} waited in review for more than ${REVIEW_WAIT_HOURS} hours.`,
    });

  const spent = await networkSpendToday(db, now);
  if (spent >= NETWORK_AI_DAILY_CAP_USD)
    out.push({
      key: 'network_cap',
      severity: 'critical',
      message: `The network-wide AI cap is reached for today (${usd(spent)} of ${usd(NETWORK_AI_DAILY_CAP_USD)}): no model calls until midnight UTC.`,
    });

  const [beat] = await db
    .select({ last: sql<Date | null>`max(${workerHeartbeats.lastBeatAt})` })
    .from(workerHeartbeats);
  const last = beat?.last ? new Date(beat.last) : null;
  if (!last || now.getTime() - last.getTime() > HEARTBEAT_STALE_MS)
    out.push({
      key: 'worker_stale',
      severity: 'critical',
      message: last
        ? `No worker heartbeat since ${last.toISOString()}: ingest, writing and mail have stopped.`
        : 'No worker has ever reported a heartbeat.',
    });
  return out;
}

export type TownHealth = {
  id: string;
  siteName: string;
  status: string;
  /** Hidden from search by the kill switch, and the launch cohort it belongs to. */
  searchHidden: boolean;
  cohort: string | null;
  itemsPerDay: number;
  factcheckPassRate: number | null;
  review: { waiting: number; oldestHours: number | null };
  corrections30d: number;
  sources: { ok: number; degraded: number; broken: string[] };
  ai: { todayUsd: number; capUsd: number; perStoryUsd: number | null };
  subscribers: number;
  payingBusinesses: number;
};

/** The numbers on Admin → Health (§12), one row per town that isn't paused. */
export async function townHealth(db: Db, now = new Date()): Promise<TownHealth[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const rows: TownHealth[] = [];
  for (const town of await db
    .select()
    .from(towns)
    .where(ne(towns.status, 'paused'))
    .orderBy(towns.siteName)) {
    const config = town.config as Partial<TownConfig>;
    const stories = await db
      .select({ factcheck: articles.factcheck, kind: articles.kind })
      .from(articles)
      .where(
        and(
          eq(articles.townId, town.id),
          inArray(articles.status, ['published', 'corrected']),
          ne(articles.kind, 'guide'),
          gte(articles.publishedAt, weekAgo),
        ),
      );
    const checked = (
      await db
        .select({ factcheck: articles.factcheck })
        .from(articles)
        .where(
          and(
            eq(articles.townId, town.id),
            eq(articles.kind, 'story'),
            gte(articles.createdAt, weekAgo),
          ),
        )
    ).filter((a) => a.factcheck);
    const passed = checked.filter(
      (a) => (a.factcheck as { decision?: string }).decision === 'pass',
    );
    const [review] = await db
      .select({
        n: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${articles.updatedAt})`,
      })
      .from(articles)
      .where(and(eq(articles.townId, town.id), eq(articles.status, 'in_review')));
    const [fixes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(corrections)
      .innerJoin(articles, eq(corrections.articleId, articles.id))
      .where(
        and(
          eq(articles.townId, town.id),
          gte(corrections.createdAt, new Date(now.getTime() - 30 * DAY)),
        ),
      );
    const src = await db
      .select({ health: sources.health, kind: sources.kind, platform: sources.platform })
      .from(sources)
      .where(eq(sources.townId, town.id));
    const today = await todaysUsage(db, { id: town.id, timezone: town.timezone }, now);
    const week = await costPerStory(db, town.id, weekAgo, now);
    const [subs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscribers)
      .where(and(eq(subscribers.townId, town.id), eq(subscribers.status, 'active')));
    const [paying] = await db
      .select({ n: sql<number>`count(distinct ${placements.businessId})::int` })
      .from(placements)
      .where(and(eq(placements.townId, town.id), eq(placements.status, 'active')));
    rows.push({
      id: town.id,
      siteName: town.siteName,
      status: town.status,
      searchHidden: town.searchHidden,
      cohort: town.cohort,
      itemsPerDay: Math.round((stories.length / 7) * 10) / 10,
      factcheckPassRate: checked.length ? passed.length / checked.length : null,
      review: {
        waiting: review?.n ?? 0,
        oldestHours: review?.oldest
          ? Math.round((now.getTime() - new Date(review.oldest).getTime()) / 3_600_000)
          : null,
      },
      corrections30d: fixes?.n ?? 0,
      sources: {
        ok: src.filter((s) => s.health === 'ok').length,
        degraded: src.filter((s) => s.health === 'degraded').length,
        broken: src.filter((s) => s.health === 'broken').map((s) => `${s.kind} (${s.platform})`),
      },
      ai: {
        todayUsd: today.costUsd,
        capUsd: config.ai_daily_cap_usd ?? 5,
        perStoryUsd: week.stories ? week.perStory : null,
      },
      subscribers: subs?.n ?? 0,
      payingBusinesses: paying?.n ?? 0,
    });
  }
  return rows;
}
