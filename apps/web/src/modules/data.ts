import { cache } from 'react';
import {
  activePinIds,
  engagementByArticle,
  listRankableArticles,
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
