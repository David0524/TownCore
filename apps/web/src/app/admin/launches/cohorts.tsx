import type { Candidate } from '@towncore/launcher/candidates';
import {
  batchedTodos,
  cohortStageLabels,
  type CohortRow,
  type CohortTownRow,
} from '@towncore/launcher/cohorts';
import type { Proposal } from '@towncore/pipeline';
import styles from '../admin.module.css';
import {
  approveCohortGoLiveAction,
  approveCohortPurchaseAction,
  cohortPicksAction,
  cohortTodoAction,
  createCohortAction,
  retryCohortTownAction,
} from './actions';

// Admin → Launches → Cohorts (owner, 2026-10-17; docs/plans/agentic-ops.md). Every town's place in
// the chain and its to-dos, batched for one pass per cohort. The two decisions are one click
// each: the domains at the stated total (typed back, Rule 10), and go-live.

const money = (n: number) => `$${n.toFixed(2)}`;

export function CohortsSection({
  cohorts,
  candidates,
  gate,
  admin,
}: {
  cohorts: CohortRow[];
  candidates: Candidate[];
  gate: Proposal | null;
  admin: boolean;
}) {
  return (
    <section id="cohorts" aria-labelledby="cohorts-title" data-testid="cohorts">
      <h2 id="cohorts-title">Launch cohorts</h2>
      <p className={styles.muted}>
        Each finished step starts the next: names and prices → one approval of the domains at their
        stated total → purchase → mail onboarding (SES and DNS; a conflict becomes a to-do, never an
        overwrite) → DNS verification and warm-up → site provisioning → draft review → one approval
        to go live. The newsletter keeps its own off → test → live switch, and production deploys
        stay with a person.
      </p>
      {gate ? (
        <p className={styles.notice} data-testid="cohort-gate">
          Last cohort gate: {gate.title} ({gate.status}). See Proposals.
        </p>
      ) : null}
      {cohorts.length === 0 ? <p>No cohorts yet.</p> : null}
      {cohorts.map((c) => (
        <CohortCard key={c.id} c={c} admin={admin} />
      ))}
      {admin ? <NewCohort candidates={candidates} /> : null}
    </section>
  );
}

function NewCohort({ candidates }: { candidates: Candidate[] }) {
  if (!candidates.length)
    return (
      <p className={styles.muted}>
        No approved town is waiting for a cohort. Approve towns in the ranked list below first.
      </p>
    );
  return (
    <form action={createCohortAction} className={styles.panel} data-testid="new-cohort">
      <h3>Start a cohort</h3>
      <label>
        Name <input name="name" required placeholder="2026-11" aria-label="Cohort name" />
      </label>
      <fieldset>
        <legend>Approved towns</legend>
        {candidates.map((c) => (
          <label key={c.id} className={styles.check}>
            <input type="checkbox" name="candidateId" value={c.id} /> {c.name}, {c.state} (#
            {c.rank})
          </label>
        ))}
      </fieldset>
      <label className={styles.check}>
        <input type="checkbox" name="spend" value="yes" /> Buy domains when approved (otherwise a
        dry run: nothing is bought, mail onboarding is only planned)
      </label>
      <button type="submit" className={styles.button}>
        Start cohort
      </button>
    </form>
  );
}

