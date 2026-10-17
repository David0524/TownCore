import { cache } from 'react';
import {
  GAME_RECORD,
  TOPIC_INDEX_MIN_ARTICLES,
  tropicsBasin,
  type Game,
  type TropicsSnapshot,
  type WeatherSnapshot,
} from '@towncore/config';
import {
  activePinIds,
  and,
  desc,
  engagementByArticle,
  eq,
  getTownWeather,
  getTropics,
  gte,
  inArray,
  listRankableArticles,
  lt,
  articleEntities,
  articles,
  entities,
  images,
  not,
  like,
  records,
  sources,
  sql,
  type Article,
  type RankableArticle,
} from '@towncore/db';
import {
  chooseArticleImage,
  coverIllustration,
  pickLead as pickRankedLead,
  rankArticles,
  type ImageChoice,
} from '@towncore/pipeline';
import { db } from '@/lib/db';
import { dedupeEvents, splitLocation } from '@/lib/events';
import { pickMeetingVideo, type MeetingVideo } from '@/lib/meeting-video';
import { refreshWeatherAfterView } from '@/lib/weather';

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
  refreshWeatherAfterView(townId);
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

/**
 * The National Hurricane Center's latest for the basin whose storms can reach towns in this
 * state (packages/config/src/tropics.ts), or null for inland states and when NHC's data is stale.
 */
