import { mailHealthSnapshot, rate, SES_REVIEW, type StreamTotals } from '@towncore/mail';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../../admin.module.css';
import { Pill } from '../../Pill';

export const metadata = { title: 'Mail health' };
export const dynamic = 'force-dynamic';

// Admin → Mail health (docs/plans/MAIL.md, Mail-6): one page that answers "is anything on
// fire?" — open alerts first, then the SES account, every domain per stream, and the pipeline.

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const when = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '–';

function StreamCells({ s }: { s: StreamTotals | undefined }) {
  if (!s || !s.sent) return <td colSpan={4}>–</td>;
  return (
    <>
      <td className={styles.num}>{s.sent.toLocaleString('en-US')}</td>
      <td className={styles.num}>{s.delivered.toLocaleString('en-US')}</td>
      <td className={styles.num}>{rate(s.bounced, s.sent)}</td>
      <td className={styles.num}>{rate(s.complained, s.sent)}</td>
    </>
  );
}

export default async function MailHealth() {
  await requireStaff();
  const h = await mailHealthSnapshot(db());
  const critical = h.alerts.filter((a) => a.severity === 'critical');
  const stale = !h.lastHeartbeat || Date.now() - new Date(h.lastHeartbeat).getTime() > 10 * 60_000;
  return (
    <main>
      <header className={styles.pageHead}>
        <div>
          <h1>Mail health</h1>
          <p className={styles.muted}>
            Alerts first, then the SES account, each domain and the pipeline.
          </p>
        </div>
        <Pill tone={stale || critical.length ? 'red' : h.alerts.length ? 'amber' : 'green'}>
          {stale || critical.length
            ? 'Needs attention'
            : h.alerts.length
              ? 'Warnings'
              : 'All clear'}
        </Pill>
      </header>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Sent, 7 days</div>
          <div className={styles.statValue}>{h.account7d.sent.toLocaleString('en-US')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Bounce rate</div>
          <div className={styles.statValue}>{rate(h.account7d.bounced, h.account7d.sent)}</div>
          <div className={styles.statNote}>Bulk pauses at 4%</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Complaint rate</div>
          <div className={styles.statValue}>{rate(h.account7d.complained, h.account7d.sent)}</div>
          <div className={styles.statNote}>Bulk pauses at 0.08%</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Bulk mail, every town</div>
          <div className={styles.statValue}>
            <Pill status={h.network ? 'paused' : 'running'} />
          </div>
        </div>
      </div>

      <section aria-labelledby="fire" data-testid="fire">
        <h2 id="fire">Is anything on fire?</h2>
        {h.alerts.length === 0 && !stale ? (
          <p className={styles.notice} role="status">
            All clear. No open alerts.
          </p>
        ) : (
          <ul className={styles.alerts} role="alert">
            {stale ? (
              <li>
                <strong data-severity="critical">CRITICAL</strong> The worker hasn’t checked in
                since {when(h.lastHeartbeat)}: nothing is being sent, received or checked.
              </li>
            ) : null}
            {h.alerts.map((a) => (
              <li key={a.id}>
                <strong data-severity={a.severity}>{a.severity.toUpperCase()}</strong> {a.message}{' '}
                <span className={styles.muted}>since {when(a.firstSeenAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {critical.length ? (
          <p className={styles.muted}>
            Procedures for each alert are in <code>docs/mail/RUNBOOK.md</code>.
          </p>
        ) : null}
      </section>

      <h2>SES account</h2>
      <div className={styles.scroll}>
        <table className={`${styles.table} ${styles.keyValue}`} data-testid="account">
          <tbody>
            <tr>
              <th>Status</th>
              <td>
                {h.account
                  ? `${h.account.enforcementStatus} · production access ${h.account.productionAccess ? 'yes' : 'no (sandbox)'} · checked ${when(h.account.checkedAt)}`
                  : 'Not checked yet (needs AWS credentials)'}
              </td>
            </tr>
            <tr>
              <th>Last 24 hours</th>
              <td>
                {h.account?.max24HourSend != null
                  ? `${h.account.sentLast24Hours ?? 0} of ${h.account.max24HourSend} · max ${h.account.maxSendRate}/s`
                  : '–'}
              </td>
            </tr>
            <tr>
              <th>Bounces, 7 days</th>
              <td>
                {rate(h.account7d.bounced, h.account7d.sent)} of {h.account7d.sent} · bulk pauses at
                4% · SES reviews at {pct(SES_REVIEW.bounceRate)}
              </td>
            </tr>
            <tr>
              <th>Complaints, 7 days</th>
              <td>
                {rate(h.account7d.complained, h.account7d.sent)} · bulk pauses at 0.08% · SES
                reviews at {pct(SES_REVIEW.complaintRate)}
              </td>
            </tr>
            <tr>
              <th>Bulk mail, every town</th>
              <td>{h.network ? `Paused: ${h.network.reason}` : 'Running'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Domains (last 7 days)</h2>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="domains-health">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Status</th>
              <th>Bulk</th>
              <th className={styles.num}>Replies sent</th>
              <th className={styles.num}>Delivered</th>
              <th className={styles.num}>Bounces</th>
              <th className={styles.num}>Complaints</th>
              <th className={styles.num}>Bulk sent</th>
              <th className={styles.num}>Delivered</th>
              <th className={styles.num}>Bounces</th>
              <th className={styles.num}>Complaints</th>
            </tr>
          </thead>
          <tbody>
            {h.domains.map(({ domain: d, streams }) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/admin/mail/domains/${encodeURIComponent(d.name)}`}>
                    <strong>{d.name}</strong>
                  </Link>
                </td>
                <td>
                  <Pill status={d.status} />
                </td>
                <td>
                  <Pill status={d.bulkStatus} />
                  <div className={`${styles.muted} ${styles.small}`}>
                    {d.bulkStatus === 'warming'
                      ? `Day ${d.warmupDay}, ${d.bulkDailyCap.toLocaleString('en-US')} a day`
                      : ''}
                    {d.pausedReason ?? ''}
                  </div>
                </td>
                <StreamCells s={streams.conversational} />
                <StreamCells s={streams.bulk} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>DMARC reports (last 30 days)</h2>
      {h.dmarc.length === 0 ? (
        <p className={styles.muted} data-testid="dmarc">
          No reports yet. They arrive at DMARC_REPORT_ADDRESS once receivers start sending them
          (usually a day after a domain goes live).
        </p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="dmarc">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Reports</th>
                <th>Messages</th>
                <th>DMARC pass</th>
                <th>DKIM pass</th>
                <th>SPF pass</th>
                <th>Failing sources (IP · messages · reported by)</th>
              </tr>
            </thead>
            <tbody>
              {h.dmarc.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td>{d.reports}</td>
                  <td>{d.messages}</td>
                  <td>{rate(d.dmarcPass, d.messages)}</td>
                  <td>{rate(d.dkimPass, d.messages)}</td>
                  <td>{rate(d.spfPass, d.messages)}</td>
                  <td>
                    {d.failing.length
                      ? d.failing
                          .map((f) => `${f.ip} · ${f.count} · ${f.reporters.join(', ')}`)
                          .join('; ')
                      : 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Pipeline</h2>
      <p data-testid="pipeline">
        Mail events waiting: {h.events.pending}
        {h.events.oldestPending ? ` (oldest ${when(h.events.oldestPending)})` : ''} · failed:{' '}
        {h.events.failed} · worker last checked in {when(h.lastHeartbeat)}
      </p>
    </main>
  );
}
