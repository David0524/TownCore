import { loadEnv, type Env, type TownConfig } from '@towncore/config';
import {
  activePinIds,
  and,
  asc,
  engagementByArticle,
  eq,
  facebookPosts,
  inArray,
  listRankableArticles,
  logAdminAction,
  ne,
  storyCandidates,
  towns,
  type Db,
  type RankableArticle,
} from '@towncore/db';
import { rankArticles } from './ranking';
import { isoLocalDate } from './time';

// Facebook (owner, 2026-10-17: "the page auto-posts the town's best 1–3 items a day, plus weekly
// shareable posts"). The worker queues each live town's posts; staff post the day's batch for
// every town in one pass from Admin → Facebook, copying the text or pressing Post (Graph API).
// Posting to social media is an outward action: nothing goes out without a person pressing Post,
// unless the owner grants a standing approval (FACEBOOK_AUTOPOST=on).

/** The day's best items queued per town. */
export const DAILY_POSTS = 3;
/** Town-local hour the day's posts are picked from, once the morning's stories are out. */
export const QUEUE_FROM_HOUR = 10;
/** Roundups worth sharing every week, by their candidate key. */
const SHAREABLE_ROUNDUPS = ['roundup:new-places:', 'roundup:sales:', 'roundup:inspections:'];
/** The Graph API version posts are made with (check Meta's changelog before enabling). */
export const META_GRAPH_VERSION = 'v26.0';

export type FacebookPost = typeof facebookPosts.$inferSelect;

/** Where a post sends readers: the story on the town's own domain, tagged ?ref=facebook. */
export function facebookLink(town: { domain: string }, article: { slug: string; kind: string }) {
  const base = article.kind === 'guide' ? '/guides/' : '/news/';
  return `https://${town.domain}${base}${article.slug}?ref=facebook`;
}

/**
 * The post text, written from the story: its headline and its dek (or first sentence), nothing
 * added. No clickbait, no questions, no emoji; Facebook shows the link preview below it.
 */
export function facebookMessage(article: { headline: string; dek: string | null; bodyMd: string }) {
  const firstSentence = article.bodyMd
    .replace(/^#+ .*$/gm, '')
    .replace(/[*_[\]]|\(https?:[^)]*\)/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s.length > 20);
  const line = (article.dek ?? firstSentence ?? '').trim();
  return [article.headline.trim(), line].filter(Boolean).join('\n\n').slice(0, 600);
}

const localHour = (now: Date, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );

/**
 * Queues today's posts for every live town, from QUEUE_FROM_HOUR local time: its best published
 * items from the last 24 hours in homepage rank order, up to DAILY_POSTS a local day, and any
 * shareable roundup published in the last week. A story is queued once, ever. Returns how many
 * posts were queued.
 */
export async function queueFacebookPosts(db: Db, now = new Date()): Promise<number> {
  let queued = 0;
  for (const town of await db.select().from(towns).where(eq(towns.status, 'live'))) {
    if (localHour(now, town.timezone) < QUEUE_FROM_HOUR) continue;
    const day = isoLocalDate(now, town.timezone);
    const recent = (await listRankableArticles(db, town.id, { limit: 120 })).filter(
      (a) => !a.slug.startsWith('test-'),
    );
    const existing = await db
      .select({
        articleId: facebookPosts.articleId,
        kind: facebookPosts.kind,
        day: facebookPosts.day,
      })
      .from(facebookPosts)
      .where(eq(facebookPosts.townId, town.id));
    const already = new Set(existing.map((r) => r.articleId));
    const dailyLeft =
      DAILY_POSTS - existing.filter((r) => r.kind === 'daily' && r.day === day).length;
    const fresh = (a: RankableArticle, hours: number) =>
      !already.has(a.id) && now.getTime() - a.publishedAt.getTime() <= hours * 3_600_000;

    const [pinned, engagement] = await Promise.all([
      activePinIds(db, town.id, now),
      engagementByArticle(db, town.id, 14, now),
    ]);
    const daily = rankArticles(
      recent.filter((a) => fresh(a, 24)),
      { now, pinned, engagement },
    ).slice(0, Math.max(0, dailyLeft));

    const weekCandidates = recent.filter((a) => fresh(a, 7 * 24) && a.candidateId);
    const keys = weekCandidates.length
      ? await db
          .select({ id: storyCandidates.id, key: storyCandidates.key })
          .from(storyCandidates)
          .where(
            inArray(
              storyCandidates.id,
              weekCandidates.map((a) => a.candidateId!),
            ),
          )
      : [];
    const shareable = new Set(
      keys.filter((k) => SHAREABLE_ROUNDUPS.some((p) => k.key.startsWith(p))).map((k) => k.id),
    );
    const dailyIds = new Set(daily.map((a) => a.id));
    const weekly = weekCandidates.filter(
      (a) => shareable.has(a.candidateId!) && !dailyIds.has(a.id),
    );

    const rows = [
      ...daily.map((a) => ({ a, kind: 'daily' as const })),
      ...weekly.map((a) => ({ a, kind: 'weekly' as const })),
    ].map(({ a, kind }) => ({
      townId: town.id,
      articleId: a.id,
      kind,
      day,
      message: facebookMessage(a),
      link: facebookLink(town, a),
    }));
    if (rows.length) {
      const inserted = await db
        .insert(facebookPosts)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: facebookPosts.id });
      queued += inserted.length;
    }
  }
  return queued;
}

