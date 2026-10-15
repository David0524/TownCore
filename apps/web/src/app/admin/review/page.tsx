import { and, articles, asc, desc, eq, towns } from '@towncore/db';
import Link from 'next/link';
import { minorOverridable, reviewReasonLabel } from '@/lib/admin/review';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';

export const metadata = { title: 'Review queue' };

type Props = { searchParams: Promise<{ done?: string }> };

export default async function ReviewQueue({ searchParams }: Props) {
  await requireStaff();
  const { done } = await searchParams;
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

  return (
    <main>
      <h1>Review queue</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Story {done}.
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
