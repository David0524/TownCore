import { and, articles, eq, like, staff, towns, type Db } from '@towncore/db';
import { buildByline } from './byline';
import { assignArticleImage } from './images';

// Publishing (CLAUDE.md §6 step 6). The DB constraints already enforce Rules 2, 4 and 5 on
// every write; this adds the Tier 4 check. Bylines say "Reviewed by an editor" without a name,
// so a staff member who hasn't set their real name can approve on any town.

export class PublishBlocked extends Error {}

export type Reviewer = { id: string; name: string; placeholder: boolean };

export async function getReviewer(db: Db, staffId: string): Promise<Reviewer> {
  const [row] = await db.select().from(staff).where(eq(staff.id, staffId));
  if (!row) throw new PublishBlocked(`Unknown reviewer ${staffId}`);
  return { id: row.id, name: row.name, placeholder: row.placeholder };
}

/** Publishes an article, optionally as reviewed by a staff member. */
export async function publishArticle(
  db: Db,
  articleId: string,
  opts: { reviewer?: Reviewer; now?: Date } = {},
): Promise<void> {
  const [row] = await db
    .select({ article: articles, town: towns })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articles.id, articleId));
  if (!row) throw new PublishBlocked(`Unknown article ${articleId}`);
  const { article, town } = row;
  if (article.tier >= 4) throw new PublishBlocked('Tier 4 stories are never published (Rule 5).');
  await db
    .update(articles)
    .set({
      status: 'published',
      publishedAt: article.publishedAt ?? opts.now ?? new Date(),
      byline: buildByline(town.siteName, Boolean(opts.reviewer)),
      reviewerId: opts.reviewer?.id ?? article.reviewerId,
      reviewReason: null,
    })
    .where(eq(articles.id, articleId));
  // Every published article has a visual (§11c); an edit in review may have changed its sources.
  await assignArticleImage(db, articleId);
}

/** Lowercase ASCII slug from a headline, at most 80 characters. */
export function slugify(headline: string): string {
  return (
    headline
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'story'
  );
}

/** A slug not yet used in this town: "council-budget", then "council-budget-2", … */
export async function uniqueSlug(db: Db, townId: string, headline: string): Promise<string> {
  const base = slugify(headline);
  const taken = new Set(
    (
      await db
        .select({ slug: articles.slug })
        .from(articles)
        .where(and(eq(articles.townId, townId), like(articles.slug, `${base}%`)))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
