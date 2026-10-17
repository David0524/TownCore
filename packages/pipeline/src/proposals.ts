import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { taskRoutes, type AiTask } from '@towncore/config';
import {
  agentRuns,
  and,
  desc,
  eq,
  inArray,
  logAdminAction,
  proposals,
  type Db,
  type StaffMember,
} from '@towncore/db';
import { townAudience } from './audience';
import { cohortGates, type CohortGate } from './cohort-gates';
import { EVAL_VARIANTS, type EvalSummary, type VariantReport } from './evals';
import { decideExperiment, experimentReports } from './experiments';

// Learning loops that close themselves (owner, 2026-10-17; docs/plans/agentic-ops.md). On a
// schedule each loop writes a proposal into one inbox, Admin → Proposals; an admin approves or
// rejects it in one click, audited. Approving an experiment winner rolls it out to every town
// (variants change copy or the first two phone modules only, so the neighbor rule holds). A
// routing change is code: approving records the decision and the diff to apply in a pull request.
// A cohort gate proposes launching or pausing the next cohort; the decision stays a person's.
// Pricing proposals are a kind here only; pricing itself is built elsewhere.

export class ProposalDecisionRefused extends Error {}

export type Proposal = typeof proposals.$inferSelect;
export type ProposalInput = Pick<Proposal, 'kind' | 'key' | 'title' | 'summary' | 'detail'>;

/** A variant needs at least this many towns, and so does the control, before it can win. */
export const MIN_TOWNS_PER_VARIANT = 5;
/** And it must beat the control by at least this much (relative). */
export const MIN_LIFT = 0.1;

/**
 * Opens a proposal, or refreshes the open one with the same key. A key already decided is never
 * proposed again (a rejected winner stays rejected until the numbers change its key).
 */
export async function upsertProposal(
  db: Db,
  input: ProposalInput,
): Promise<'opened' | 'refreshed' | 'decided'> {
  const [existing] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.key, input.key))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  if (existing && existing.status !== 'open' && existing.status !== 'superseded') return 'decided';
  if (existing?.status === 'open') {
    await db
      .update(proposals)
      .set({
        title: input.title,
        summary: input.summary,
        detail: input.detail,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, existing.id));
    return 'refreshed';
  }
  await db.insert(proposals).values(input).onConflictDoNothing();
  return 'opened';
}

/** Closes open proposals of a kind whose key starts with `prefix` but isn't `keep`. */
async function supersede(db: Db, kind: Proposal['kind'], prefix: string, keep: string[]) {
  const open = await db
    .select({ id: proposals.id, key: proposals.key })
    .from(proposals)
    .where(and(eq(proposals.kind, kind), eq(proposals.status, 'open')));
  const stale = open.filter((p) => p.key.startsWith(prefix) && !keep.includes(p.key));
  if (stale.length)
    await db
      .update(proposals)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(
        inArray(
          proposals.id,
          stale.map((p) => p.id),
        ),
      );
}

/** Experiments where one variant clearly beats the control on its own metric. */
export async function experimentProposals(db: Db, now = new Date()): Promise<ProposalInput[]> {
  const reports = await experimentReports(db, await townAudience(db, now));
  const out: ProposalInput[] = [];
  for (const r of reports) {
    if (r.state.status !== 'running') continue;
    const [control, ...rest] = r.variants;
    if (!control || control.towns < MIN_TOWNS_PER_VARIANT || control.value === null) continue;
    const best = rest
      .filter((v) => v.towns >= MIN_TOWNS_PER_VARIANT && v.value !== null)
      .sort((a, b) => b.value! - a.value!)[0];
    if (!best || best.value! <= 0 || best.value! < control.value * (1 + MIN_LIFT)) continue;
    const lift = control.value > 0 ? (best.value! / control.value - 1) * 100 : null;
    out.push({
      kind: 'experiment',
      key: `experiment:${r.key}:${best.variant}`,
      title: `Roll out "${best.variant}" for ${r.label}`,
      summary: `${best.variant} scores ${best.value!.toFixed(2)} on ${r.metric} in ${best.towns} towns, against ${control.value.toFixed(2)} for ${control.variant} in ${control.towns}${lift === null ? '' : ` (+${lift.toFixed(0)}%)`}. Approving shows it in every town; it changes copy or the first two phone modules only, so the neighbor rule holds.`,
      detail: {
        experiment: r.key,
        winner: best.variant,
        variants: r.variants.map(({ counts: _c, ...v }) => v),
      },
    });
  }
  return out;
}

