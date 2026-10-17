import { loadEnv, type TownConfig } from '@towncore/config';
import { asc, ne, towns } from '@towncore/db';
import { canPostToPage, facebookBatch } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { decideFacebookPost } from './actions';
import { CopyButton } from './CopyButton';

export const metadata = { title: 'Facebook' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const DONE: Record<string, string> = {
  posted: 'Posted to Facebook.',
  marked: 'Marked as posted.',
  skipped: 'Skipped.',
};

// Facebook (owner, 2026-10-17): each live town's best stories of the day and its weekly roundups,
// queued by the worker, grouped by cohort so staff post every town in one pass. Copy the text and
// post it by hand, then mark it; or press Post where the town's page has a token. Nothing is
// posted without a press here unless the owner turns on FACEBOOK_AUTOPOST.
export default async function FacebookPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const batch = await facebookBatch(db());
  const groups = new Map<string, typeof batch>();
  for (const item of batch) {
    const key = `${item.town.cohort ?? 'No cohort'} · ${item.town.county} County, ${item.town.state}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const allTowns = await db()
    .select({ siteName: towns.siteName, status: towns.status, config: towns.config })
    .from(towns)
    .where(ne(towns.status, 'paused'))
    .orderBy(asc(towns.siteName));
  const missing = allTowns.filter((t) => !(t.config as Partial<TownConfig>).facebook);
  const autopost = loadEnv().FACEBOOK_AUTOPOST === 'on';

  return (
    <main>
      <h1>Facebook</h1>
      {done && DONE[done] ? (
        <p className={styles.notice} role="status">
          {DONE[done]}
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p>
        Today&apos;s posts for every town: up to three of its best stories a day, plus its weekly
        roundups. Post each one to the town&apos;s page, then mark it. Automatic posting is{' '}
        <strong data-testid="autopost">{autopost ? 'on (owner approved)' : 'off'}</strong>.
      </p>
      <h2>Waiting ({batch.length})</h2>
      {batch.length === 0 ? <p>Nothing is waiting.</p> : null}
      {[...groups].map(([group, items]) => (
        <section key={group} className={styles.panel} style={{ marginBottom: '1.5rem' }}>
          <h3>{group}</h3>
          {items.map(({ post, town }) => {
            const graph = town.status === 'live' && canPostToPage(town.facebook?.page_id);
            return (
              <article
                key={post.id}
                data-testid="facebook-post"
                style={{ borderTop: '1px solid var(--muted)', padding: '0.75rem 0' }}
              >
                <p className={styles.muted}>
                  {town.siteName} · {post.kind === 'daily' ? 'Top story' : 'Weekly roundup'} ·{' '}
                  {post.day}
                  {town.facebook ? (
                    <>
                      {' · '}
                      <a href={town.facebook.url} target="_blank" rel="noopener noreferrer">
                        Open page
                      </a>
                    </>
                  ) : (
                    ' · no Facebook page yet'
                  )}
                </p>
                <p style={{ whiteSpace: 'pre-line' }}>{post.message}</p>
                <p>
                  <a href={post.link} target="_blank" rel="noopener noreferrer">
                    {post.link}
                  </a>
                </p>
                <div className={styles.actions}>
                  <CopyButton
                    text={`${post.message}\n\n${post.link}`}
                    className={`${styles.button} ${styles.secondary}`}
                  />
                  {graph ? (
                    <form action={decideFacebookPost}>
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="action" value="post" />
                      <button className={styles.button} type="submit">
                        Post
                      </button>
                    </form>
                  ) : null}
                  <form action={decideFacebookPost}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="action" value="mark" />
                    <button className={styles.button} type="submit">
                      Mark as posted
                    </button>
                  </form>
                  <form action={decideFacebookPost}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="action" value="skip" />
                    <button className={`${styles.button} ${styles.secondary}`} type="submit">
                      Skip
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </section>
      ))}
      <h2>Towns without a Facebook page ({missing.length})</h2>
      {missing.length === 0 ? (
        <p>Every town has its page.</p>
      ) : (
        <>
          <p>
            Create these pages in one batch per cohort, then add each page&apos;s address and id as{' '}
            <code>facebook:</code> in the town&apos;s YAML (docs/plans/facebook.md).
          </p>
          <ul data-testid="facebook-missing">
            {missing.map((t) => (
              <li key={t.siteName}>
                {t.siteName} ({t.status})
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
