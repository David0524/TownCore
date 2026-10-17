import { candidateStates, listCandidates, type Candidate } from '@towncore/launcher/candidates';
import { cohortCandidates, listCohorts } from '@towncore/launcher/cohorts';
import { goLiveBlockers, listLaunches, type LaunchRow } from '@towncore/launcher/golive';
import { latestGateDecision } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { approveLaunchAction, decideCandidateAction, pauseTownAction } from './actions';
import { CohortsSection } from './cohorts';

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
// start only from a town an admin approved here; its run (`pnpm launch`) is listed below, and an
// admin approves a ready launch to take the town live (§10 step 9).
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
  const runs = await listLaunches(db());
  const [cohorts, waiting, gate] = await Promise.all([
    listCohorts(db()),
    cohortCandidates(db()),
    latestGateDecision(db()),
  ]);
  const blockers = new Map(
    await Promise.all(
      runs
        .filter((r) => r.status === 'ready')
        .map(async (r) => [r.id, await goLiveBlockers(db(), r.id)] as const),
    ),
  );

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

      <CohortsSection
        cohorts={cohorts}
        candidates={waiting}
        gate={gate}
        admin={me.role === 'admin'}
      />

      <h2>Launch runs</h2>
      <p className={styles.muted}>
        Started with <code>pnpm launch &quot;Town, ST&quot;</code>. A town goes live only when its
        run is ready, every automated check in its launch report passes, its domain was bought and
        its mail domain is live (Rule 10).
      </p>
      {runs.length === 0 ? (
        <p>No launches yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="launch-runs">
            <thead>
              <tr>
                <th>Town</th>
                <th>Run</th>
                <th>Steps</th>
                <th>Report</th>
                <th>Site</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <LaunchRunRow
                  key={r.id}
                  r={r}
                  admin={me.role === 'admin'}
                  blockers={blockers.get(r.id) ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function LaunchRunRow({
  r,
  admin,
  blockers,
}: {
  r: LaunchRow;
  admin: boolean;
  blockers: string[];
}) {
  const done = r.steps.filter((s) => s.status === 'done').length;
  const failed = r.steps.find((s) => s.status === 'failed');
  return (
    <tr data-launch={r.slug}>
      <td>
        {r.name}, {r.state}
        <div className={styles.muted}>
          {r.town ? `${r.town.siteName} · ${r.town.domain}` : 'no town yet'}
        </div>
      </td>
      <td>
        {r.status}
        {r.dryRun ? <div className={styles.muted}>dry run</div> : null}
        {r.stoppedReason ? <div className={styles.muted}>{r.stoppedReason}</div> : null}
      </td>
      <td>
        {done} of {r.steps.length} done
        {failed ? <div className={styles.muted}>Failed: {failed.step}</div> : null}
      </td>
      <td>
        {r.report ? (
          <>
            {r.report.passed ? 'All checks pass' : 'Checks not passing'}
            <ul className={styles.muted}>
              {r.report.checks.map((c) => (
                <li key={c.name}>
                  {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'} {c.name}
                </li>
              ))}
            </ul>
            <div className={styles.muted}>
              <code>docs/launches/{r.slug}/launch-report.md</code>
            </div>
          </>
        ) : (
          '–'
        )}
      </td>
      <td>
        {r.town ? r.town.status : '–'}
        {admin && r.status === 'ready' ? (
          blockers.length ? (
            <ul className={styles.muted} data-testid="go-live-blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <form action={approveLaunchAction} className={styles.actions}>
              <input type="hidden" name="launchId" value={r.id} />
              <button type="submit" className={styles.button}>
                Approve launch: take {r.town?.siteName} live
              </button>
            </form>
          )
        ) : null}
        {admin && r.town && (r.town.status === 'live' || r.town.status === 'paused') ? (
          <form action={pauseTownAction} className={styles.actions}>
            <input type="hidden" name="townId" value={r.town.id} />
            <input type="hidden" name="paused" value={String(r.town.status === 'live')} />
            <button type="submit" className={`${styles.button} ${styles.secondary}`}>
              {r.town.status === 'live' ? `Pause ${r.town.siteName}` : `Resume ${r.town.siteName}`}
            </button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}