const unsupported = (s: EvalSummary) =>
  s.results.reduce((n, r) => n + Math.max(0, r.claims - r.verbatimClaims), 0);

/** The routing table change a variant makes, as lines for a pull request. */
export function routingDiff(variant: string): string[] {
  const changes = EVAL_VARIANTS[variant] ?? {};
  const lines: string[] = [];
  for (const [task, fields] of Object.entries(changes) as Array<[AiTask, Record<string, unknown>]>)
    for (const [field, value] of Object.entries(fields)) {
      const before = (taskRoutes[task] as Record<string, unknown>)[field];
      lines.push(
        `taskRoutes.${task}.${field}: ${JSON.stringify(before) ?? 'unset'} → ${JSON.stringify(value) ?? 'unset'}`,
      );
    }
  return lines;
}

/** A routing variant that did better than the baseline in live evals (never worse on safety). */
export function routingProposals(reports: VariantReport[]): ProposalInput[] {
  const byProvider = new Map<string, VariantReport[]>();
  for (const r of reports) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  const out: ProposalInput[] = [];
  for (const [provider, list] of byProvider) {
    const baseline = list.find((r) => r.variant === 'baseline');
    if (!baseline) continue;
    const better = list
      .filter(
        (r) =>
          r.variant !== 'baseline' &&
          EVAL_VARIANTS[r.variant] &&
          r.summary.safetyFailures <= baseline.summary.safetyFailures &&
          unsupported(r.summary) <= unsupported(baseline.summary) &&
          r.summary.factcheckPassRate >= baseline.summary.factcheckPassRate &&
          (r.summary.factcheckPassRate > baseline.summary.factcheckPassRate ||
            unsupported(r.summary) < unsupported(baseline.summary) ||
            r.costUsd < baseline.costUsd),
      )
      .sort(
        (a, b) =>
          b.summary.factcheckPassRate - a.summary.factcheckPassRate ||
          unsupported(a.summary) - unsupported(b.summary) ||
          a.costUsd - b.costUsd,
      )[0];
    if (!better) continue;
    const diff = routingDiff(better.variant);
    out.push({
      kind: 'routing',
      key: `routing:${provider}:${better.variant}:${better.ranAt}`,
      title: `Routing: switch to "${better.variant}" (${provider})`,
      summary: `Live evals (${better.ranAt.slice(0, 10)}): fact-check pass ${(better.summary.factcheckPassRate * 100).toFixed(0)}% against ${(baseline.summary.factcheckPassRate * 100).toFixed(0)}%, unsupported claims ${unsupported(better.summary)} against ${unsupported(baseline.summary)}, safety failures ${better.summary.safetyFailures}, $${better.costUsd.toFixed(4)} against $${baseline.costUsd.toFixed(4)}. The routing table is code: approving records the decision; apply the diff in packages/config/src/models.ts in a pull request.`,
      detail: { provider, variant: better.variant, diff, file: 'packages/config/src/models.ts' },
    });
  }
  return out;
}

/**
 * The live eval reports (`pnpm evals --live --variant`), from packages/prompts/evals/variants.
 * The caller passes the folder: this module is bundled into the web app, where a path built from
 * import.meta.url would be read as an asset import.
 */
export function readVariantReports(dir: string | undefined): VariantReport[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as VariantReport);
}

/** The latest live cohort's gates, as a proposal to launch or pause the next one. */
export function gateProposal(gate: CohortGate): ProposalInput {
  const failed = gate.gates.filter((g) => g.status === 'fail');
  const unknown = gate.gates.filter((g) => g.status === 'unknown');
  return {
    kind: 'cohort_gate',
    key: `cohort_gate:${gate.cohort}:${gate.verdict}`,
    title:
      gate.verdict === 'launch'
        ? `Cohort ${gate.cohort} passes its gates: launch the next cohort`
        : `Cohort ${gate.cohort} fails ${failed.length} gate(s): pause the next cohort`,
    summary:
      gate.verdict === 'launch'
        ? `No gate failed across ${gate.towns} town(s).${unknown.length ? ` Check by hand first: ${unknown.map((g) => g.gate).join('; ')}.` : ''}`
        : `Failed: ${failed.map((g) => `${g.gate} (${g.detail})`).join('; ')}. Fix the cause before the next cohort; hide the cohort from search in Admin → Health if needed.`,
    detail: { cohort: gate.cohort, verdict: gate.verdict, gates: gate.gates },
  };
}

