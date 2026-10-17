import type { Db } from '@towncore/db';
import { townAudience } from './audience';
import { townHealth } from './ops';

// The gate between launch cohorts (docs/plans/rollout.md): the next cohort goes out only when the
// last one shows zero manual actions, healthy indexing and rising impressions, a steady
// fact-check pass rate with few corrections, and newsletter sign-ups coming in. Each gate is pass,
// fail, or unknown when the data doesn't exist yet: Search Console isn't connected (no Google
// credential), so the search gates are checked by hand until it is.

/** The cohort's fact-check pass rate must be at least this. */
export const GATE_FACTCHECK_MIN = 0.8;
/** Corrections per town over 30 days, at most. */
export const GATE_CORRECTIONS_PER_TOWN = 1;
/** Newsletter sign-ups per town over the audience window, at least. */
export const GATE_SIGNUPS_PER_TOWN = 1;

export type GateStatus = 'pass' | 'fail' | 'unknown';
export type GateResult = { gate: string; status: GateStatus; detail: string };
export type CohortGate = {
  cohort: string;
  towns: number;
  gates: GateResult[];
  /** launch: no gate failed (unknowns are checked by hand); pause: at least one failed. */
  verdict: 'launch' | 'pause';
};

const SEARCH_UNKNOWN =
  'Search Console is not connected yet (no Google credential): check it by hand in Search Console.';

export async function cohortGates(db: Db, now = new Date()): Promise<CohortGate[]> {
  const health = (await townHealth(db, now)).filter((t) => t.status === 'live' && t.cohort);
  const audience = await townAudience(db, now);
  const cohorts = [...new Set(health.map((t) => t.cohort!))].sort();
  return cohorts.map((cohort) => {
    const rows = health.filter((t) => t.cohort === cohort);
    const rates = rows.flatMap((t) => (t.factcheckPassRate === null ? [] : [t.factcheckPassRate]));
    const passRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    const corrections = rows.reduce((n, t) => n + t.corrections30d, 0);
    const signups = audience
      .filter((a) => a.cohort === cohort)
      .reduce((n, a) => n + Object.values(a.counts.signups).reduce((x, y) => x + y, 0), 0);
    const gates: GateResult[] = [
      { gate: 'Zero manual actions', status: 'unknown', detail: SEARCH_UNKNOWN },
      {
        gate: 'Healthy indexing and rising impressions',
        status: 'unknown',
        detail: SEARCH_UNKNOWN,
      },
      passRate === null
        ? {
            gate: 'Steady fact-check pass rate',
            status: 'unknown',
            detail: 'No fact-checked stories this week.',
          }
        : {
            gate: 'Steady fact-check pass rate',
            status: passRate >= GATE_FACTCHECK_MIN ? 'pass' : 'fail',
            detail: `${Math.round(passRate * 100)}% this week (at least ${GATE_FACTCHECK_MIN * 100}%).`,
          },
      {
        gate: 'Few corrections',
        status: corrections <= GATE_CORRECTIONS_PER_TOWN * rows.length ? 'pass' : 'fail',
        detail: `${corrections} in 30 days across ${rows.length} town(s) (at most ${GATE_CORRECTIONS_PER_TOWN} a town).`,
      },
      {
        gate: 'Newsletter sign-ups coming in',
        status: signups >= GATE_SIGNUPS_PER_TOWN * rows.length ? 'pass' : 'fail',
        detail: `${signups} sign-up(s) across ${rows.length} town(s) (at least ${GATE_SIGNUPS_PER_TOWN} a town).`,
      },
    ];
    return {
      cohort,
      towns: rows.length,
      gates,
      verdict: gates.some((g) => g.status === 'fail') ? 'pause' : 'launch',
    };
  });
}