export const townTropics = cache(async (state: string): Promise<TropicsSnapshot | null> => {
  const basin = tropicsBasin(state);
  if (!basin) return null;
  return (await getTropics(db(), basin))?.snapshot ?? null;
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

export type UpcomingEvent = {
  id: string;
  title: string;
  when: Date;
  end: Date | null;
  allDay: boolean;
  venue: string | null;
  street: string | null;
  /** The city's own page for the event. */
  url: string | null;
};

/**
 * Events on the town's official event calendars (sources of kind `events`) from now through
 * `days` days, soonest first, one per title and start when calendars overlap.
 */
export const upcomingEvents = cache(
  async (
    townId: string,
    townName: string,
    days = 14,
    limit = 6,
    oncePerTitle = false,
  ): Promise<UpcomingEvent[]> => {
    const now = new Date();
    const rows = await db()
      .select({
        id: records.id,
        title: records.title,
        url: records.url,
        occurredAt: records.occurredAt,
        raw: records.raw,
      })
      .from(records)
      .where(
        and(
          eq(records.townId, townId),
          eq(records.type, 'event'),
          gte(records.occurredAt, now),
          lt(records.occurredAt, new Date(now.getTime() + days * 86_400_000)),
        ),
      )
      .orderBy(records.occurredAt)
      // Calendars overlap (an event can be on three), and recurring programs repeat.
      .limit(Math.min(limit * 12, 2000));
    const events = rows.map((r) => {
      const raw = (r.raw ?? {}) as { end?: string | null; allDay?: boolean; location?: string };
      return {
        id: r.id,
        title: r.title?.trim() || 'Event',
        when: r.occurredAt!,
        end: raw.end ? new Date(raw.end) : null,
        allDay: raw.allDay === true,
        ...splitLocation(raw.location, townName),
        url: r.url,
      };
    });
    return dedupeEvents(events, { oncePerTitle }).slice(0, limit);
  },
);

/**
 * Real published stories (not guides or test fixtures) per beat, all time: list pages with too
 * few stay out of search (owner, 2026-10-17).
 */
export const realStoryCounts = cache(
  async (townId: string): Promise<{ total: number; byBeat: Map<string, number> }> => {
    const rows = await db()
      .select({ beat: articles.beat, n: sql<number>`count(*)::int` })
      .from(articles)
      .where(
        and(
          eq(articles.townId, townId),
          inArray(articles.status, ['published', 'corrected']),
          sql`${articles.kind} <> 'guide'`,
          not(like(articles.slug, 'test-%')),
        ),
      )
      .groupBy(articles.beat);
    return {
      total: rows.reduce((n, r) => n + r.n, 0),
      byBeat: new Map(rows.map((r) => [r.beat, r.n])),
    };
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

/**
 * When a guide's official pages were last all fetched successfully (M4 PR F): the oldest
 * last-good fetch among its sources. None if any of them is failing, so the page never claims
 * a check that didn't happen.
 */
export const guideLastChecked = cache(
  async (article: Pick<Article, 'id' | 'sourceRecordIds'>): Promise<Date | null> => {
    if (article.sourceRecordIds.length === 0) return null;
    const rows = await db()
      .selectDistinct({ health: sources.health, lastOkAt: sources.lastOkAt, id: sources.id })
      .from(records)
      .innerJoin(sources, eq(records.sourceId, sources.id))
      .where(inArray(records.id, article.sourceRecordIds));
    if (rows.length === 0 || rows.some((r) => r.health !== 'ok' || !r.lastOkAt)) return null;
    return new Date(Math.min(...rows.map((r) => r.lastOkAt!.getTime())));
  },
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
    article: Pick<
      Article,
      'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
    >,
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

/**
 * A story's cover on the homepage and in lists: its visual, but never a chart (owner,
 * 2026-10-16). A chart's story is covered by its section illustration, or the title card; the
 * chart itself stays in the article.
 */
export const coverImage = cache(
  async (
    article: Pick<
      Article,
      'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
    >,
    timeZone: string,
  ): Promise<ImageChoice> => {
    const image = await articleImage(article, timeZone);
    if (image.kind !== 'data-graphic') return image;
    return (
      (await coverIllustration(db(), article)) ?? {
        ...image,
        kind: 'typographic-card',
        spec: { type: 'card' },
      }
    );
  },
);

/** The topics a story mentions (M4 PR D), for its "In this story" links. */
export const storyTopics = cache(async (articleId: string) =>
  db()
    .select({ name: entities.name, slug: entities.slug, kind: entities.kind })
    .from(articleEntities)
    .innerJoin(entities, eq(articleEntities.entityId, entities.id))
    .where(eq(articleEntities.articleId, articleId))
    .orderBy(entities.name),
);

/**
 * A topic and its published stories, newest first. `indexable` counts real stories only (test
 * fixtures never count), against the D-M4-5 threshold.
 */
export async function topicPage(townId: string, slug: string) {
  const [entity] = await db()
    .select()
    .from(entities)
    .where(and(eq(entities.townId, townId), eq(entities.slug, slug)));
  if (!entity) return null;
  const stories = await db()
    .select({ article: articles })
    .from(articleEntities)
    .innerJoin(articles, eq(articleEntities.articleId, articles.id))
    .where(
      and(
        eq(articleEntities.entityId, entity.id),
        inArray(articles.status, ['published', 'corrected']),
      ),
    )
    .orderBy(desc(articles.publishedAt));
  const list = stories.map((s) => ({ ...s.article, publishedAt: s.article.publishedAt! }));
  const real = list.filter((a) => !a.slug.startsWith('test-')).length;
  return { entity, stories: list, indexable: real >= TOPIC_INDEX_MIN_ARTICLES };
}

/** Topic pages with enough real stories to be indexed (for the sitemap). */
export async function indexableTopics(townId: string): Promise<string[]> {
  const rows = await db()
    .select({ slug: entities.slug, n: sql<number>`count(*)::int` })
    .from(entities)
    .innerJoin(articleEntities, eq(articleEntities.entityId, entities.id))
    .innerJoin(articles, eq(articleEntities.articleId, articles.id))
    .where(
      and(
        eq(entities.townId, townId),
        inArray(articles.status, ['published', 'corrected']),
        not(like(articles.slug, 'test-%')),
      ),
    )
    .groupBy(entities.slug);
  return rows.filter((r) => r.n >= TOPIC_INDEX_MIN_ARTICLES).map((r) => r.slug);
}

/**
 * The meeting video to embed on a story about a meeting (owner's decision, 2026-10-16): a cited
 * video, the meeting platform's own YouTube link, or the town channel's video of that meeting.
 */
export const storyMeetingVideo = cache(
  async (
    townId: string,
    timeZone: string,
    sourceRecords: Array<
      Pick<typeof records.$inferSelect, 'type' | 'title' | 'occurredAt' | 'raw'>
    >,
  ): Promise<MeetingVideo | null> => {
    const days = sourceRecords.filter((r) => r.occurredAt).map((r) => r.occurredAt!.getTime());
    if (days.length === 0) return pickMeetingVideo(sourceRecords, [], timeZone);
    // Channel videos and the town's meetings within a day of the story's meetings (a video goes
    // to one meeting when a body meets twice in a day).
    const nearby = await db()
      .select({
        type: records.type,
        title: records.title,
        occurredAt: records.occurredAt,
        raw: records.raw,
      })
      .from(records)
      .where(
        and(
          eq(records.townId, townId),
          inArray(records.type, ['meeting-video', 'meeting']),
          gte(records.occurredAt, new Date(Math.min(...days) - 86_400_000)),
          lt(records.occurredAt, new Date(Math.max(...days) + 2 * 86_400_000)),
        ),
      );
    const videos = nearby.filter((r) => r.type === 'meeting-video');
    const meetings = nearby.filter((r) => r.type === 'meeting');
    return pickMeetingVideo(sourceRecords, videos, timeZone, meetings);
  },
);

/**
 * The latest NWS zone forecast as its periods ("Tonight", "Saturday"…), as NWS wrote them, for
 * the weather page. Null without a forecast in the last two days.
 */
export const townForecast = cache(async (townId: string) => {
  const [forecast] = await db()
    .select({ text: records.text, url: records.url, occurredAt: records.occurredAt })
    .from(records)
    .where(and(eq(records.townId, townId), eq(records.type, 'forecast')))
    .orderBy(desc(records.occurredAt))
    .limit(1);
  if (!forecast?.text || !forecast.occurredAt) return null;
  if (Date.now() - forecast.occurredAt.getTime() > 48 * 3_600_000) return null;
  const periods = forecast.text
    .split('\n')
    .map((line) => line.match(/^([^:]+): (.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[1]!, text: m[2]! }));
  return periods.length ? { periods, url: forecast.url, issuedAt: forecast.occurredAt } : null;
});

export type GameItem = Game & { id: string; when: Date; url: string | null };

/**
 * Team games (docs/plans/sports.md) between two dates: schedules and finals from the town's
 * sports sources, in time order. Team level only, so nothing here names a player.
 */
export const townGames = cache(
  async (townId: string, from: Date, to: Date, limit = 200): Promise<GameItem[]> => {
    const rows = await db()
      .select({
        id: records.id,
        url: records.url,
        occurredAt: records.occurredAt,
        raw: records.raw,
      })
      .from(records)
      .where(
        and(
          eq(records.townId, townId),
          eq(records.type, GAME_RECORD),
          gte(records.occurredAt, from),
          lt(records.occurredAt, to),
        ),
      )
      .orderBy(records.occurredAt)
      .limit(limit);
    return rows.map((r) => ({ ...(r.raw as Game), id: r.id, url: r.url, when: r.occurredAt! }));
  },
);
