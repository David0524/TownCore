import { mailAlerts, isNull, desc } from '@towncore/db';
import { townHealth } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';

export const metadata = { title: 'Health' };
export const dynamic = 'force-dynamic';

// Admin → Health (CLAUDE.md §12; docs/plans/M8.md §1): each town's operations at a glance, over
// the last 7 days unless noted, with every open alert (mail and operations) above the table.

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
const usd = (n: number | null) => (n === null ? '–' : `$${n.toFixed(2)}`);

export default async function Health() {
  await requireStaff();
  const [rows, alerts] = await Promise.all([
    townHealth(db()),
    db()
      .select()
      .from(mailAlerts)
      .where(isNull(mailAlerts.resolvedAt))
      .orderBy(desc(mailAlerts.severity), desc(mailAlerts.firstSeenAt)),
  ]);
  return (
    <main>
      <h1>Health</h1>
      <section aria-labelledby="alerts" data-testid="open-alerts">
        <h2 id="alerts">Open alerts</h2>
        {alerts.length === 0 ? (
          <p>No open alerts.</p>
        ) : (
          <ul>
            {alerts.map((a) => (
              <li key={a.id} data-severity={a.severity}>
                <strong>{a.severity === 'critical' ? 'Critical' : 'Warning'}:</strong> {a.message}{' '}
                <span className={styles.muted}>
                  since {a.firstSeenAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.muted}>
          Alerts open and resolve themselves; admins get them by email. Mail details are in Mail
          health.
        </p>
      </section>

      <h2>Towns</h2>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="town-health">
          <thead>
            <tr>
              <th>Town</th>
              <th>Items a day</th>
              <th>Fact-check pass</th>
              <th>Review queue</th>
              <th>Corrections (30 days)</th>
              <th>Sources</th>
              <th>AI today</th>
              <th>AI per story</th>
              <th>Subscribers</th>
              <th>Paying businesses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} data-town={t.siteName}>
                <td>
                  {t.siteName}
                  <div className={styles.muted}>{t.status}</div>
                </td>
                <td>{t.itemsPerDay}</td>
                <td>{pct(t.factcheckPassRate)}</td>
                <td>
                  {t.review.waiting}
                  {t.review.oldestHours !== null ? (
                    <div className={styles.muted}>oldest {t.review.oldestHours} h</div>
                  ) : null}
                </td>
                <td>{t.corrections30d}</td>
                <td>
                  {t.sources.ok} ok{t.sources.degraded ? `, ${t.sources.degraded} degraded` : ''}
                  {t.sources.broken.length ? (
                    <div>Broken: {t.sources.broken.join(', ')}</div>
                  ) : null}
                </td>
                <td>
                  {usd(t.ai.todayUsd)} <span className={styles.muted}>of {usd(t.ai.capUsd)}</span>
                </td>
                <td>{usd(t.ai.perStoryUsd)}</td>
                <td>{t.subscribers}</td>
                <td>{t.payingBusinesses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
