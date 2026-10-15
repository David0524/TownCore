import type { TownConfig } from '@towncore/config';
import { articles, eq, getSourceRecords, towns } from '@towncore/db';
import type { CheckedClaim } from '@towncore/pipeline';
import { notFound } from 'next/navigation';
import { minorOverridable, reviewReasonLabel } from '@/lib/admin/review';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';
import styles from '../../admin.module.css';
import { approveArticle, overrideMinorFlag, rejectArticle, saveEdits } from '../actions';

export const metadata = { title: 'Review story' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
};

type Factcheck = {
  method?: string;
  score?: number;
  decision?: string;
  claims?: CheckedClaim[];
  wrongTownRisk?: boolean;
  wrongTownReason?: string | null;
  recheck?: { unsupportedClaims: string[]; wrongTownRisk: boolean; wrongTownReason: string | null };
};

const errors: Record<string, string> = {
  state: 'This story is no longer waiting for that action.',
  reason: 'Give a reason for rejecting it.',
  empty: 'Headline and body are required.',
  role: 'Only admins can override a Tier 4 flag.',
};

export default async function ReviewStory({ params, searchParams }: Props) {
  await requireStaff();
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db()
    .select({ article: articles, town: towns })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articles.id, id));
  if (!row) notFound();
  const { article, town } = row;
  const sources = await getSourceRecords(db(), article.sourceRecordIds);
  const factcheck = (article.factcheck ?? {}) as Factcheck;
  const reviewing = article.status === 'in_review';
  const config = town.config as TownConfig;

  return (
    <main>
      <p className={styles.muted}>
        {town.siteName} · {article.beat} · Tier {article.tier} · {article.status}
        {article.reviewReason
          ? ` · ${reviewReasonLabel[article.reviewReason] ?? article.reviewReason}`
          : ''}
      </p>
      {done ? (
        <p className={styles.notice} role="status">
          {done === 'saved'
            ? 'Edits saved. Check the results below before approving.'
            : `Done: ${done}.`}
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {errors[error] ?? error}
        </p>
      ) : null}

      <div className={styles.split}>
        <section aria-label="Draft">
          <h1>{article.headline}</h1>
          {article.dek ? <p className={styles.muted}>{article.dek}</p> : null}
          <p className={styles.muted}>By {article.byline}</p>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(article.bodyMd) }} />

          {reviewing ? (
            <>
              <div className={styles.actions}>
                <form action={approveArticle}>
                  <input type="hidden" name="id" value={article.id} />
                  <button className={styles.button} type="submit">
                    Approve and publish as &ldquo;Reviewed by an editor&rdquo;
                  </button>
                </form>
              </div>
              <form action={rejectArticle} className={styles.form}>
                <input type="hidden" name="id" value={article.id} />
                <label htmlFor="reason">Reject: reason (kept in the audit log)</label>
                <input id="reason" name="reason" required />
                <div>
                  <button className={`${styles.button} ${styles.secondary}`} type="submit">
                    Reject
                  </button>
                </div>
              </form>
              <details>
                <summary>Edit the story</summary>
                <form action={saveEdits} className={styles.form}>
                  <input type="hidden" name="id" value={article.id} />
                  <label htmlFor="headline">Headline</label>
                  <input id="headline" name="headline" defaultValue={article.headline} required />
                  <label htmlFor="dek">Dek</label>
                  <input id="dek" name="dek" defaultValue={article.dek ?? ''} />
                  <label htmlFor="bodyMd">Body (Markdown)</label>
                  <textarea id="bodyMd" name="bodyMd" rows={16} defaultValue={article.bodyMd} />
                  <div>
                    <button className={`${styles.button} ${styles.secondary}`} type="submit">
                      Save edits and re-check
                    </button>
                  </div>
                </form>
              </details>
            </>
          ) : null}

          {article.status === 'blocked' && minorOverridable(article) ? (
            <form action={overrideMinorFlag} className={styles.actions}>
              <input type="hidden" name="id" value={article.id} />
              <button className={`${styles.button} ${styles.secondary}`} type="submit">
                The flagged person is not a minor: send to review (admin)
              </button>
            </form>
          ) : null}
        </section>

        <aside aria-label="Checks and sources">
          <div className={styles.panel}>
            <h2>Why this tier</h2>
            <ul>
              {(article.tierReasons ?? []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <h2>Fact-check</h2>
            <p>
              {factcheck.method === 'template'
                ? 'Built in code from the records; no model wrote it.'
                : `Score ${factcheck.score ?? '–'} · decision ${factcheck.decision ?? '–'}`}
            </p>
            {factcheck.wrongTownRisk ? (
              <p className={styles.bad}>Wrong-town risk: {factcheck.wrongTownReason}</p>
            ) : null}
            {factcheck.recheck ? (
              <div data-testid="recheck">
                <h3>After your edits</h3>
                {factcheck.recheck.unsupportedClaims.length === 0 ? (
                  <p>✓ Every name and number is in a cited record.</p>
                ) : (
                  <ul>
                    {factcheck.recheck.unsupportedClaims.map((c) => (
                      <li key={c} className={styles.bad}>
                        ✗ {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <ul className={styles.claims} data-testid="claims">
              {(factcheck.claims ?? []).map((claim, i) => (
                <li key={i}>
                  <span className={claim.supported ? undefined : styles.bad}>
                    {claim.supported ? '✓ Supported' : '✗ Unsupported'}:
                  </span>{' '}
                  {claim.claim}
                  {claim.quote ? <q> {claim.quote} </q> : null}
                  {claim.problem ? <span className={styles.muted}> ({claim.problem})</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <h2>Sources</h2>
          {sources.map((s) => (
            <div key={s.id} className={`${styles.panel} ${styles.source}`}>
              <p>
                <strong>{s.title}</strong>
                <br />
                <span className={styles.muted}>
                  Record {s.id}
                  {s.url ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={s.url} rel="noreferrer">
                        original
                      </a>
                    </>
                  ) : null}
                </span>
              </p>
              <div className={styles.record}>{s.text}</div>
            </div>
          ))}
          <p className={styles.muted}>Agencies on file: {config.agencies.join('; ')}</p>
        </aside>
      </div>
    </main>
  );
}
