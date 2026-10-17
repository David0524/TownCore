import type { SourceKind, TownConfig } from '@towncore/config';
import {
  and,
  articles,
  eq,
  inArray,
  isNotNull,
  records,
  sources,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { assignArticleImage } from './images';
import { buildTemplate } from './write';

// pnpm roundups:rerender (owner, 2026-10-17: "Roundups that read like articles"): rebuilds a
// town's code-built roundups from their own records with the current templates and rewrites
// them in place: same id, slug and address, published date unchanged, updated date bumped.
// Only roundups built in code (kind "roundup", prompt version "template") are touched; a story a
// model wrote never is. Tier, status and the cited records stay as they were, so the tier rules
// (§7) and Rule 4 hold. A dry run (the default) only reports what would change.

export type RerenderChange = {
  id: string;
  slug: string;
  status: string;
  before: { headline: string; dek: string | null; bodyMd: string };
  after: { headline: string; dek: string; bodyMd: string };
};

export async function rerenderRoundups(
  db: Db,
  townSlug: string,
  opts: { apply?: boolean; now?: Date } = {},
): Promise<{ checked: number; changes: RerenderChange[] }> {
  const now = opts.now ?? new Date();
  const [town] = await db.select().from(towns).where(eq(towns.slug, townSlug));
  if (!town) throw new Error(`unknown town: ${townSlug}`);
  const config = town.config as TownConfig;
  const rows = await db
    .select({ article: articles, key: storyCandidates.key })
    .from(articles)
    .innerJoin(storyCandidates, eq(storyCandidates.id, articles.candidateId))
    .where(
      and(
        eq(articles.townId, town.id),
        eq(articles.kind, 'roundup'),
        sql`'template' = any(${articles.promptVersions})`,
        isNotNull(articles.candidateId),
      ),
    );
  const changes: RerenderChange[] = [];
  for (const { article, key } of rows) {
    if (!key.startsWith('roundup:')) continue;
    const recs = (
      await db
        .select({ record: records, sourceKind: sources.kind })
        .from(records)
        .innerJoin(sources, eq(records.sourceId, sources.id))
        .where(inArray(records.id, article.sourceRecordIds))
    ).map((r) => ({ record: r.record, sourceKind: r.sourceKind as SourceKind }));
    if (!recs.length) continue;
    const draft = await buildTemplate(db, key, town, config, recs);
    if (!draft) continue;
    const same =
      draft.headline === article.headline &&
      draft.dek === article.dek &&
      draft.bodyMd === article.bodyMd;
    if (same) continue;
    changes.push({
      id: article.id,
      slug: article.slug,
      status: article.status,
      before: { headline: article.headline, dek: article.dek, bodyMd: article.bodyMd },
      after: { headline: draft.headline, dek: draft.dek, bodyMd: draft.bodyMd },
    });
    if (opts.apply) {
      await db
        .update(articles)
        .set({
          headline: draft.headline,
          dek: draft.dek,
          bodyMd: draft.bodyMd,
          updatedAt: now,
        })
        .where(eq(articles.id, article.id));
      // The visual's alt text names the headline; a picture a person pinned stays.
      if (article.status !== 'blocked') await assignArticleImage(db, article.id);
    }
  }
  return { checked: rows.length, changes };
}
