import { entityKey, type EntityKind, type TownConfig } from '@towncore/config';
import {
  and,
  articleEntities,
  articleLinks,
  articles,
  desc,
  entities,
  eq,
  inArray,
  isNull,
  or,
  towns,
  type Db,
} from '@towncore/db';
import { entitiesV1, type EntitiesResult } from '@towncore/prompts';
import { llmTown } from './finder';
import { callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import { slugify } from './publish';

// Entities and topic pages (CLAUDE.md §6a; docs/plans/M4.md §4). After a story is published, one
// routine model call lists the named things in it; code keeps only names written verbatim in
// the story, matches them to the town's entities by a conservative key, and links them.

const MAX_PER_ARTICLE = 15;

export type ExtractReport = {
  articles: number;
  linked: number;
  skipped: number;
  capReached: boolean;
};

/** The story's text as readers see it: headline, dek and body. */
const storyText = (a: { headline: string; dek: string | null; bodyMd: string }) =>
  [a.headline, a.dek ?? '', a.bodyMd].join('\n');

/**
 * Keeps the model's answers that are real, verbatim names in the story: written exactly as in
 * the text, not the town itself, not too short, each entity once (by its key).
 */
export function acceptEntities(
  result: EntitiesResult,
  text: string,
  townName: string,
): Array<{ name: string; kind: EntityKind; key: string }> {
  const town = entityKey('agency', townName);
  const seen = new Set<string>();
  const accepted: Array<{ name: string; kind: EntityKind; key: string }> = [];
  for (const { name: raw, kind } of result.entities) {
    const name = raw.trim();
    if (name.length < 3 || !text.includes(name)) continue;
    const key = entityKey(kind, name);
    if (!key || key === town || key === `city of ${town}` || seen.has(`${kind}:${key}`)) continue;
    seen.add(`${kind}:${key}`);
    accepted.push({ name, kind, key });
    if (accepted.length >= MAX_PER_ARTICLE) break;
  }
  return accepted;
}

/** Finds or creates the town's entity for this key, giving a new one a unique slug. */
async function upsertEntity(
  db: Db,
  townId: string,
  e: { name: string; kind: EntityKind; key: string },
): Promise<string> {
  const find = async () =>
    (
      await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.townId, townId), eq(entities.kind, e.kind), eq(entities.key, e.key)))
    )[0]?.id;
  const existing = await find();
  if (existing) return existing;
  const base = slugify(e.name);
  for (const slug of [
    base,
    `${base}-${e.kind}`,
    ...[2, 3, 4, 5].map((n) => `${base}-${e.kind}-${n}`),
  ]) {
    const [row] = await db
      .insert(entities)
      .values({ townId, kind: e.kind, name: e.name, key: e.key, slug })
      .onConflictDoNothing()
      .returning({ id: entities.id });
    if (row) return row.id;
    // Either the key was inserted meanwhile (use it) or the slug is taken (try the next).
    const raced = await find();
    if (raced) return raced;
  }
  throw new Error(`No free slug for entity ${e.kind} "${e.name}"`);
}

/** Links an article to its accepted entities, replacing earlier links. */
export async function linkArticleEntities(
  db: Db,
  article: { id: string; townId: string },
  accepted: Array<{ name: string; kind: EntityKind; key: string }>,
  now = new Date(),
): Promise<number> {
  await db.delete(articleEntities).where(eq(articleEntities.articleId, article.id));
  for (const e of accepted) {
    const entityId = await upsertEntity(db, article.townId, e);
    await db
      .insert(articleEntities)
      .values({ articleId: article.id, entityId, mention: e.name })
      .onConflictDoNothing();
  }
  await db.update(articles).set({ entitiesExtractedAt: now }).where(eq(articles.id, article.id));
  return accepted.length;
}

/**
 * Extracts entities for a town's published stories that haven't been indexed yet, newest
 * first. Code-built items (roundups, alerts) are marked done without a model call: a roundup's
 * dozens of new filings would each make a thin page.
 */
export async function extractEntitiesForTown(
  db: Db,
  llm: Llm,
  townId: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<ExtractReport> {
  const report: ExtractReport = { articles: 0, linked: 0, skipped: 0, capReached: false };
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);
  const pending = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        inArray(articles.status, ['published', 'corrected']),
        isNull(articles.entitiesExtractedAt),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(opts.limit ?? 20);
  for (const article of pending) {
    const now = opts.now ?? new Date();
    if (article.promptVersions?.includes('template') || article.kind !== 'story') {
      await linkArticleEntities(db, article, [], now);
      report.skipped++;
      continue;
    }
    let result: EntitiesResult;
    try {
      ({ value: result } = await callModel(llm, {
        job: 'entities.extract',
        town: llmTown(town, town.config as TownConfig),
        prompt: entitiesV1,
        input: `Town: ${town.name}, ${town.state}\n\n${storyText(article)}`,
      }));
    } catch (error) {
      if (error instanceof SpendCapReached) {
        report.capReached = true;
        return report;
      }
      if (error instanceof LlmOutputError) {
        // Logged in ai_usage; marked done so a bad answer isn't retried every run.
        await linkArticleEntities(db, article, [], now);
        report.skipped++;
        continue;
      }
      throw error;
    }
    // Tier 3 stories can name private people; their people never get a topic page, even if
    // the model calls them officials.
    const accepted = acceptEntities(result, storyText(article), town.name).filter(
      (e) => e.kind !== 'official' || article.tier <= 2,
    );
    report.linked += await linkArticleEntities(db, article, accepted, now);
    report.articles++;
  }
  return report;
}

/**
 * Related coverage for an article page (§4 "Display"): stories linked as related or as
 * follow-ups (M3), then stories sharing the most entities, newest first. Published only.
 */
export async function relatedArticleIds(db: Db, articleId: string, limit = 4): Promise<string[]> {
  const links = await db
    .select({ from: articleLinks.fromArticleId, to: articleLinks.toArticleId })
    .from(articleLinks)
    .where(or(eq(articleLinks.fromArticleId, articleId), eq(articleLinks.toArticleId, articleId)));
  const linked = links.map((l) => (l.from === articleId ? l.to : l.from));

  const mine = await db
    .select({ entityId: articleEntities.entityId })
    .from(articleEntities)
    .where(eq(articleEntities.articleId, articleId));
  const shared = new Map<string, number>();
  if (mine.length > 0) {
    const rows = await db
      .select({ articleId: articleEntities.articleId })
      .from(articleEntities)
      .where(
        inArray(
          articleEntities.entityId,
          mine.map((m) => m.entityId),
        ),
      );
    for (const r of rows) {
      if (r.articleId !== articleId) shared.set(r.articleId, (shared.get(r.articleId) ?? 0) + 1);
    }
  }
  const candidates = [...new Set([...linked, ...shared.keys()])];
  if (candidates.length === 0) return [];
  const published = await db
    .select({ id: articles.id, publishedAt: articles.publishedAt })
    .from(articles)
    .where(
      and(inArray(articles.id, candidates), inArray(articles.status, ['published', 'corrected'])),
    );
  const linkedSet = new Set(linked);
  return published
    .sort(
      (a, b) =>
        Number(linkedSet.has(b.id)) - Number(linkedSet.has(a.id)) ||
        (shared.get(b.id) ?? 0) - (shared.get(a.id) ?? 0) ||
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )
    .slice(0, limit)
    .map((a) => a.id);
}
