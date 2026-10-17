import styles from './poll.module.css';

export type PollView = { id: string; question: string; options: string[] };
export type PollTally = { counts: number[]; total: number };

/** Round shares; they may not add to exactly 100. */
function shares(t: PollTally): number[] {
  return t.counts.map((n) => (t.total ? Math.round((n / t.total) * 100) : 0));
}

/** A poll's results as bars, with the vote count. Shown only after the reader voted. */
export function PollResults({
  poll,
  tally,
  chosen,
}: {
  poll: PollView;
  tally: PollTally;
  chosen?: number | null;
}) {
  const pct = shares(tally);
  return (
    <div data-testid="poll-results">
      <ul className={styles.results}>
        {poll.options.map((option, i) => (
          <li key={i} className={styles.result}>
            <span className={styles.bar} style={{ width: `${pct[i]}%` }} aria-hidden="true" />
            <span className={styles.label}>
              {option}
              {chosen === i ? <span className={styles.yours}> · your answer</span> : null}
            </span>
            <span className={styles.pct}>{pct[i]}%</span>
          </li>
        ))}
      </ul>
      <p className={`meta ${styles.note}`}>
        {tally.total === 1 ? '1 vote' : `${tally.total.toLocaleString('en-US')} votes`}. A reader
        poll, not a scientific survey.
      </p>
    </div>
  );
}
