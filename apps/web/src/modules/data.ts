import { cache } from 'react';
import type { WeatherSnapshot } from '@towncore/config';
import {
  activePinIds,
  and,
  desc,
  engagementByArticle,
  eq,
  getTownWeather,
  inArray,
  listRankableArticles,
  records,
  sql,
  type Article,
  type RankableArticle,
} from '@towncore/db';
import { pickLead as pickRankedLead, rankArticles } from '@towncore/pipeline';
import { db } from '@/lib/db';

/**
 * The town's published articles in rank order (CLAUDE.md §6a): newsworthiness × freshness ×
 * engagement + pins, then the beat-run and public-safety rules. Shared by every homepage module
 * in one request. Sponsored content is never an input.
 */
export const recentArticles = cache(async (townId: string): Promise<RankableArticle[]> => {
  const [articles, pinned, engagement] = await Promise.all([
    listRankableArticles(db(), townId, { limit: 120 }),
    activePinIds(db(), townId),
    engagementByArticle(db(), townId),
  ]);
  return rankArticles(articles, { now: new Date(), pinned, engagement, limit: 40 });
});

/** One beat's articles in rank order (no diversity rules within a single beat). */
export async function rankedBeatArticles(townId: string, beat: string) {
  const [articles, pinned, engagement] = await Promise.all([
    listRankableArticles(db(), townId, { beat, limit: 100 }),
    activePinIds(db(), townId),
    engagementByArticle(db(), townId),
  ]);
  return rankArticles(articles, { now: new Date(), pinned, engagement, diversity: false });
}

/** The lead: the highest-ranked Tier 1–2 story, or Tier 3 only when a person approved it. */
export function pickLead(articles: RankableArticle[]): RankableArticle | undefined {
  return pickRankedLead(articles);
}

/**
 * What the Today tile shows: the 15-minute NWS snapshot, or, if that's missing or stale, the
 * latest zone forecast we ingested (its first period, as NWS wrote it). Null when the town has
 * neither, e.g. a town without an NWS source.
 */
export type TownWeather =
  | { kind: 'snapshot'; snapshot: WeatherSnapshot }
  | { kind: 'zone'; period: string; text: string; url: string | null; issuedAt: Date };

export const townWeather = cache(async (townId: string): Promise<TownWeather | null> => {
  const fresh = await getTownWeather(db(), townId);
  if (fresh) return { kind: 'snapshot', snapshot: fresh.snapshot };
  const [forecast] = await db()
    .select({ text: records.text, url: records.url, occurredAt: records.occurredAt })
    .from(records)
    .where(and(eq(records.townId, townId), eq(records.type, 'forecast')))
    .orderBy(desc(records.occurredAt))
    .limit(1);
  const first = forecast?.text?.split('\n')[0]?.match(/^([^:]+): (.+)$/);
  if (!forecast || !first || !forecast.occurredAt) return null;
  // Older than a day isn't "today" any more.
  if (Date.now() - forecast.occurredAt.getTime() > 24 * 3_600_000) return null;
  return {
    kind: 'zone',
    period: first[1]!,
    text: first[2]!,
    url: forecast.url,
    issuedAt: forecast.occurredAt,
  };
});

// What a roundup's records are, for its number card ("101 new business filings").
const roundupLabels: Record<string, [string, string]> = {
  'new-filing': ['new business filing', 'new business filings'],
  license: ['new contractor license', 'new contractor licenses'],
  meeting: ['public meeting this week', 'public meetings this week'],
};

/**
 * A roundup's figure: how many records of its main type it cites. Counted from the records
 * themselves, so the card never shows a number the story's sources don't support.
 */
export async function roundupFigure(
  article: Pick<Article, 'kind' | 'sourceRecordIds'>,
): Promise<{ figure: string; label: string } | null> {
  if (article.kind !== 'roundup' || article.sourceRecordIds.length === 0) return null;
  const rows = await db()
    .select({ type: records.type, n: sql<number>`count(*)::int` })
    .from(records)
    .where(inArray(records.id, article.sourceRecordIds))
    .groupBy(records.type);
  const top = rows.sort((a, b) => b.n - a.n)[0];
  const label = top && roundupLabels[top.type];
  if (!top || !label) return null;
  return { figure: top.n.toLocaleString('en-US'), label: top.n === 1 ? label[0] : label[1] };
}
