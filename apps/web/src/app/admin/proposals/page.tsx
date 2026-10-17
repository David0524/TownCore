import {
  estimateLabel,
  listSourceProposals,
  type SourceProposal,
} from '@towncore/launcher/source-proposals';
import { listProposals, type Proposal } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { decideProposalAction, decideSourceAction } from './actions';

export const metadata = { title: 'Proposals' };
export const dynamic = 'force-dynamic';

// Admin → Proposals (owner, 2026-10-17; docs/plans/agentic-ops.md): one inbox for the decisions
// the agents prepare. The learning loops (experiment winners, model routing from evals, cohort
// gates) and the source-discovery agent write here; a person approves or rejects in one click.

const KIND_LABEL: Record<Proposal['kind'], string> = {
  experiment: 'Experiment winner',
  routing: 'Model routing',
  cohort_gate: 'Cohort gate',
  pricing: 'Pricing',
};

export default async function Proposals({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const me = await requireStaff();
  const admin = me.role === 'admin';
  const params = await searchParams;
  const [open, decided, sources] = await Promise.all([
    listProposals(db(), { status: 'open' }),
    listProposals(db(), { limit: 30 }),
    listSourceProposals(db(), { status: 'proposed' }),
  ]);
  const history = decided.filter((p) => p.status !== 'open').slice(0, 15);
  return (
    <main>
      <h1>Proposals</h1>
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
        Agents prepare these; nothing changes until a person decides. Approving an experiment winner
        shows it in every town. A routing change is code: approving records the decision, and the
        diff ships in a pull request. A cohort gate is advice for starting the next cohort in
        Launches.
      </p>

      <section aria-labelledby="loops" data-testid="learning-proposals">
        <h2 id="loops">From the learning loops</h2>
        {open.length === 0 ? <p>Nothing waits.</p> : null}
        {open.map((p) => (
          <div key={p.id} className={styles.panel} data-proposal={p.key}>
            <h3>
              <span className={styles.badge}>{KIND_LABEL[p.kind]}</span> {p.title}
            </h3>
            <p>{p.summary}</p>
            <ProposalDetail p={p} />
            {admin ? (
              <form action={decideProposalAction} className={styles.actions}>
                <input type="hidden" name="id" value={p.id} />
                <input name="note" placeholder="Note (optional)" aria-label="Note" />
                <button type="submit" name="decision" value="approve" className={styles.button}>
                  Approve
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className={`${styles.button} ${styles.secondary}`}
                >
                  Reject
                </button>
              </form>
            ) : (
              <p className={styles.muted}>Only admins decide these.</p>
            )}
          </div>
        ))}
        {history.length ? (
          <>
            <h3>Decided</h3>
            <ul>
              {history.map((p) => (
                <li key={p.id}>
                  {p.status}: {p.title}{' '}
                  <span className={styles.muted}>
                    {p.decidedAt?.toISOString().slice(0, 10) ??
                      p.updatedAt.toISOString().slice(0, 10)}
                    {p.note ? `, “${p.note}”` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section id="sources" aria-labelledby="sources-title" data-testid="source-proposals">
        <h2 id="sources-title">New sources</h2>
        <p className={styles.muted}>
          Found weekly by source discovery for towns below the Rule 7 target, largest gap first.
          Every URL was fetched under Rule 8 and matched to an adapter in code. Approving a source
          adds it to the town now (ingest starts on the next tick); run{' '}
          <code>pnpm sources:export</code> to write approved ones into the town YAML for a pull
          request. An approved adapter request is built in a Claude Code session.
        </p>
        {sources.length === 0 ? (
          <p>Nothing waits.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Town</th>
                  <th>What</th>
                  <th>Estimate</th>
                  <th>Found</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <SourceRow key={s.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function ProposalDetail({ p }: { p: Proposal }) {
  const d = p.detail as {
    diff?: string[];
    gates?: Array<{ gate: string; status: string; detail: string }>;
  };
  if (d.diff?.length)
    return (
      <pre className={styles.snippet} data-testid="routing-diff">
        {d.diff.join('\n')}
      </pre>
    );
  if (d.gates?.length)
    return (
      <ul>
        {d.gates.map((g) => (
          <li key={g.gate}>
            {g.status === 'pass' ? '✓' : g.status === 'fail' ? '✗' : '?'} {g.gate}:{' '}
            <span className={styles.muted}>{g.detail}</span>
          </li>
        ))}
      </ul>
    );
  return null;
}

function SourceRow({ s }: { s: SourceProposal }) {
  return (
    <tr data-source={s.url}>
      <td>{s.siteName}</td>
      <td>
        {s.type === 'adapter' ? 'Adapter request: ' : ''}
        {s.label}
        <div className={styles.muted}>
          {s.kind.replace('_', ' ')} ·{' '}
          <a href={s.url} rel="noopener noreferrer" target="_blank">
            {s.url}
          </a>
        </div>
      </td>
      <td>{estimateLabel(s)}</td>
      <td className={styles.muted}>
        {s.detail}
        <div>{s.origin}</div>
      </td>
      <td>
        <form action={decideSourceAction} className={styles.actions}>
          <input type="hidden" name="id" value={s.id} />
          <button type="submit" name="decision" value="approve" className={styles.button}>
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            className={`${styles.button} ${styles.secondary}`}
          >
            Reject
          </button>
        </form>
      </td>
    </tr>
  );
}
