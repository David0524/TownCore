import { decidedScores, pendingScores } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { decide } from './actions';

export const metadata = { title: 'Scores' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Scores readers sent in (owner, 2026-10-17), waiting for review. Nothing shows on a site until
// it's approved here; an approved score becomes a game on the town's Sports tab, marked as sent by
// a reader.
export default async function ScoresPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const [pending, decided] = await Promise.all([pendingScores(db()), decidedScores(db())]);
  return (
    <main>
      <h1>Scores</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Score {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p>
        Approve only scores that look real: two real teams, a plausible score, a recent date. Teams
        only: if a team name is a person&apos;s name, reject it (a player may be a minor, §7). Fix a
        team&apos;s spelling before approving if needed.
      </p>
      <h2>Waiting ({pending.length})</h2>
      {pending.length === 0 ? <p>No scores are waiting.</p> : null}
      {pending.map(({ report: r, siteName }) => (
        <section
          key={r.id}
          className={styles.panel}
          data-testid="pending-score"
          style={{ marginBottom: '1.5rem' }}
        >
          <dl>
            <dt>Site</dt>
            <dd>{siteName}</dd>
            <dt>Game</dt>
            <dd>
              {r.level} {r.sport}, {r.playedOn}: {r.away} {r.awayScore} at {r.home} {r.homeScore}
              {r.venue ? ` (${r.venue})` : ''}. Local team:{' '}
              {r.localSide === 'both' ? 'both' : r.localSide === 'home' ? r.home : r.away}.
            </dd>
            <dt>From</dt>
            <dd>
              {r.reporterName} &lt;{r.reporterEmail}&gt;
            </dd>
          </dl>
          <form action={decide} className={styles.form}>
            <input type="hidden" name="id" value={r.id} />
            <label htmlFor={`home-${r.id}`}>Home team (fix the spelling if needed)</label>
            <input id={`home-${r.id}`} name="home" defaultValue={r.home} maxLength={60} />
            <label htmlFor={`away-${r.id}`}>Visiting team</label>
            <input id={`away-${r.id}`} name="away" defaultValue={r.away} maxLength={60} />
            <label htmlFor={`reason-${r.id}`}>Reason, if rejecting (internal)</label>
            <input id={`reason-${r.id}`} name="reason" maxLength={200} />
            <div className={styles.actions}>
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
            </div>
          </form>
        </section>
      ))}
      <h2>Recently decided</h2>
      {decided.length === 0 ? <p>None yet.</p> : null}
      <ul>
        {decided.map(({ report: r, siteName }) => (
          <li key={r.id}>
            {`${siteName}: ${r.away} ${r.awayScore} at ${r.home} ${r.homeScore} (${r.sport}, ${r.playedOn}): ${r.status}${r.rejectReason ? `, ${r.rejectReason}` : ''}`}
          </li>
        ))}
      </ul>
    </main>
  );
}
