import { cache } from 'react';
import { listPublishedArticles, type Article } from '@towncore/db';
import { db } from '@/lib/db';

/** Recent published articles for a town, shared by every module in one request. */
export const recentArticles = cache((townId: string): Promise<Article[]> =>
  listPublishedArticles(db(), townId, { limit: 40 }),
);

/** Until the M4 ranking exists, the lead is the newest Tier 1–2 article. */
export function pickLead(articles: Article[]): Article | undefined {
  return articles.find((a) => a.tier <= 2);
}
