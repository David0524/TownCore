import type { RecordSource, SourceRecord, Town } from '@towncore/db';
import { formatDay, formatRange, groupSources } from '@/lib/sources';
import styles from './sources.module.css';

// Rule 4: every published article shows links to the records it was written from. Locked: the
// box looks the same in every town (§11a-2). A story built from many records (a roundup of 101
// filings) shows one line per source with its dates and count, its "About this data" note, and
// the full list under a closed "Show all" (owner, 2026-10-17), so the links stay in the page
// without swamping it. A story with one record per source links each record, as before.

const RecordLink = ({ record, town }: { record: SourceRecord; town: Pick<Town, 'timezone'> }) => (
  <>
    {record.url ? (
      <a href={record.url} rel="nofollow noopener" target="_blank">
        {record.title ?? record.type}
      </a>
    ) : (
      (record.title ?? record.type)
    )}
    {/* Date-only records (filings, licenses) read in UTC, so Oct. 5 never shows as Oct. 4. */}
    {record.occurredAt ? ` (${formatDay(record.occurredAt, town.timezone)})` : ''}
  </>
);

export function SourceList({
  town,
  records,
  sources,
}: {
  town: Pick<Town, 'timezone'>;
  records: SourceRecord[];
  sources: RecordSource[];
}) {
  const groups = groupSources(records, sources);
  const many = groups.some((g) => g.records.length > 1);
  return (
    <section className={styles.sources} data-testid="sources">
      <h2>Sources</h2>
      {records.length === 0 ? (
        <p>Source records are being updated.</p>
      ) : (
        <>
          <ul className={styles.groups}>
            {groups.map((g) => {
              const range = formatRange(g.from, g.to, town.timezone);
              const n = g.records.length;
              return (
                <li key={g.key} data-testid="source-group">
                  {n === 1 ? (
                    <RecordLink record={g.records[0]!} town={town} />
                  ) : (
                    <>
                      {g.href ? (
                        <a href={g.href} rel="nofollow noopener" target="_blank">
                          {g.name}
                        </a>
                      ) : (
                        g.name
                      )}
                      {range ? `, ${range}` : ''} ({n.toLocaleString('en-US')} records)
                    </>
                  )}
                  {g.about ? (
                    <span className={styles.about}>
                      <span className={styles.aboutLabel}>About this data:</span> {g.about}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {many ? (
            <details className={styles.all} data-testid="all-sources">
              <summary>Show all {records.length.toLocaleString('en-US')} records</summary>
              <ol>
                {records.map((record) => (
                  <li key={record.id}>
                    <RecordLink record={record} town={town} />
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
