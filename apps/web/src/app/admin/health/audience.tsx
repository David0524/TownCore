import { EXPERIMENTS, FUNNEL_ADVICE, FUNNEL_FLOORS, SIGNUP_PLACEMENTS } from '@towncore/config';
import type {
  AudienceGroup,
  ExperimentReport,
  FunnelCounts,
  FunnelRates,
  TownAudience,
} from '@towncore/pipeline';
import { AUDIENCE_DAYS } from '@towncore/pipeline';
import styles from '../admin.module.css';
import { experimentAction } from './actions';

// Admin → Health: audience and self-serve revenue (owner, 2026-10-17), per town, launch cohort
// and platform, and the experiments. All counts are aggregate; no reader is identified.

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 1000) / 10}%`);
const one = (n: number | null) => (n === null ? '–' : (Math.round(n * 10) / 10).toString());
const usd = (n: number | null) => (n === null ? '–' : `$${n.toFixed(0)}`);

const PLACEMENT_LABEL: Record<string, string> = {
  home: 'home',
  article: 'end of story',
  'second-article': 'second story',
  'newsletter-page': 'newsletter page',
  other: 'other',
};

function signupsLine(c: FunnelCounts) {
  const parts = [...SIGNUP_PLACEMENTS, 'other' as const]
    .filter((p) => c.signups[p] > 0)
    .map((p) => `${PLACEMENT_LABEL[p]} ${c.signups[p]}`);
  return parts.length ? parts.join(', ') : 'None';
}

function referralsLine(c: FunnelCounts) {
  const parts = (['facebook', 'search', 'newsletter', 'direct', 'social', 'other'] as const)
    .filter((r) => c.referrals[r] > 0)
    .map((r) => `${r} ${c.referrals[r]}`);
  return parts.length ? parts.join(', ') : 'None';
}

function Advice({ rates }: { rates: FunnelRates }) {
  if (rates.advice.length === 0) return null;
  return (
    <ul className={styles.muted} data-testid="funnel-advice">
      {rates.advice.map((a) => (
        <li key={a}>{FUNNEL_ADVICE[a]}</li>
      ))}
    </ul>
  );
}

function FunnelCells({ counts, rates }: { counts: FunnelCounts; rates: FunnelRates }) {
  return (
    <>
      <td>
        {one(rates.subscribersPer1k)}
        <div className={styles.muted}>
          {counts.subscribers} active
          {counts.households ? ` / ${counts.households.toLocaleString('en-US')} households` : ''}
        </div>
      </td>
      <td>{signupsLine(counts)}</td>
      <td>
        {counts.views}
        <div className={styles.muted}>{referralsLine(counts)}</div>
      </td>
      <td>{pct(rates.newsletterShare)}</td>
      <td>
        {pct(rates.claimRate)}
        <div className={styles.muted}>
          {counts.claimed} of {counts.listings}
        </div>
      </td>
      <td>{counts.trialStarts}</td>
      <td>
        {pct(rates.trialToPaid)}
        <div className={styles.muted}>
          {counts.trialsConverted} of {counts.trialsEnded} ended
        </div>
      </td>
      <td>{usd(rates.revenuePerTown)}</td>
      <td>
        <Advice rates={rates} />
      </td>
    </>
  );
}

const HEAD = (
  <>
    <th>Subscribers per 1,000 households</th>
    <th>Sign-ups by prompt</th>
    <th>Story views by source</th>
    <th>From the newsletter</th>
    <th>Claim rate</th>
    <th>Trials started</th>
    <th>Trial to paid</th>
    <th>Revenue a month per town</th>
    <th>Where to look</th>
  </>
);

function GroupTable({
  title,
  groups,
  testId,
  note,
}: {
  title: string;
  groups: AudienceGroup[];
  testId: string;
  note?: string;
}) {
  return (
    <>
      <h3>{title}</h3>
      {note ? <p className={styles.muted}>{note}</p> : null}
      <div className={styles.scroll}>
        <table className={styles.table} data-testid={testId}>
          <thead>
            <tr>
              <th>{title.replace(/^By /, '')}</th>
              <th>Towns</th>
              {HEAD}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} data-group={g.key}>
                <td>{g.key}</td>
                <td>
                  {g.counts.towns}
                  {g.counts.townsWithHouseholds < g.counts.towns ? (
                    <div className={styles.muted}>
                      {g.counts.townsWithHouseholds} with households
                    </div>
                  ) : null}
                </td>
                <FunnelCells counts={g.counts} rates={g.rates} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AudienceSection({
  towns,
  cohorts,
  platforms,
  states,
}: {
  towns: TownAudience[];
  cohorts: AudienceGroup[];
  platforms: AudienceGroup[];
  states: AudienceGroup[];
}) {
  return (
    <section aria-labelledby="audience" data-testid="audience">
      <h2 id="audience">Audience and revenue</h2>
      <p className={styles.muted}>
        The last {AUDIENCE_DAYS} days for sign-ups, views and trials; subscribers, claims and
        revenue as of today. Weak marks: under {FUNNEL_FLOORS.subscribersPer1k} subscribers per
        1,000 households, a claim rate under {FUNNEL_FLOORS.claimRate * 100}%, trial to paid under{' '}
        {FUNNEL_FLOORS.trialToPaid * 100}%. Households come from the Census (ACS B11001; pnpm
        towns:households). Return visits aren’t counted: that would mean recognising a browser
        again, which we don’t do (no cookies or ids). Views from the newsletter are the readers we
        know came back.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="audience-towns">
          <thead>
            <tr>
              <th>Town</th>
              {HEAD}
            </tr>
          </thead>
          <tbody>
            {towns.map((t) => (
              <tr key={t.id} data-town={t.siteName}>
                <td>
                  {t.siteName}
                  <div className={styles.muted}>
                    {t.cohort ? `cohort ${t.cohort}` : 'not live'}, {t.platform}, {t.state}
                  </div>
                </td>
                <FunnelCells counts={t.counts} rates={t.rates} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GroupTable
        title="By cohort"
        groups={cohorts}
        testId="audience-cohorts"
        note="The cohort gate (docs/plans/rollout.md): newsletter sign-ups have to be coming in before the next cohort goes out."
      />
      <GroupTable title="By meeting platform" groups={platforms} testId="audience-platforms" />
      <GroupTable title="By state" groups={states} testId="audience-states" />
    </section>
  );
}

const STATUS: Record<string, string> = { off: 'Off', running: 'Running', decided: 'Decided' };

export function ExperimentsSection({
  reports,
  admin,
}: {
  reports: ExperimentReport[];
  admin: boolean;
}) {
  return (
    <section aria-labelledby="experiments" data-testid="experiments">
      <h2 id="experiments">Experiments</h2>
      <p className={styles.muted}>
        Each town (or each launch cohort) gets one variant, chosen by a stable hash; readers are
        never sorted or tracked. Off shows the first variant everywhere; a decided experiment shows
        its winner in every town. No variant changes what the neighbor rule compares.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Experiment</th>
              <th>Status</th>
              <th>Variants: towns, metric</th>
              {admin ? <th>Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.key} data-experiment={r.key}>
                <td>
                  {r.label}
                  <div className={styles.muted}>Judged on {r.metric}</div>
                </td>
                <td data-testid="experiment-status">
                  {STATUS[r.state.status]}
                  {r.state.status === 'running' ? ` by ${r.state.unit}` : ''}
                  {r.state.winner ? <div>Winner: {r.state.winner}</div> : null}
                </td>
                <td>
                  {r.state.status === 'running' ? (
                    <ul>
                      {r.variants.map((v) => (
                        <li key={v.variant} data-variant={v.variant}>
                          {v.variant}: {v.towns} towns, {one(v.value)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    EXPERIMENTS[r.key].variants.join(', ')
                  )}
                </td>
                {admin ? (
                  <td>
                    <ExperimentForms report={r} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExperimentForms({ report }: { report: ExperimentReport }) {
  const running = report.state.status === 'running';
  return (
    <>
      {running ? (
        <>
          <form action={experimentAction} className={styles.form}>
            <input type="hidden" name="key" value={report.key} />
            <input type="hidden" name="op" value="decide" />
            <select name="winner" aria-label="Winner">
              {EXPERIMENTS[report.key].variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button type="submit" className={styles.button}>
              Roll out winner
            </button>
          </form>
          <form action={experimentAction} className={styles.form}>
            <input type="hidden" name="key" value={report.key} />
            <input type="hidden" name="op" value="stop" />
            <button type="submit" className={`${styles.button} ${styles.secondary}`}>
              Stop
            </button>
          </form>
        </>
      ) : (
        <form action={experimentAction} className={styles.form}>
          <input type="hidden" name="key" value={report.key} />
          <input type="hidden" name="op" value="start" />
          <select name="unit" aria-label="Assign by" defaultValue="town">
            <option value="town">By town</option>
            <option value="cohort">By cohort</option>
          </select>
          <button type="submit" className={styles.button}>
            Start
          </button>
        </form>
      )}
    </>
  );
}
