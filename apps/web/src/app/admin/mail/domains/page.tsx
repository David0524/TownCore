import { asc, eq, mailDomains, towns } from '@towncore/db';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { Pill } from '../../Pill';

export const metadata = { title: 'Mail domains' };

// Every domain the mail platform receives and sends for (docs/plans/MAIL.md, Mail-1).
// Onboarding runs from the CLI (`pnpm mail:onboard`); this page shows where each domain is.
export default async function MailDomains() {
  await requireStaff();
  const rows = await db()
    .select({ domain: mailDomains, town: towns.name })
    .from(mailDomains)
    .leftJoin(towns, eq(mailDomains.townId, towns.id))
    .orderBy(asc(mailDomains.name));
  return (
    <main>
      <header className={styles.pageHead}>
        <div>
          <h1>Mail domains</h1>
          <p className={styles.muted}>
            Domains are added with <code>pnpm mail:onboard</code> (see docs/mail/RUNBOOK.md).
            Domains waiting on SES are checked every 5 minutes.
          </p>
        </div>
      </header>
      {rows.length === 0 ? (
        <p>No mail domains yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="mail-domains">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Town</th>
                <th>Status</th>
                <th>Inbound</th>
                <th>Bulk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ domain, town }) => (
                <tr key={domain.id}>
                  <td>
                    <Link href={`/admin/mail/domains/${encodeURIComponent(domain.name)}`}>
                      <strong>{domain.name}</strong>
                    </Link>
                    {domain.isTest ? <span className={styles.muted}> (test)</span> : null}
                  </td>
                  <td>{town ?? '–'}</td>
                  <td>
                    <Pill status={domain.status} />
                    {domain.failureReason ? (
                      <>
                        <br />
                        <span className={styles.muted}>{domain.failureReason}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <Pill status={domain.inboundEnabled ? 'on' : 'off'} />
                  </td>
                  <td>
                    <Pill status={domain.bulkStatus} />
                    <div className={`${styles.muted} ${styles.small}`}>
                      {domain.bulkStatus === 'warming'
                        ? `Day ${domain.warmupDay}, ${domain.bulkDailyCap.toLocaleString('en-US')} a day`
                        : ''}
                      {domain.pausedReason ?? ''}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