/** The posts waiting to go out, with their town, for Admin → Facebook (oldest day first). */
export async function facebookBatch(db: Db) {
  const rows = await db
    .select({ post: facebookPosts, town: towns })
    .from(facebookPosts)
    .innerJoin(towns, eq(towns.id, facebookPosts.townId))
    .where(and(eq(facebookPosts.status, 'queued'), ne(towns.status, 'paused')))
    .orderBy(
      asc(facebookPosts.day),
      asc(towns.cohort),
      asc(towns.siteName),
      asc(facebookPosts.kind),
    );
  return rows.map(({ post, town }) => ({
    post,
    town: {
      id: town.id,
      siteName: town.siteName,
      status: town.status,
      cohort: town.cohort,
      county: town.county,
      state: town.state,
      facebook: (town.config as Partial<TownConfig>).facebook ?? null,
    },
  }));
}

export class FacebookPostError extends Error {}

/** Staff marked a post as posted by hand, or skipped it. Audited. */
export async function markFacebookPost(
  db: Db,
  input: { postId: string; staffId: string; outcome: 'posted' | 'skipped'; now?: Date },
): Promise<FacebookPost> {
  const now = input.now ?? new Date();
  const [post] = await db
    .update(facebookPosts)
    .set(
      input.outcome === 'posted'
        ? { status: 'posted', method: 'manual', postedBy: input.staffId, postedAt: now }
        : { status: 'skipped', postedBy: input.staffId, postedAt: now },
    )
    .where(and(eq(facebookPosts.id, input.postId), eq(facebookPosts.status, 'queued')))
    .returning();
  if (!post) throw new FacebookPostError('That post was already posted or skipped.');
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.outcome === 'posted' ? 'facebook.mark_posted' : 'facebook.skip',
    target: { type: 'facebook_post', id: post.id },
    detail: { townId: post.townId, articleId: post.articleId },
  });
  return post;
}

type Fetch = typeof fetch;

/** Whether a page has a token to post with (META_PAGE_TOKENS), so Admin can offer Post. */
export function canPostToPage(pageId: string | null | undefined, env: Env = loadEnv()): boolean {
  return !!pageId && !!env.META_PAGE_TOKENS?.[pageId];
}

/**
 * Posts one queued item to the town's page through the Graph API (POST /{page-id}/feed with the
 * message, the link and the page's token). Only when a person pressed Post, or under the owner's
 * standing approval (autopost). Audited.
 */
export async function postToFacebook(
  db: Db,
  input: {
    postId: string;
    /** The staff member who pressed Post; absent only for owner-approved autopost. */
    staffId: string | null;
    fetchImpl?: Fetch;
    env?: Env;
    now?: Date;
  },
): Promise<FacebookPost> {
  const env = input.env ?? loadEnv();
  if (!input.staffId && env.FACEBOOK_AUTOPOST !== 'on')
    throw new FacebookPostError('Automatic posting is off: a person must press Post.');
  const [row] = await db
    .select({ post: facebookPosts, town: towns })
    .from(facebookPosts)
    .innerJoin(towns, eq(towns.id, facebookPosts.townId))
    .where(eq(facebookPosts.id, input.postId));
  if (!row || row.post.status !== 'queued')
    throw new FacebookPostError('That post was already posted or skipped.');
  if (row.town.status !== 'live')
    throw new FacebookPostError(`${row.town.siteName} isn't live; nothing is posted for it.`);
  const page = (row.town.config as Partial<TownConfig>).facebook;
  const token = page ? env.META_PAGE_TOKENS?.[page.page_id] : undefined;
  if (!page || !token)
    throw new FacebookPostError(
      `${row.town.siteName} has no Facebook page token; post it by hand.`,
    );
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${page.page_id}/feed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        message: row.post.message,
        link: row.post.link,
        access_token: token,
      }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.id)
    throw new FacebookPostError(
      `Facebook refused the post: ${body.error?.message ?? `HTTP ${response.status}`}`,
    );
  const now = input.now ?? new Date();
  const [posted] = await db
    .update(facebookPosts)
    .set({
      status: 'posted',
      method: 'graph',
      externalId: body.id,
      postedBy: input.staffId,
      postedAt: now,
    })
    .where(and(eq(facebookPosts.id, row.post.id), eq(facebookPosts.status, 'queued')))
    .returning();
  if (input.staffId)
    await logAdminAction(db, {
      staffId: input.staffId,
      action: 'facebook.post',
      target: { type: 'facebook_post', id: row.post.id },
      detail: { townId: row.town.id, externalId: body.id },
    });
  return posted!;
}

/**
 * Posts every queued item for live towns with a page token, only under the owner's standing
 * approval (FACEBOOK_AUTOPOST=on). Off by default: then it does nothing.
 */
export async function autopostFacebook(
  db: Db,
  opts: { fetchImpl?: Fetch; env?: Env } = {},
): Promise<number> {
  const env = opts.env ?? loadEnv();
  if (env.FACEBOOK_AUTOPOST !== 'on') return 0;
  let posted = 0;
  for (const { post, town } of await facebookBatch(db)) {
    if (town.status !== 'live' || !canPostToPage(town.facebook?.page_id, env)) continue;
    try {
      await postToFacebook(db, { ...opts, env, postId: post.id, staffId: null });
      posted++;
    } catch {
      // Left queued for staff; the batch page shows it.
    }
  }
  return posted;
}
