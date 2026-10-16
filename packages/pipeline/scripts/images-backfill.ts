// pnpm images:backfill: records a visual (CLAUDE.md §11c) for every published or in-review article
// that doesn't have one yet, e.g. articles written before the image router existed. Idempotent.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { and, articles, createDb, eq, images, inArray, isNull } from '@towncore/db';
import { assignArticleImage } from '../src';

loadDotEnv();
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const missing = await db
    .select({ id: articles.id, slug: articles.slug })
    .from(articles)
    .leftJoin(images, eq(images.articleId, articles.id))
    .where(
      and(isNull(images.id), inArray(articles.status, ['published', 'corrected', 'in_review'])),
    );
  let n = 0;
  for (const article of missing) {
    const choice = await assignArticleImage(db, article.id);
    console.log(`${article.slug}: ${choice.kind}`);
    n++;
  }
  console.log(`Recorded ${n} image(s).`);
} finally {
  await db.$client.end();
}
