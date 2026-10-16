import {
  and,
  articleLinks,
  articles,
  articleUpdates,
  eq,
  gte,
  inArray,
  ne,
  records,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { namesIn } from './factcheck';
import { titleSimilarity } from './scoring';
import { apDate } from './time';

// Follow-ups (CLAUDE.md §6a): when a record changes or a new one matches a published story,
// add a dated update note to the original story. A record saying charges were dropped always
// produces an update, whatever its score or the day's budget.

/** How far back published stories can receive follow-ups. */
export const FOLLOW_UP_DAYS = 30;
/** Headline similarity at which a new record is about the same story. */
export const SAME_STORY_SIMILARITY = 0.6;
/** Headline similarity at which a new story is related enough to link to an earlier one. */
export const RELATED_SIMILARITY = 0.3;

const DROPPED =
  /\bcharges?\b[^.]{0,80}\b(dropped|dismissed|withdrawn)\b|\b(dropped|dismissed)\b[^.]{0,40}\bcharges?\b|\bnolle pros/i;

export function mentionsDroppedCharges(text: string): boolean {
  return DROPPED.test(text);
}

type PublishedArticle = {
  id: string;
  headline: string;
  bodyMd: string;
  beat: string;
  tier: number;
  sourceRecordIds: string[];
};

export async function recentPublished(
  db: Db,
  townId: string,
  now: Date,
): Promise<PublishedArticle[]> {
  return db
    .select({
      id: articles.id,
      headline: articles.headline,
      bodyMd: articles.bodyMd,
      beat: articles.beat,
      tier: articles.tier,
      sourceRecordIds: articles.sourceRecordIds,
    })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        inArray(articles.status, ['published', 'corrected']),
        gte(articles.publishedAt, new Date(now.getTime() - FOLLOW_UP_DAYS * 86_400_000)),
        // Guides are rewritten when their pages change, never given dated update notes.
        ne(articles.kind, 'guide'),
      ),
    );
}

/**
 * The published story a new record follows up, if any: the same headline, or, for a
 * dropped-charges record, a story naming the same person.
 */
export function matchPublished(
  record: { title: string | null; text: string | null },
  published: PublishedArticle[],
): PublishedArticle | null {
  const title = record.title ?? '';
  const byTitle = published
    .map((a) => ({ a, sim: titleSimilarity(a.headline, title) }))
    .filter((x) => x.sim >= SAME_STORY_SIMILARITY)
    .sort((x, y) => y.sim - x.sim)[0];
  if (byTitle) return byTitle.a;
  if (mentionsDroppedCharges(`${title}\n${record.text ?? ''}`)) {
    const names = new Set(namesIn(`${title}\n${record.text ?? ''}`));
    return (
      published.find((a) => namesIn(`${a.headline}\n${a.bodyMd}`).some((n) => names.has(n))) ?? null
    );
  }
  return null;
}

/** Update candidates for records that changed after a published story cited them. */
export async function createChangedRecordUpdates(
  db: Db,
  townId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const changed = await db
    .select()
    .from(records)
    .where(and(eq(records.townId, townId), gte(records.changedAt, since)));
  if (changed.length === 0) return 0;
  const published = await recentPublished(db, townId, now);
  let created = 0;
  for (const record of changed) {
    for (const article of published.filter((a) => a.sourceRecordIds.includes(record.id))) {
      const [row] = await db
        .insert(storyCandidates)
        .values({
          townId,
          kind: 'update',
          key: `update:${article.id}:${record.id}:${record.contentHash}`,
          title: `Update: ${article.headline}`,
          beat: article.beat,
          recordIds: [record.id],
          proposedTier: article.tier,
          targetArticleId: article.id,
          mustWrite: mentionsDroppedCharges(record.text ?? ''),
          tierReasons: ['a record this story cites has changed'],
          status: 'accepted',
          acceptedAt: now,
        })
        .onConflictDoNothing({ target: [storyCandidates.townId, storyCandidates.key] })
        .returning({ id: storyCandidates.id });
      if (row) created++;
    }
  }
  return created;
}

/** "**Update, Oct. 16, 2026:** …" appended to the story. */
export function updateParagraph(noteMd: string, at: Date, timeZone: string): string {
  const year = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at);
  const [first, ...rest] = noteMd.trim().split(/\n\s*\n/);
  return [`**Update, ${apDate(at, timeZone)}, ${year}:** ${first}`, ...rest].join('\n\n');
}

/** Publishes an update note: appends it to the story and adds its records to the sources. */
export async function applyUpdate(
  db: Db,
  updateId: string,
  opts: { reviewerId?: string; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({ update: articleUpdates, article: articles, town: towns })
    .from(articleUpdates)
    .innerJoin(articles, eq(articleUpdates.articleId, articles.id))
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articleUpdates.id, updateId));
  if (!row) throw new Error(`Unknown update ${updateId}`);
  const { update, article, town } = row;
  const sources = [...new Set([...article.sourceRecordIds, ...update.recordIds])];
  await db
    .update(articles)
    .set({
      bodyMd: `${article.bodyMd.trimEnd()}\n\n${updateParagraph(update.noteMd, now, town.timezone)}`,
      sourceRecordIds: sources,
      updatedAt: now,
    })
    .where(eq(articles.id, article.id));
  await db
    .update(articleUpdates)
    .set({
      status: 'published',
      publishedAt: now,
      reviewerId: opts.reviewerId ?? update.reviewerId,
      reviewReason: null,
    })
    .where(eq(articleUpdates.id, updateId));
}

/**
 * Links a new story to earlier published stories it follows up (§6a "link the two"): related
 * headlines, or the same named people, places or projects. Returns the linked article IDs.
 */
export async function linkRelatedStories(
  db: Db,
  article: { id: string; townId: string; headline: string; bodyMd: string },
  now: Date,
): Promise<string[]> {
  const names = new Set(namesIn(`${article.headline}\n${article.bodyMd}`));
  const related = (await recentPublished(db, article.townId, now)).filter((a) => {
    if (a.id === article.id) return false;
    if (titleSimilarity(a.headline, article.headline) >= RELATED_SIMILARITY) return true;
    const shared = namesIn(`${a.headline}\n${a.bodyMd}`).filter((n) => names.has(n));
    // One shared name is often the town or an agency; two or more is the same subject.
    return shared.length >= 2;
  });
  for (const earlier of related) {
    await db
      .insert(articleLinks)
      .values({ fromArticleId: article.id, toArticleId: earlier.id, kind: 'follow_up' })
      .onConflictDoNothing();
  }
  return related.map((a) => a.id);
}
