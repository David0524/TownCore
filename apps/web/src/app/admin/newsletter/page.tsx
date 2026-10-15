import {
  and,
  asc,
  desc,
  eq,
  mailDomains,
  newsletterIssues,
  sql,
  subscribers,
  towns,
} from '@towncore/db';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';

export const metadata = { title: 'Newsletter' };

// Admin → Newsletter (M5): every town with a mail domain, its mode and its latest issue.
export default async function Newsletter() {
  await requireStaff();
  const rows = await db()
    .select({ town: towns, domain: mailDomains })
    .from(mailDomains)
    .innerJoin(towns, eq(towns.id, mailDomains.townId))
    .orderBy(asc(towns.siteName));
  const latest = await Promise.all(
    rows.map(async ({ town }) => {
      const [issue] = await db()
        .select()
        .from(newsletterIssues)
        .where(eq(newsletterIssues.townId, town.id))
        .orderBy(desc(newsletterIssues.date))
        .limit(1);
      const [count] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(subscribers)
        .where(and(eq(subscribers.townId, town.id), eq(subscribers.status, 'active')));
      return { issue, active: count?.n ?? 0 };
    }),
  );
  return (
    <main>
      <h1>Newsletter</h1>
      {rows.length === 0 ? <p>No town has a mail domain yet.</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="newsletter-towns">
          <thead>
            <tr>
              <th>Town</th>
              <th>Mode</th>
              <th>Send time</th>
              <th>Last issue</th>
              <th>Active subscribers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ town, domain }, i) => {
              const { issue, active } = latest[i]!;
              return (
                <tr key={town.id}>
                  <td>
                    <Link href={`/admin/newsletter/${town.slug}`}>{town.siteName}</Link>
                  </td>
                  <td>{domain.newsletterMode}</td>
                  <td>
                    {(town.config as { newsletter_send_time?: string }).newsletter_send_time ?? '–'}{' '}
                    ({town.timezone})
                  </td>
                  <td>
                    {issue
                      ? `${issue.date} · ${issue.skippedReason ? `skipped: ${issue.skippedReason}` : (issue.mode ?? '')}`
                      : '–'}
                  </td>
                  <td>{active}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
