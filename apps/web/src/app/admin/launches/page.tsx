import { candidateStates, listCandidates, type Candidate } from '@towncore/launcher/candidates';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { decideCandidateAction } from './actions';

export const metadata = { title: 'Launches' };

type Figures = {
  population2025: number;
  growthPct: number;
  households: number | null;
  medianIncome: number | null;
  businessValue: number;
  nearestTown: { name: string; miles: number } | null;
};

const num = (n: number | null | undefined) =>
  n == null ? '–' : Math.round(n).toLocaleString('en-US');
const STATUSES = ['proposed', 'approved', 'rejected', 'live'] as const;

// Admin → Launches (M7, CLAUDE.md §10a): the ranked towns from `pnpm towns:rank`. A launch can
// start only from a town an admin approved here. Launch runs and go-live come in later M7 PRs.
export default async function Launches({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; status?: string; done?: string; error?: string }>;
}) {
  const me = await requireStaff();
  const params = await searchParams;
  const states = await candidateStates(db());
  const state = params.state && states.includes(params.state) ? params.state : states[0];
  const status = STATUSES.find((s) => s === params.status);
  const rows = state ? await listCandidates(db(), { state, status, limit: 50 }) : [];

  return (
    <main>
      <h1>Launches</h1>
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

      <h2>Candidate towns</h2>
      <p className={styles.muted}>
        Ranked by <code>pnpm towns:rank</code> from Census data (CLAUDE.md §10a). A town can be
        launched only after an admin approves it here. Source readiness and news coverage are
        neutral until they can be measured, so read the score as a shortlist, not a verdict.
        {me.role === 'admin' ? null : ' Only admins can approve or reject.'}
      </p>
      {states.length === 0 ? (
        <p>
          No towns ranked yet. Run <code>pnpm towns:rank FL</code>.
        </p>
      ) : (
        <form className={styles.filters} method="get">
          <label>
            State
            <select name="state" defaultValue={state}>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={status ?? ''}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.button}>
            Show
          </button>
        </form>
      )}
      {rows.length ? (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="candidates">
            <thead>
              <tr>
                <th>#</th>
                <th>Town</th>
                <th>Score</th>
                <th>People</th>
                <th>Households × income</th>
                <th>Businesses</th>
                <th>Status</th>
                {me.role === 'admin' ? <th>Decision</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CandidateRow key={c.id} c={c} admin={me.role === 'admin'} state={state!} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

function CandidateRow({ c, admin, state }: { c: Candidate; admin: boolean; state: string }) {
  const f = (c.inputs as { figures: Figures }).figures;
  return (
    <tr>
      <td>{c.rank}</td>
      <td>
        {c.name}, {c.state}
        <div className={styles.muted}>
          {f.nearestTown
            ? `${f.nearestTown.miles} mi from ${f.nearestTown.name}`
            : 'No town of ours nearby'}
        </div>
      </td>
      <td>{c.score.toFixed(3)}</td>
      <td>
        {num(f.population2025)}
        <div className={styles.muted}>
          {f.growthPct >= 0 ? '+' : ''}
          {f.growthPct.toFixed(1)}% since 2020
        </div>
      </td>
      <td>
        {num(f.households)} × ${num(f.medianIncome)}
      </td>
      <td>{num(f.businessValue)}</td>
      <td>
        {c.status}
        {c.note ? <div className={styles.muted}>{c.note}</div> : null}
      </td>
      {admin ? (
        <td>
          {c.status === 'live' ? null : (
            <form action={decideCandidateAction} className={styles.actions}>
              <input type="hidden" name="candidateId" value={c.id} />
              <input type="hidden" name="state" value={state} />
              <input name="note" placeholder="Note (optional)" aria-label={`Note for ${c.name}`} />
              {c.status !== 'approved' ? (
                <button type="submit" name="decision" value="approve" className={styles.button}>
                  Approve {c.name}
                </button>
              ) : null}
              {c.status !== 'rejected' ? (
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className={`${styles.button} ${styles.secondary}`}
                >
                  Reject
                </button>
              ) : null}
              {c.status !== 'proposed' ? (
                <button
                  type="submit"
                  name="decision"
                  value="reopen"
                  className={`${styles.button} ${styles.secondary}`}
                >
                  Undo
                </button>
              ) : null}
            </form>
          )}
        </td>
      ) : null}
    </tr>
  );
}
