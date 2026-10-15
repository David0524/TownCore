import { desc, eq, skippedCandidates, storyCandidates, towns } from '@towncore/db';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { writeAnyway } from '../review/actions';

export const metadata = { title: 'Skip log' };

// The story finder's skip log (CLAUDE.md §6a): what wasn't written and why.
const NEVER = new Set(['tier4', 'other_outlet']);

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function SkipLog({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const rows = await db()
    .select({ skip: skippedCandidates, candidate: storyCandidates, town: towns.siteName })
    .from(skippedCandidates)
    .innerJoin(storyCandidates, eq(skippedCandidates.candidateId, storyCandidates.id))
    .innerJoin(towns, eq(storyCandidates.townId, towns.id))
    .orderBy(desc(skippedCandidates.createdAt))
    .limit(200);
  return (
    <main>
      <h1>Skip log</h1>
      <p className={styles.muted}>
        The last 200 candidates the story finder didn&apos;t write. &ldquo;Write it anyway&rdquo;
        queues one for the writer; it still goes through fact-check and the tier rules.
      </p>
      {done ? (
        <p className={styles.notice} role="status">
          Queued for the writer; it runs within 30 minutes.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          That candidate can&apos;t be written.
        </p>
      ) : null}
      <table className={styles.table} data-testid="skip-log">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Site</th>
            <th>Reason</th>
            <th>Score</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ skip, candidate, town }) => (
            <tr key={skip.id}>
              <td>
                {candidate.title ?? candidate.key}
                <br />
                <span className={styles.muted}>{skip.detail}</span>
              </td>
              <td>{town}</td>
              <td>{skip.reason.replace(/_/g, ' ')}</td>
              <td>{candidate.newsworthiness ?? '–'}</td>
              <td>
                {NEVER.has(skip.reason) ? null : (
                  <form action={writeAnyway}>
                    <input type="hidden" name="candidateId" value={candidate.id} />
                    <button className={`${styles.button} ${styles.secondary}`} type="submit">
                      Write it anyway
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
