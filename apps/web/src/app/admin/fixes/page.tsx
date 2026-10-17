import { listFixRequests, type FixRequestRow } from '@towncore/adapters';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { fixRequestAction } from './actions';

export const metadata = { title: 'Adapter fixes' };
export const dynamic = 'force-dynamic';

// Admin → Fixes (owner, 2026-10-17; docs/plans/agentic-ops.md): a broken source gets a fresh
// fixture of its failing fetch, a diagnosis made in code and a fix request. Fixes are written in a
// Claude Code session (docs/ops/adapter-fix-routine.md), never by the pipeline. The same failure on
// one platform in several towns is a platform pattern, fixed once in the adapter.

export default async function Fixes({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; all?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const rows = await listFixRequests(db(), { all: params.all === '1' });
  const platforms = rows.filter((r) => r.scope === 'platform');
  const sources = rows.filter((r) => r.scope === 'source');
  return (
    <main>
      <h1>Adapter fixes</h1>
      {params.done ? (
        <p className={styles.notice} role="status">
          {params.done}
        </p>
      ) : null}
      {params.error ? (
        <p className={styles.notice} role="alert">
          {params.error}
        </p>
      ) : null}
      <p className={styles.muted}>
        Opened by the worker when a source turns broken. A robots.txt refusal is never worked around
        (Rule 8): the fix there is a different allowed source.{' '}
        {params.all === '1' ? (
          <a href="/admin/fixes">Show open only</a>
        ) : (
          <a href="/admin/fixes?all=1">Show closed too</a>
        )}
      </p>

      <h2>Platform patterns</h2>
      {platforms.length === 0 ? (
        <p>None.</p>
      ) : (
        <FixTable rows={platforms} testId="platform-fixes" />
      )}

      <h2>Sources</h2>
      {sources.length === 0 ? (
        <p>No open requests.</p>
      ) : (
        <FixTable rows={sources} testId="source-fixes" />
      )}
    </main>
  );
}

function FixTable({ rows, testId }: { rows: FixRequestRow[]; testId: string }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table} data-testid={testId}>
        <thead>
          <tr>
            <th>Where</th>
            <th>Failure</th>
            <th>Diagnosis</th>
            <th>Fixture</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const exchanges =
              (r.fixture as { exchanges?: Array<{ url: string; status: number }> } | null)
                ?.exchanges ?? [];
            return (
              <tr key={r.id} data-fix={r.platform}>
                <td>
                  {r.scope === 'platform'
                    ? `${r.platform} (${r.towns} towns)`
                    : `${r.siteName ?? '–'}: ${r.sourceKind ?? ''} (${r.platform})`}
                  {r.sourceUrl ? <div className={styles.muted}>{r.sourceUrl}</div> : null}
                  {r.platformRequestId ? (
                    <div className={styles.muted}>Part of a platform pattern</div>
                  ) : null}
                </td>
                <td>
                  {r.failure.replace('_', ' ')}
                  {r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}
                  <div className={styles.muted}>{r.error.slice(0, 200)}</div>
                </td>
                <td>{r.diagnosis}</td>
                <td className={styles.muted}>
                  {exchanges.length
                    ? exchanges.map((e, i) => (
                        <div key={i}>
                          {e.status} {e.url.slice(0, 80)}
                        </div>
                      ))
                    : 'No request reached the host'}
                </td>
                <td>
                  {r.status.replace('_', ' ')}
                  {r.prUrl ? (
                    <div>
                      <a href={r.prUrl}>{r.prUrl.replace('https://github.com/', '')}</a>
                    </div>
                  ) : null}
                  {r.status === 'open' || r.status === 'in_progress' ? (
                    <form action={fixRequestAction} className={styles.form}>
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        name="prUrl"
                        placeholder="Pull request URL"
                        aria-label="Pull request URL"
                      />
                      <input name="note" placeholder="Note" aria-label="Note" />
                      {r.status === 'open' ? (
                        <button
                          type="submit"
                          name="status"
                          value="in_progress"
                          className={`${styles.button} ${styles.secondary}`}
                        >
                          In progress
                        </button>
                      ) : null}
                      <button type="submit" name="status" value="fixed" className={styles.button}>
                        Fixed
                      </button>
                      <button
                        type="submit"
                        name="status"
                        value="dismissed"
                        className={`${styles.button} ${styles.secondary}`}
                      >
                        Dismiss
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
