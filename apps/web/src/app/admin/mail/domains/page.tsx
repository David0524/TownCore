import { asc, eq, mailDomains, towns } from '@towncore/db';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';

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
      <h1>Mail domains</h1>
      <p className={styles.muted}>
        Domains are added with <code>pnpm mail:onboard</code> (see docs/mail/RUNBOOK.md). Domains
        waiting on SES are checked every 5 minutes.
      </p>
      {rows.length === 0 ? (
        <p>No mail domains yet.</p>
      ) : (
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
                    {domain.name}
                  </Link>
                  {domain.isTest ? <span className={styles.muted}> (test)</span> : null}
                </td>
                <td>{town ?? '–'}</td>
                <td>
                  {domain.status}
                  {domain.failureReason ? (
                    <>
                      <br />
                      <span className={styles.muted}>{domain.failureReason}</span>
                    </>
                  ) : null}
                </td>
                <td>{domain.inboundEnabled ? 'on' : 'off'}</td>
                <td>
                  {domain.bulkStatus.replace('_', ' ')}
                  {domain.bulkStatus === 'warming'
                    ? ` (day ${domain.warmupDay}, ${domain.bulkDailyCap}/day)`
                    : ''}
                  {domain.pausedReason ? ` – ${domain.pausedReason}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