export type LearningRun = { opened: number; refreshed: number };

/** Every loop once (the worker runs this daily). */
export async function runLearningLoops(
  db: Db,
  opts: { now?: Date; variantsDir?: string } = {},
): Promise<LearningRun> {
  const now = opts.now ?? new Date();
  const run: LearningRun = { opened: 0, refreshed: 0 };
  const count = (r: 'opened' | 'refreshed' | 'decided') => {
    if (r === 'opened') run.opened++;
    if (r === 'refreshed') run.refreshed++;
  };
  const experiments = await experimentProposals(db, now);
  for (const p of experiments) count(await upsertProposal(db, p));
  const routing = routingProposals(readVariantReports(opts.variantsDir));
  for (const p of routing) count(await upsertProposal(db, p));
  const gates = await cohortGates(db, now);
  const latest = gates.at(-1);
  if (latest) {
    const p = gateProposal(latest);
    // A newer verdict for the cohort replaces the old one.
    await supersede(db, 'cohort_gate', `cohort_gate:${latest.cohort}:`, [p.key]);
    count(await upsertProposal(db, p));
  }
  await db.insert(agentRuns).values({
    agent: 'learning',
    status: 'ok',
    summary: {
      ...run,
      experiments: experiments.length,
      routing: routing.length,
      cohorts: gates.length,
    },
    startedAt: now,
    finishedAt: new Date(),
  });
  return run;
}

export async function listProposals(
  db: Db,
  opts: { status?: Proposal['status']; limit?: number } = {},
): Promise<Proposal[]> {
  return db
    .select()
    .from(proposals)
    .where(opts.status ? eq(proposals.status, opts.status) : undefined)
    .orderBy(desc(proposals.createdAt))
    .limit(opts.limit ?? 50);
}

/** One click: approve (runs the action, or records the decision) or reject. Admin only; audited. */
export async function decideProposal(
  db: Db,
  input: { id: string; staff: StaffMember; decision: 'approve' | 'reject'; note?: string },
  now = new Date(),
): Promise<Proposal> {
  if (input.staff.role !== 'admin')
    throw new ProposalDecisionRefused('Only an admin can decide a proposal.');
  const [p] = await db.select().from(proposals).where(eq(proposals.id, input.id));
  if (!p) throw new ProposalDecisionRefused('That proposal is unknown.');
  if (p.status !== 'open') throw new ProposalDecisionRefused(`It is already ${p.status}.`);
  if (input.decision === 'approve' && p.kind === 'experiment') {
    const d = p.detail as { experiment: string; winner: string };
    await decideExperiment(db, { key: d.experiment, winner: d.winner, staff: input.staff }, now);
  }
  const [row] = await db
    .update(proposals)
    .set({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: input.staff.id,
      decidedAt: now,
      note: input.note?.trim().slice(0, 500) || null,
      updatedAt: now,
    })
    .where(and(eq(proposals.id, p.id), eq(proposals.status, 'open')))
    .returning();
  if (!row) throw new ProposalDecisionRefused('It changed while deciding; reload.');
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: `proposal.${input.decision}`,
    target: { type: 'proposal', id: row.id },
    detail: { kind: row.kind, key: row.key, note: row.note },
  });
  return row;
}

/** The latest decided cohort gate, so Admin → Launches can show it beside "Start a cohort". */
export async function latestGateDecision(db: Db): Promise<Proposal | null> {
  const [row] = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.kind, 'cohort_gate'),
        inArray(proposals.status, ['open', 'approved', 'rejected']),
      ),
    )
    .orderBy(desc(proposals.updatedAt))
    .limit(1);
  return row ?? null;
}
