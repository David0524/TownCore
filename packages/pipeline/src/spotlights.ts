import { foodViolations } from '@towncore/adapters';
import { titleCase } from '@towncore/config';
import {
  cap,
  count,
  INSPECTIONS_PAGE,
  inspectedPlaces,
  linked,
  md,
  mdy,
  numWord,
  permitRows,
  SEVERITY_RANK,
  usd,
  type Inspection,
  type TemplatedDraft,
  type TemplateRecord,
} from './templates';

// Spotlights (owner, 2026-10-17: "evaluate what Boca News Now publishes"; plan
// docs/plans/content-depth.md): a record that is news on its own becomes its own short story,
// built in code, beside the weekly roundup that still lists everything. Local readers share one
// named place ("Gary Woo Express logs 18 violations"), not a table of 40. Only records over a
// clear bar qualify, and each story carries only what its records say: a missing story beats a
// thin one (Rule 7). Every fact is copied from a record, so these skip the model like roundups.
//
// The bars are per kind, below, and each town gets at most a few a week, so a big town's
// spotlights never crowd out its other news.
//
// Not spotlighted: single property sales and single new licenses. One sale or one license has
// too few facts to read differently from town to town (55% and 47% shared under the
// near-duplicate guard), which is the mass-produced pattern Google's scaled-content policy
// targets (docs/research/metric-media.md). They stay in their weekly roundups.

/** The weekly roundups that can produce spotlights, and the spotlight kinds they produce. */
export type SpotlightKind = 'inspection' | 'permit';

export type Spotlight = {
  kind: SpotlightKind;
  /** Stable within the week: a license number, sale key or record id. */
  id: string;
  title: string;
  recordIds: string[];
  /** Tier 3 for inspections that name a business with problems (§7). */
  tier: 1 | 3;
};

/** At most this many spotlights of one kind per town per week. */
export const SPOTLIGHTS_PER_WEEK: Record<SpotlightKind, number> = {
  inspection: 3,
  permit: 2,
};

/** Inspections: a closure order or complaint, or a visit with this many high-priority violations. */
export const SPOT_HIGH_PRIORITY = 5;
/** …or this many violations in all. */
export const SPOT_TOTAL = 15;
/** Permits: at least this estimated cost. */
export const SPOT_PERMIT_MIN = 1_000_000;

const bySeverity = (a: { worst: Inspection }, b: { worst: Inspection }) =>
  SEVERITY_RANK[b.worst.severity ?? 'ok'] - SEVERITY_RANK[a.worst.severity ?? 'ok'] ||
  (b.worst.highPriority ?? 0) - (a.worst.highPriority ?? 0) ||
  (b.worst.total ?? 0) - (a.worst.total ?? 0);

/** Establishments whose week's inspections clear the bar, most serious first. */
export function inspectionSpotlights(recs: TemplateRecord[]): Spotlight[] {
  return inspectedPlaces(recs)
    .filter((p) => {
      const v = p.worst;
      return (
        v.severity === 'closure' ||
        v.severity === 'complaint' ||
        (v.highPriority ?? 0) >= SPOT_HIGH_PRIORITY ||
        (v.total ?? 0) >= SPOT_TOTAL
      );
    })
    .sort(bySeverity)
    .slice(0, SPOTLIGHTS_PER_WEEK.inspection)
    .map((p) => ({
      kind: 'inspection' as const,
      id: p.key,
      title: `Inspection: ${p.name}`,
      recordIds: p.ids,
      tier: 3 as const,
    }));
}

/** The week's largest permits by estimated cost. */
export function permitSpotlights(recs: TemplateRecord[]): Spotlight[] {
  return permitRows(recs)
    .filter((r) => (r.cost ?? 0) >= SPOT_PERMIT_MIN)
    .sort((a, b) => b.cost! - a.cost!)
    .slice(0, SPOTLIGHTS_PER_WEEK.permit)
    .map((r) => ({
      kind: 'permit' as const,
      id: r.p.id,
      title: `Permit: ${r.title}`,
      recordIds: [r.p.id],
      tier: 1 as const,
    }));
}

type TownInfo = { name: string; timezone: string; agency: string };

// --- Inspections -----------------------------------------------------------------------------

const RESULT_LEDE: Record<'closure' | 'complaint' | 'warning' | 'ok', string> = {
  closure: 'The inspector ordered it closed until a follow-up visit finds the problems corrected.',
  complaint:
    'The inspector recommended an administrative complaint, which can lead to a fine from the state.',
  warning: 'The inspector issued a warning; a call-back visit checks that the problems are fixed.',
  ok: 'The visit ended with the establishment meeting inspection standards.',
};

const PREVIOUS: Record<'closure' | 'complaint' | 'warning' | 'ok', string> = {
  closure: 'led to a closure order',
  complaint: 'led to a recommended complaint',
  warning: 'ended with a warning',
  ok: 'met standards',
};

/** "Time and temperature control (3)" lines, risk factors first, from a visit's category counts. */
function citedCategories(v: Inspection & { violations?: Record<string, number> }) {
  return Object.entries(v.violations ?? {})
    .map(([code, n]) => ({ code, n, info: foodViolations[code] }))
    .sort(
      (a, b) =>
        Number(b.info?.riskFactor ?? false) - Number(a.info?.riskFactor ?? false) ||
        b.n - a.n ||
        a.code.localeCompare(b.code),
    )
    .map(
      ({ code, n, info }) =>
        `${md(info?.name ?? `Category ${code}`)}${n > 1 ? ` (${n})` : ''}${info?.riskFactor ? ', a foodborne-illness risk factor' : ''}`,
    );
}

