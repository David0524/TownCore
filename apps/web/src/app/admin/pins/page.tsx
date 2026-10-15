import { and, articles, desc, eq, gt, gte, inArray, pins, towns } from '@towncore/db';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { pinArticle, unpin } from './actions';

export const metadata = { title: 'Pins' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Pinned stories lead their town's homepage until they expire (CLAUDE.md §6a). Severe weather
// warnings and road closures pin themselves; staff pin and unpin here.
export default async function PinsPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const now = new Date();
  const active = await db()
    .select({ pin: pins, headline: articles.headline, town: towns.siteName })
    .from(pins)
    .innerJoin(articles, eq(pins.articleId, articles.id))
    .innerJoin(towns, eq(pins.townId, towns.id))
    .where(gt(pins.expiresAt, now))
    .orderBy(desc(pins.createdAt));
  const recent = await db()
    .select({ id: articles.id, headline: articles.headline, town: towns.siteName })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(
      and(
        inArray(articles.status, ['published', 'corrected']),
        gte(articles.publishedAt, new Date(now.getTime() - 14 * 86_400_000)),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(100);

  return (
    <main>
      <h1>Pins</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Story {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          Choose a published story and a time between 1 hour and 14 days.
        </p>
      ) : null}
      <h2>Pinned now</h2>
      {active.length === 0 ? (
        <p>Nothing is pinned.</p>
      ) : (
        <table className={styles.table} data-testid="active-pins">
          <thead>
            <tr>
              <th>Story</th>
              <th>Site</th>
              <th>Why</th>
              <th>Until</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map(({ pin, headline, town }) => (
              <tr key={pin.id}>
                <td>{headline}</td>
                <td>{town}</td>
                <td>{pin.createdBy ? pin.reason : `${pin.reason} (automatic)`}</td>
                <td>{pin.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                <td>
                  <form action={unpin}>
                    <input type="hidden" name="pinId" value={pin.id} />
                    <button className={`${styles.button} ${styles.secondary}`} type="submit">
                      Unpin
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Pin a story</h2>
      <form action={pinArticle} className={styles.form}>
        <label htmlFor="articleId">Published story (last 14 days)</label>
        <select id="articleId" name="articleId" required>
          {recent.map((a) => (
            <option key={a.id} value={a.id}>
              {a.town}: {a.headline}
            </option>
          ))}
        </select>
        <label htmlFor="hours">For how many hours</label>
        <input id="hours" name="hours" type="number" min={1} max={336} defaultValue={24} required />
        <label htmlFor="reason">Reason (kept in the audit log)</label>
        <input id="reason" name="reason" placeholder="e.g. major council vote" />
        <div>
          <button className={styles.button} type="submit">
            Pin
          </button>
        </div>
      </form>
    </main>
  );
}
