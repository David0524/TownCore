import { cache } from 'react';
import type { WeatherSnapshot } from '@towncore/config';
import {
  activePinIds,
  and,
  desc,
  engagementByArticle,
  eq,
  getTownWeather,
  gte,
  inArray,
  listRankableArticles,
  lt,
  images,
  records,
  sources,
  sql,
  type Article,
  type RankableArticle,
} from '@towncore/db';
import {
  chooseArticleImage,
  pickLead as pickRankedLead,
  rankArticles,
  type ImageChoice,
} from '@towncore/pipeline';
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

/** The town's forecast point ("lat,lon" on its NWS source), for the sunset tile. */
export const townPoint = cache(async (townId: string): Promise<[number, number] | null> => {
  const rows = await db()
    .select({ config: sources.config })
    .from(sources)
    .where(and(eq(sources.townId, townId), eq(sources.platform, 'nws')));
  for (const { config } of rows) {
    const point = (config as { point?: unknown } | null)?.point;
    const match = typeof point === 'string' && point.match(/^(-?[\d.]+),(-?[\d.]+)$/);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return null;
});

export type UpcomingMeeting = {
  id: string;
  title: string;
  when: Date;
  where: string | null;
  url: string | null;
};

/** Public meetings on the town's calendar in the next `days` days, soonest first. */
export const upcomingMeetings = cache(
  async (townId: string, days = 7, limit = 5): Promise<UpcomingMeeting[]> => {
    const now = new Date();
    const rows = await db()
      .select({
        id: records.id,
        title: records.title,
        text: records.text,
        url: records.url,
        occurredAt: records.occurredAt,
      })
      .from(records)
      .where(
        and(
          eq(records.townId, townId),
          eq(records.type, 'meeting'),
          gte(records.occurredAt, now),
          lt(records.occurredAt, new Date(now.getTime() + days * 86_400_000)),
        ),
      )
      .orderBy(records.occurredAt)
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      title: r.title ?? 'Public meeting',
      when: r.occurredAt!,
      where: r.text?.match(/^Where: (.*)$/m)?.[1] ?? null,
      url: r.url,
    }));
  },
);

/** Published stories per beat in the last `days` days, for the section buttons. */
export async function beatCounts(townId: string, days = 7): Promise<Map<string, number>> {
  const since = Date.now() - days * 86_400_000;
  const counts = new Map<string, number>();
  for (const article of await recentArticles(townId)) {
    if (article.publishedAt.getTime() >= since) {
      counts.set(article.beat, (counts.get(article.beat) ?? 0) + 1);
    }
  }
  return counts;
}

/** How many stories the Today band's "Also today" list takes after the lead. */
export const ALSO_TODAY = 3;

/**
 * Splits the ranked stories between the front-page modules a theme uses, so no story shows
 * twice: the lead, the Today band's "Also today" list, then everything else.
 */
export function frontSplit(articles: RankableArticle[], modules: readonly string[]) {
  const lead = modules.includes('lead-story') ? pickLead(articles) : undefined;
  const rest = articles.filter((a) => a.id !== lead?.id);
  // With a Briefs column (heritage) or a briefing-led front (community) the short items are
  // already on the page, so Today doesn't repeat them.
  const also =
    modules.includes('today-bento') &&
    !modules.includes('briefs') &&
    !modules.includes('briefing-column')
      ? rest.slice(0, ALSO_TODAY)
      : [];
  return { lead, also, rest: rest.slice(also.length) };
}

/** The town's sources (kind and platform), for "where this beat's stories come from". */
export const townSources = cache(async (townId: string) =>
  db()
    .select({ kind: sources.kind, platform: sources.platform })
    .from(sources)
    .where(eq(sources.townId, townId)),
);

/** The city's own recent releases, newest first, linked to the city's pages. */
export const cityPostings = cache(async (townId: string, limit = 5) => {
  const rows = await db()
    .select({ id: records.id, title: records.title, url: records.url, at: records.occurredAt })
    .from(records)
    .where(and(eq(records.townId, townId), eq(records.type, 'release')))
    .orderBy(desc(records.occurredAt))
    .limit(limit);
  return rows.filter((r) => r.title && r.url && r.at) as Array<{
    id: string;
    title: string;
    url: string;
    at: Date;
  }>;
});

/**
 * The article's visual (§11c): the router's recorded choice, or, for an article published before
 * the router existed, the same choice computed now (not saved; the backfill records it).
 */
export const articleImage = cache(
  async (
    article: Pick<Article, 'id' | 'headline' | 'beat' | 'kind' | 'sourceRecordIds'>,
    timeZone: string,
  ): Promise<ImageChoice> => {
    const [row] = await db().select().from(images).where(eq(images.articleId, article.id));
    if (row) {
      return {
        kind: row.kind,
        spec: row.spec,
        alt: row.alt,
        license: row.license,
        attribution: row.attribution,
        sourceUrl: row.sourceUrl,
      };
    }
    return chooseArticleImage(db(), article, timeZone);
  },
);