/**
 * One establishment's inspection (owner, 2026-10-17), with what was cited by category and its
 * earlier visits on file. Tier 3: it names a business with problems, so a person approves it.
 * The state's own result wording is quoted; inspectors' notes aren't in the files and never
 * appear.
 */
export function inspectionSpotlight(
  town: TownInfo,
  visits: TemplateRecord[],
  history: TemplateRecord[] = [],
): TemplatedDraft {
  const [place] = inspectedPlaces(visits);
  const v = place!.worst as Inspection & { violations?: Record<string, number> };
  const name = place!.name;
  const where = v.address ? titleCase(v.address) : null;
  const sev = v.severity ?? 'ok';
  const total = v.total ?? 0;
  const high = v.highPriority ?? 0;
  const cited = citedCategories(v);
  const past = history
    .map((r) => (r.raw ?? {}) as Inspection)
    .filter((h) => mdy(h.date) < mdy(v.date))
    .sort((a, b) => mdy(b.date).localeCompare(mdy(a.date)));
  const last = past[0];
  const headline =
    sev === 'closure'
      ? `State inspectors order ${name} closed after citing ${count(total, 'violation', 'violations')}`
      : sev === 'complaint'
        ? `Inspectors recommend a complaint against ${name}, cited for ${count(total, 'violation', 'violations')}`
        : `${name} cited for ${count(total, 'violation', 'violations')}, ${high} high priority, in a state inspection`;
  const lede = [
    `Florida food safety inspectors visited ${md(name)}${where ? `, at ${md(where)},` : ''} on ${v.date} and cited ${count(total, 'violation', 'violations')}, ${numWord(high)} of them high priority.`,
    RESULT_LEDE[sev],
    place!.fixedLater ? `A call-back visit on ${place!.fixedLater} found it in compliance.` : null,
    last
      ? `Its previous inspection on file, on ${last.date}, ${PREVIOUS[last.severity ?? 'ok']} with ${count(last.total ?? 0, 'violation', 'violations')}.`
      : null,
  ].filter(Boolean);
  const visitsTable = past.length
    ? [
        '## Earlier inspections on file',
        ['| Date | Violations (high priority) |', '| --- | --- |']
          .concat(
            past
              .slice(0, 6)
              .map((h) => `| ${h.date ?? ''} | ${h.total ?? 0} (${h.highPriority ?? 0}) |`),
          )
          .join('\n'),
      ].join('\n\n')
    : null;
  return {
    headline,
    dek: `${cap(count(total, 'violation', 'violations'))} at ${name}${where ? ` on ${where}` : ''}, inspected ${v.date}, with a ${town.name} address.`,
    bodyMd: [
      lede.join(' '),
      cited.length
        ? ['## What was cited', cited.map((c) => `- ${c}`).join('\n')].join('\n\n')
        : null,
      visitsTable,
      `[The state's inspection records](${INSPECTIONS_PAGE}) have every visit.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    beat: 'business',
    sourceRecordIds: [...visits.map((r) => r.id), ...history.map((r) => r.id)],
  };
}

// --- Permits ---------------------------------------------------------------------------------

/** One of the week's largest permits (owner, 2026-10-17). Tier 1, like the permits roundup. */
export function permitSpotlight(
  town: TownInfo,
  permit: TemplateRecord,
  week: TemplateRecord[],
): TemplatedDraft {
  const [r] = permitRows([permit]);
  const rows = permitRows(week);
  const total = rows.reduce((sum, x) => sum + (x.cost ?? 0), 0);
  const share = total > 0 ? Math.round((r!.cost! / total) * 100) : 0;
  const what = r!.work ? titleCase(r!.work) : r!.type ? `${titleCase(r!.type)} work` : 'Work';
  return {
    headline: `${r!.title}: a permit for ${usd(r!.cost!)} of work${r!.address ? ` at ${titleCase(r!.address)}` : ''}`,
    dek: `${what}, estimated by the applicant at ${usd(r!.cost!)}, in ${town.name}.`,
    bodyMd: [
      [
        `${linked(md(r!.title), permit.url)}${r!.address ? `, at ${md(titleCase(r!.address))},` : ''} is estimated by its applicant at ${usd(r!.cost!)}.`,
        r!.type
          ? `The permit type is ${md(titleCase(r!.type))}${r!.status ? `; its status is ${md(r!.status.toLowerCase())}` : ''}.`
          : null,
        r!.contractor ? `The contractor of record is ${md(titleCase(r!.contractor))}.` : null,
        rows.length > 1 && share > 0
          ? `It accounts for ${share}% of the estimated cost of the ${numWord(rows.length)} permits filed that week.`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    ].join('\n\n'),
    beat: 'development',
    sourceRecordIds: [permit.id],
  };
}

/** What each spotlight kind is called in its candidate key and which roundup's week it reads. */
export const SPOTLIGHT_ROUNDUP = {
  inspection: 'inspections',
  permit: 'permits',
} as const;
