import { asc, ne, towns } from '@towncore/db';
import { listPolls, pollResults } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { addPoll, decide } from './actions';

export const metadata = { title: 'Polls' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Quick polls (owner, 2026-10-17): staff write one opinion question about a local topic per town,
// and a poll shows on the town's homepage only once it's approved, from its first day through its
// last. Never about a named private person. Every decision is audited.
export default async function PollsPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const rows = await listPolls(db());
  const tallies = await Promise.all(
    rows.map(({ poll }) => (poll.status === 'approved' ? pollResults(db(), poll) : null)),
  );
  const townList = await db()
    .select({ id: towns.id, siteName: towns.siteName })
    .from(towns)
    .where(ne(towns.status, 'paused'))
    .orderBy(asc(towns.siteName));
  const now = new Date();
  const state = (p: (typeof rows)[number]['poll']) =>
    p.status !== 'approved'
      ? p.status === 'draft'
        ? 'Waiting for approval'
        : 'Withdrawn'
      : p.endsAt <= now
        ? 'Closed'
        : p.startsAt > now
          ? 'Approved, starts later'
          : 'Running';

  return (
    <main>
      <h1>Polls</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Poll {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p>
        Ask an opinion question about a local topic: a plan, a place, a choice the town is making.
        Never about a named private person, a crime, or anything a reader could be hurt by. A poll
        shows on the homepage once it&apos;s approved; one runs at a time per town.
      </p>
      <h2>Polls</h2>
      {rows.length === 0 ? (
        <p>No polls yet.</p>
      ) : (
        <table className={styles.table} data-testid="polls">
          <thead>
            <tr>
              <th>Site</th>
              <th>Question</th>
              <th>Runs</th>
              <th>State</th>
              <th>Votes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ poll, siteName }, i) => (
              <tr key={poll.id}>
                <td>{siteName}</td>
                <td>
                  {poll.question}
                  <br />
                  <span className={styles.muted}>{poll.options.join(' · ')}</span>
                </td>
                <td>
                  {poll.startsAt.toISOString().slice(0, 10)} to{' '}
                  {poll.endsAt.toISOString().slice(0, 10)}
                </td>
                <td>{state(poll)}</td>
                <td>{tallies[i] ? tallies[i].counts.join(' / ') : '—'}</td>
                <td>
                  {poll.status === 'draft' ? (
                    <form action={decide}>
                      <input type="hidden" name="pollId" value={poll.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className={styles.button} type="submit">
                        Approve
                      </button>
                    </form>
                  ) : null}
                  {poll.status !== 'withdrawn' ? (
                    <form action={decide}>
                      <input type="hidden" name="pollId" value={poll.id} />
                      <input type="hidden" name="decision" value="withdraw" />
                      <button className={`${styles.button} ${styles.secondary}`} type="submit">
                        Withdraw
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>New poll</h2>
      <form action={addPoll} className={styles.form}>
        <label htmlFor="townId">Site</label>
        <select id="townId" name="townId" required>
          {townList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.siteName}
            </option>
          ))}
        </select>
        <label htmlFor="question">Question</label>
        <input id="question" name="question" maxLength={160} required />
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <label htmlFor={`option${i}`}>
              Answer {i}
              {i > 2 ? ' (optional)' : ''}
            </label>
            <input id={`option${i}`} name={`option${i}`} maxLength={60} required={i <= 2} />
          </div>
        ))}
        <label htmlFor="startsOn">First day</label>
        <input id="startsOn" name="startsOn" type="date" required />
        <label htmlFor="endsOn">Last day</label>
        <input id="endsOn" name="endsOn" type="date" required />
        <div>
          <button className={styles.button} type="submit">
            Save as draft
          </button>
        </div>
      </form>
    </main>
  );
}
