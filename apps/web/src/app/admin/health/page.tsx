import { mailAlerts, isNull, desc } from '@towncore/db';
import {
  aiSpend,
  byCohort,
  byPlatform,
  byState,
  COVERAGE_DAYS,
  experimentReports,
  groupAudience,
  storyCoverage,
  townAudience,
  townHealth,
} from '@towncore/pipeline';
import { discoveryProgress, type DiscoveryProgress } from '@towncore/launcher/source-proposals';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { searchSwitchAction } from './actions';
import { AudienceSection, ExperimentsSection } from './audience';

export const metadata = { title: 'Health' };
export const dynamic = 'force-dynamic';

// Admin → Health (CLAUDE.md §12; docs/plans/M8.md §1): each town's operations at a glance, over
// the last 7 days unless noted, with every open alert (mail and operations) above the table.

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
const usd = (n: number | null) => (n === null ? '–' : `$${n.toFixed(2)}`);

export default async function Health({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const me = await requireStaff();
  const admin = me.role === 'admin';
  const params = await searchParams;
  const [rows, coverage, alerts, audience, spend, discovery] = await Promise.all([
    townHealth(db()),
    storyCoverage(db()),
    db()
      .select()
      .from(mailAlerts)
      .where(isNull(mailAlerts.resolvedAt))
      .orderBy(desc(mailAlerts.severity), desc(mailAlerts.firstSeenAt)),
    townAudience(db()),
    aiSpend(db()),
    discoveryProgress(db()),
  ]);
  const experiments = await experimentReports(db(), audience);
  return (
    <main>
      <h1>Health</h1>
      {params.done ? (
        <p className={styles.notice} role="status">
          {params.done}
        </p>
      ) : null}
      {params.error ? (
        <p className={styles.notice} role="alert">
          {params.error}
        </p>
      ) : null}
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
              <th>Search</th>
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
                <td data-testid="search-state">
                  {t.searchHidden ? 'Hidden' : 'In search'}
                  {t.cohort ? <div className={styles.muted}>cohort {t.cohort}</div> : null}
                  {admin && t.status === 'live' ? (
                    <form action={searchSwitchAction} className={styles.form}>
                      <input type="hidden" name="townId" value={t.id} />
                      <input type="hidden" name="hidden" value={String(!t.searchHidden)} />
                      <input name="reason" required placeholder="Why" aria-label="Why" />
                      <button type="submit" className={`${styles.button} ${styles.secondary}`}>
                        {t.searchHidden ? 'Show in search' : 'Hide from search'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {admin ? (
        <section aria-labelledby="kill-switch">
          <h2 id="kill-switch">Search kill switch</h2>
          <p className={styles.muted}>
            Hide every town in a launch cohort (the month it went live) from search engines at once,
            or show them again. Readers still reach the sites; hidden towns are noindex everywhere
            and list nothing in their sitemaps. Logged with your reason.
          </p>
          <form action={searchSwitchAction} className={styles.form} data-testid="cohort-switch">
            <input name="cohort" required placeholder="Cohort, e.g. 2027-01" aria-label="Cohort" />
            <input name="reason" required placeholder="Why" aria-label="Why" />
            <select name="hidden" aria-label="Action" defaultValue="true">
              <option value="true">Hide from search</option>
              <option value="false">Show in search</option>
            </select>
            <button type="submit" className={styles.button}>
              Apply to cohort
            </button>
          </form>
        </section>
      ) : null}

      <AudienceSection
        towns={audience}
        cohorts={groupAudience(audience, byCohort)}
        platforms={groupAudience(audience, byPlatform)}
        states={groupAudience(audience, byState)}
      />

      <ExperimentsSection reports={experiments} admin={admin} />

      <h2>AI spend by task</h2>
      <p className={styles.muted} data-testid="ai-spend-summary">
        Last {spend.days} days, every town: {usd(spend.usd)} for {spend.stories} published{' '}
        {spend.stories === 1 ? 'story' : 'stories'} ({usd(spend.perStoryUsd)} a story), cache hit
        rate {pct(spend.cacheHitRate)}. Each task&rsquo;s model and caps are in the routing table
        (packages/config/src/models.ts).
      </p>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="ai-spend">
          <thead>
            <tr>
              <th>Task</th>
              <th>Model</th>
              <th>Calls</th>
              <th>Spend</th>
              <th>A story</th>
              <th>Cache hits</th>
              <th>Escalated</th>
              <th>Batched</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {spend.rows.length ? (
              spend.rows.map((r) => (
                <tr key={`${r.task}:${r.model}`}>
                  <td>{r.task}</td>
                  <td>{r.model}</td>
                  <td>{r.calls}</td>
                  <td>{usd(r.usd)}</td>
                  <td>{usd(r.perStoryUsd)}</td>
                  <td>{pct(r.cacheHitRate)}</td>
                  <td>{r.escalations}</td>
                  <td>{pct(r.batchShare)}</td>
                  <td>{r.failures}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9}>No model calls in the last {spend.days} days.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Stories against the target</h2>
      <p className={styles.muted}>
        Real items published a day over the last {COVERAGE_DAYS} days against the Rule 7 target (3,
        or 10 for large towns), furthest behind first. Close the gap with new sources, never by
        padding: source discovery searches weekly for the towns furthest behind, and its finds wait
        in Proposals.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="story-coverage">
          <thead>
            <tr>
              <th>Town</th>
              <th>A day</th>
              <th>Target</th>
              <th>Gap</th>
              <th>By source</th>
              <th>Skipped</th>
              <th>Sources to build next</th>
              <th>Discovery</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((t) => (
              <tr key={t.id} data-town={t.siteName}>
                <td>
                  {t.siteName}
                  <div className={styles.muted}>
                    {t.status}
                    {t.readiness !== null ? `, launch readiness ${t.readiness}` : ''}
                  </div>
                </td>
                <td>{t.perDay}</td>
                <td>{t.target}</td>
                <td>{t.gap ? t.gap : 'Met'}</td>
                <td>
                  {t.bySource.length
                    ? t.bySource.map((s) => `${s.kind.replace('_', ' ')} ${s.perDay}`).join(', ')
                    : 'None yet'}
                </td>
                <td>
                  {t.skipped.length
                    ? t.skipped.map((s) => `${s.reason.replace(/_/g, ' ')} ${s.count}`).join(', ')
                    : 'None'}
                </td>
                <td>
                  {t.missing
                    .slice(0, 4)
                    .map((k) => k.replace('_', ' '))
                    .join(', ') || 'All'}
                </td>
                <td data-testid="discovery-progress">
                  <DiscoveryCell p={discovery.get(t.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function DiscoveryCell({ p }: { p: ReturnType<Map<string, DiscoveryProgress>['get']> }) {
  if (!p) return <>Not run yet</>;
  return (
    <>
      {p.lastRunAt ? `Last ${p.lastRunAt.toISOString().slice(0, 10)}` : 'Not run yet'}
      <div className={styles.muted}>
        {p.proposed} waiting, {p.approved} approved
        {p.approvedPerDay ? ` (+${p.approvedPerDay} a day estimated)` : ''}
      </div>
    </>
  );
}