function CohortCard({ c, admin }: { c: CohortRow; admin: boolean }) {
  const naming = c.status === 'awaiting_purchase' && !c.purchaseApproval;
  const todos = batchedTodos(c);
  return (
    <div className={styles.panel} data-cohort={c.name}>
      <h3>
        Cohort {c.name} <span className={styles.badge}>{c.status.replace(/_/g, ' ')}</span>
        {c.dryRun ? <span className={styles.badge}>dry run</span> : null}
      </h3>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Town</th>
              <th>Stage</th>
              <th>Name and domain</th>
              <th>To-dos</th>
            </tr>
          </thead>
          <tbody>
            {c.towns.map((t) => (
              <TownRow key={t.id} t={t} admin={admin} naming={naming} cohortId={c.id} />
            ))}
          </tbody>
        </table>
      </div>

      {naming && admin ? (
        <>
          <form action={cohortPicksAction} className={styles.form}>
            <input type="hidden" name="cohortId" value={c.id} />
            {c.towns
              .filter((t) => t.stage === 'names' && t.state === 'done')
              .map((t) => (
                <label key={t.id}>
                  {t.name}
                  <select name={`pick:${t.id}`} defaultValue={String(t.pick)}>
                    {t.choices.map((choice, i) => (
                      <option key={choice.domain} value={i + 1}>
                        {choice.siteName} · {choice.domain} · {money(choice.price)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            <button type="submit" className={`${styles.button} ${styles.secondary}`}>
              Change names
            </button>
          </form>
          <form
            action={approveCohortPurchaseAction}
            className={styles.form}
            data-testid="cohort-purchase"
          >
            <input type="hidden" name="cohortId" value={c.id} />
            <p>
              <strong>Total for this cohort: {money(c.totalUsd)}</strong>{' '}
              {c.dryRun
                ? '(dry run: approving buys nothing)'
                : '(first year; each renews at the price shown in the names report). Approving buys every domain above at its stated price and starts their mail onboarding (SES identities and DNS records).'}
            </p>
            {c.dryRun ? null : (
              <label>
                Type the total to approve
                <input name="total" required inputMode="decimal" placeholder={money(c.totalUsd)} />
              </label>
            )}
            <button type="submit" className={styles.button}>
              {c.dryRun ? 'Approve names (dry run)' : `Approve and buy for ${money(c.totalUsd)}`}
            </button>
          </form>
        </>
      ) : null}

      {todos.length ? (
        <div data-testid="cohort-todos">
          <h4>To-dos for one pass</h4>
          <ul>
            {todos.map((t) => (
              <li key={t.text}>
                {t.text}: {t.towns.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {admin &&
      (c.status === 'awaiting_go_live' || c.status === 'running') &&
      c.towns.some((t) => t.stage === 'review' && t.state === 'waiting') ? (
        <form action={approveCohortGoLiveAction} className={styles.form}>
          <input type="hidden" name="cohortId" value={c.id} />
          <button type="submit" className={styles.button}>
            Approve go-live for the reviewed towns
          </button>
          <span className={styles.muted}>
            Each town is checked again (domain bought, mail live, readiness measured); any that
            fails stays in review with its reasons.
          </span>
        </form>
      ) : null}
    </div>
  );
}

function TownRow({
  t,
  admin,
  naming,
  cohortId,
}: {
  t: CohortTownRow;
  admin: boolean;
  naming: boolean;
  cohortId: string;
}) {
  const choice = t.choices[t.pick - 1];
  const blockers = (t.detail as { blockers?: string[] }).blockers ?? [];
  return (
    <tr data-town={t.name}>
      <td>
        {t.name}, {t.usState}
        {t.town ? <div className={styles.muted}>{t.town.status}</div> : null}
      </td>
      <td>
        {cohortStageLabels[t.stage]}: {t.state}
        {t.error ? <div className={styles.bad}>{t.error}</div> : null}
        {t.stage === 'review' && blockers.length ? (
          <ul className={styles.muted}>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        {admin && t.state === 'failed' ? (
          <form action={retryCohortTownAction}>
            <input type="hidden" name="cohortTownId" value={t.id} />
            <input type="hidden" name="cohortId" value={cohortId} />
            <button type="submit" className={`${styles.button} ${styles.secondary}`}>
              Retry
            </button>
          </form>
        ) : null}
      </td>
      <td>
        {choice ? (
          <>
            {choice.siteName}
            <div className={styles.muted}>
              {choice.domain} · {naming || t.stage !== 'names' ? `$${choice.price.toFixed(2)}` : ''}
              {choice.premium ? ' · premium' : ''}
            </div>
          </>
        ) : (
          '–'
        )}
      </td>
      <td>
        {t.todos.length ? (
          <ul>
            {t.todos.map((todo) => (
              <li key={todo.key}>
                <form action={cohortTodoAction} className={styles.inline}>
                  <input type="hidden" name="cohortTownId" value={t.id} />
                  <input type="hidden" name="key" value={todo.key} />
                  <input type="hidden" name="done" value={String(!todo.done)} />
                  <button type="submit" className={styles.check} aria-pressed={todo.done}>
                    {todo.done ? '✓' : '○'}
                  </button>{' '}
                  {todo.text}
                </form>
              </li>
            ))}
          </ul>
        ) : (
          '–'
        )}
      </td>
    </tr>
  );
}
