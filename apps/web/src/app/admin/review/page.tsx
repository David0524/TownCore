import { and, articles, articleUpdates, asc, desc, eq, towns } from '@towncore/db';
import Link from 'next/link';
import { minorOverridable, reviewReasonLabel } from '@/lib/admin/review';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';
import styles from '../admin.module.css';
import { approveUpdate, rejectUpdate } from './actions';

export const metadata = { title: 'Review queue' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const errors: Record<string, string> = {
  state: 'That item is no longer waiting for review.',
  placeholder:
    'A placeholder reviewer can’t approve on a live site. Set your real name in Account.',
};

export default async function ReviewQueue({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const queue = await db()
    .select({ article: articles, town: towns.siteName })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articles.status, 'in_review'))
    .orderBy(asc(articles.createdAt));
  const blocked = (
    await db()
      .select({ article: articles, town: towns.siteName })
      .from(articles)
      .innerJoin(towns, eq(articles.townId, towns.id))
      .where(and(eq(articles.status, 'blocked'), eq(articles.tier, 4)))
      .orderBy(desc(articles.createdAt))
      .limit(50)
  ).filter((row) => minorOverridable(row.article));
  const updates = await db()
    .select({ update: articleUpdates, article: articles, town: towns.siteName })
    .from(articleUpdates)
    .innerJoin(articles, eq(articleUpdates.articleId, articles.id))
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articleUpdates.status, 'in_review'))
    .orderBy(asc(articleUpdates.createdAt));

  return (
    <main>
      <h1>Review queue</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Story {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {errors[error] ?? error}
        </p>
      ) : null}
      {queue.length === 0 ? (
        <p>Nothing waiting for review.</p>
      ) : (
        <table className={styles.table} data-testid="review-queue">
          <thead>
            <tr>
              <th>Story</th>
              <th>Site</th>
              <th>Tier</th>
              <th>Why it&apos;s here</th>
              <th>Fact-check</th>
              <th>Waiting since</th>
            </tr>
          </thead>
          <tbody>
            {queue.map(({ article, town }) => {
              const score = (article.factcheck as { score?: number } | null)?.score;
              return (
                <tr key={article.id}>
                  <td>
                    <Link href={`/admin/review/${article.id}`}>{article.headline}</Link>
                  </td>
                  <td>{town}</td>
                  <td>{article.tier}</td>
                  <td>{reviewReasonLabel[article.reviewReason ?? ''] ?? article.reviewReason}</td>
                  <td>{score === undefined ? '–' : score.toFixed(2)}</td>
                  <td>{article.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {updates.length > 0 ? (
        <section aria-label="Updates waiting" data-testid="update-queue">
          <h2>Updates to published stories</h2>
          {updates.map(({ update, article, town }) => (
            <div key={update.id} className={`${styles.panel} ${styles.source}`}>
              <p>
                <strong>{article.headline}</strong>{' '}
                <span className={styles.muted}>
                  ({town} · Tier {update.tier} ·{' '}
                  {reviewReasonLabel[update.reviewReason ?? ''] ?? update.reviewReason})
                </span>
              </p>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(update.noteMd) }} />
              {(
                (update.factcheck as { unsupportedClaims?: string[] } | null)?.unsupportedClaims ??
                []
              ).map((claim) => (
                <p key={claim} className={styles.bad}>
                  ✗ {claim}
                </p>
              ))}
              <div className={styles.actions}>
                <form action={approveUpdate}>
                  <input type="hidden" name="updateId" value={update.id} />
                  <button className={styles.button} type="submit">
                    Add update to the story
                  </button>
                </form>
                <form action={rejectUpdate}>
                  <input type="hidden" name="updateId" value={update.id} />
                  <button className={`${styles.button} ${styles.secondary}`} type="submit">
                    Reject update
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {blocked.length > 0 ? (
        <>
          <h2>Blocked: possible minor</h2>
          <p className={styles.muted}>
            Tier 4 only because a minor may be named. An admin can send one to review if the flag is
            wrong (for example, an adult described as a former student).
          </p>
          <ul>
            {blocked.map(({ article, town }) => (
              <li key={article.id}>
                <Link href={`/admin/review/${article.id}`}>{article.headline}</Link>{' '}
                <span className={styles.muted}>({town})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
