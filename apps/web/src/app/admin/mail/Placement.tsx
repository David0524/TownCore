import type { AdminPillTone } from '@towncore/config';
import { RECORDABLE, type Placement, type PlacementSummary } from '@towncore/mail';
import styles from '../admin.module.css';
import { Pill } from '../Pill';
import { recordPlacementAction, sendPlacementAction } from './deliverability-actions';

// The inbox-placement test on a domain's page (owner, 2026-10-19): one copy of the town's real
// morning email to each of our own seed inboxes, then staff record where each landed.

const TONE: Record<Placement, AdminPillTone> = {
  pending: 'amber',
  inbox: 'green',
  promotions: 'blue',
  spam: 'red',
  missing: 'red',
  not_sent: 'gray',
};
const LABEL: Record<Placement, string> = {
  pending: 'not checked',
  inbox: 'inbox',
  promotions: 'promotions',
  spam: 'spam',
  missing: 'missing',
  not_sent: 'not sent',
};

export function placementTone(s: PlacementSummary | undefined): AdminPillTone {
  if (!s || s.checked === 0) return 'gray';
  if (s.spam || s.missing) return 'red';
  return s.checked < s.sent ? 'amber' : 'green';
}

export function PlacementSection({
  domain,
  summary,
  seeds,
  canSend,
}: {
  domain: { id: string; name: string };
  summary: PlacementSummary | undefined;
  seeds: number;
  canSend: boolean;
}) {
  return (
    <section aria-labelledby="placement" data-testid="placement">
      <h2 id="placement">Inbox placement</h2>
      <p className={styles.muted}>
        Before the town goes live, send one copy of its morning email to each of our{' '}
        {seeds ? `${seeds} ` : ''}seed inboxes and record where it landed. A measurement only: the
        seeds are our own accounts, and a domain can be tested once a day. Copies count in a
        separate stream, never in the domain’s bulk rates.
      </p>
      {summary ? (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Latest test</div>
              <div className={styles.statValue}>
                <Pill tone={placementTone(summary)}>{summary.line}</Pill>
              </div>
              <div className={styles.statNote}>
                {summary.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · each copy
                ends “Placement check {summary.token}”
              </div>
            </div>
          </div>
          <div className={styles.scroll}>
            <table className={styles.table} data-testid="placement-results">
              <thead>
                <tr>
                  <th>Seed inbox</th>
                  <th>Provider</th>
                  <th>Landed in</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((r) => {
                  const p = r.placement as Placement;
                  return (
                    <tr key={r.id} data-seed={r.seed}>
                      <td className={styles.mono}>{r.seed}</td>
                      <td>{r.provider}</td>
                      <td>
                        <Pill tone={TONE[p]}>{LABEL[p]}</Pill>
                        {r.sendError ? <div className={styles.small}>{r.sendError}</div> : null}
                      </td>
                      <td>
                        {p === 'not_sent' ? (
                          '–'
                        ) : (
                          <form action={recordPlacementAction} className={styles.choices}>
                            <input type="hidden" name="name" value={domain.name} />
                            <input type="hidden" name="resultId" value={r.id} />
                            {RECORDABLE.map((choice) => (
                              <button
                                key={choice}
                                name="placement"
                                value={choice}
                                aria-pressed={p === choice}
                              >
                                {LABEL[choice][0]!.toUpperCase() + LABEL[choice].slice(1)}
                              </button>
                            ))}
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {seeds === 0 ? (
        <p className={styles.notice} role="status">
          No seed inboxes yet: set PLACEMENT_SEED_ADDRESSES to our test accounts at Gmail, Outlook,
          Yahoo and the like.
        </p>
      ) : canSend ? (
        <form action={sendPlacementAction} className={styles.actions}>
          <input type="hidden" name="name" value={domain.name} />
          <input type="hidden" name="domainId" value={domain.id} />
          <button className={styles.button} type="submit">
            Send placement test
          </button>
        </form>
      ) : (
        <p className={styles.muted}>The test opens once the domain can send bulk mail.</p>
      )}
    </section>
  );
}
