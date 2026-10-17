import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AiTask, SourceKind, TaskRoute, TownConfig } from '@towncore/config';
import {
  and,
  articles,
  eq,
  inArray,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { runStoryFinder } from './finder';
import { NotRecordedError, type Llm } from './llm';
import { writeCandidate } from './write';

// Eval harness (CLAUDE.md §12): runs each case through the real story finder and writer
// against a test database, then checks the outcome against the case's expectations. With
// recorded model responses it runs offline in CI; `pnpm evals --live` records new ones.

export type EvalCase = {
  id: string;
  synthetic?: boolean;
  real?: { fixture: string; id: string };
  /** The town the record belongs to (default Boca Raton). */
  town?: string;
  kind: SourceKind;
  /** Record type (default `release`); meeting actions and minutes become recaps. */
  type?: string;
  title?: string;
  text?: string;
  expect: {
    skip?: string;
    minTier?: number;
    maxTier?: number;
    neverPublished?: boolean;
    mustWrite?: boolean;
  };
};

export type EvalResult = {
  id: string;
  skip: string | null;
  tier: number | null;
  status: string | null;
  factcheckScore: number | null;
  claims: number;
  verbatimClaims: number;
  failures: string[];
  /** No recorded answer for this case yet (replay only): left out of every rate. */
  notRecorded?: boolean;
};

export type EvalSummary = {
  cases: number;
  /** Cases skipped because their answers aren't recorded yet (replay only). */
  notRecorded?: number;
  passed: number;
  /** Hard failures: a Tier 4 story published, or a story published that needed review. */
  safetyFailures: number;
  factcheckPassRate: number;
  verbatimQuoteRate: number;
  results: EvalResult[];
};

export async function runEvals(
  db: Db,
  townIds: string | Record<string, string>,
  cases: (EvalCase & { title: string; text: string })[],
  opts: { llm: Llm; now: Date },
): Promise<EvalSummary> {
  const ids = typeof townIds === 'string' ? { 'boca-raton': townIds } : townIds;
  // Every case is judged on tiers and checks, not on the budget: write everything that passes.
  for (const townId of Object.values(ids)) {
    const [town] = await db.select().from(towns).where(eq(towns.id, townId));
    await db
      .update(towns)
      .set({ config: { ...(town!.config as TownConfig), story_budget: 1000, score_threshold: 0 } })
      .where(eq(towns.id, townId));
  }
  const sourceIds = new Map<string, string>();

  const results: EvalResult[] = [];
  for (const c of cases) {
    const townId = ids[c.town ?? 'boca-raton'];
    if (!townId) throw new Error(`Eval case ${c.id}: town ${c.town} isn't loaded`);
    const sourceKey = `${townId}:${c.kind}`;
    if (!sourceIds.has(sourceKey)) {
      const [s] = await db
        .insert(sources)
        .values({ townId, kind: c.kind, platform: 'eval', adapter: 'eval', key: `eval-${c.kind}` })
        .onConflictDoNothing()
        .returning();
      sourceIds.set(
        sourceKey,
        s?.id ??
          (
            await db
              .select()
              .from(sources)
              .where(and(eq(sources.townId, townId), eq(sources.key, `eval-${c.kind}`)))
          )[0]!.id,
      );
    }
    const [record] = await db
      .insert(records)
      .values({
        // Fixed IDs, so prompts (which cite record IDs) are identical run to run and recorded
        // responses replay.
        id: stableUuid(`eval:${c.id}`),
        sourceId: sourceIds.get(sourceKey)!,
        townId,
        externalId: `eval:${c.id}`,
        type: c.type ?? 'release',
        title: c.title,
        text: c.text,
        contentHash: c.id,
        occurredAt: opts.now,
      })
      .onConflictDoNothing()
      .returning();
    if (!record) throw new Error(`Eval case ${c.id} was already loaded into this database.`);

    try {
      await runStoryFinder(db, townId, { llm: opts.llm, now: opts.now });
    } catch (error) {
      if (!(error instanceof NotRecordedError)) throw error;
      results.push(await notRecorded(db, townId, c.id));
      continue;
    }
    const [candidate] = await db
      .select()
      .from(storyCandidates)
      .where(eq(storyCandidates.key, `record:${record.id}`));
    const [skip] = candidate
      ? await db
          .select()
          .from(skippedCandidates)
          .where(eq(skippedCandidates.candidateId, candidate.id))
      : [];
    let article: typeof articles.$inferSelect | undefined;
    if (candidate?.status === 'accepted') {
      let outcome: Awaited<ReturnType<typeof writeCandidate>>;
      try {
        outcome = await writeCandidate(db, candidate.id, {
          llm: opts.llm,
          now: opts.now,
          random: () => 0.5,
        });
      } catch (error) {
        if (!(error instanceof NotRecordedError)) throw error;
        results.push(await notRecorded(db, townId, c.id));
        continue;
      }
      if ('articleId' in outcome) {
        [article] = await db.select().from(articles).where(eq(articles.id, outcome.articleId));
      }
    }

    const factcheck = (article?.factcheck ?? null) as {
      score?: number;
      claims?: { supported: boolean; recordId: string | null }[];
    } | null;
    const modelClaims = (factcheck?.claims ?? []).filter((cl) => cl.recordId !== null);
    const result: EvalResult = {
      id: c.id,
      skip: skip?.reason ?? null,
      tier: article?.tier ?? candidate?.proposedTier ?? null,
      status: article?.status ?? candidate?.status ?? null,
      factcheckScore: factcheck?.score ?? null,
      claims: modelClaims.length,
      verbatimClaims: modelClaims.filter((cl) => cl.supported).length,
      failures: [],
    };
    const e = c.expect;
    if (e.skip && result.skip !== e.skip) {
      result.failures.push(`expected skip "${e.skip}", got ${result.skip ?? result.status}`);
    }
    if (!e.skip && result.skip && !(e.minTier === 4 && result.skip === 'tier4')) {
      result.failures.push(`unexpectedly skipped: ${result.skip}`);
    }
    if (e.minTier && result.tier !== null && result.tier < e.minTier) {
      result.failures.push(`tier ${result.tier} < expected minimum ${e.minTier}`);
    }
    if (e.maxTier && result.tier !== null && result.tier > e.maxTier) {
      result.failures.push(`tier ${result.tier} > expected maximum ${e.maxTier}`);
    }
    if (e.neverPublished && result.status === 'published') {
      result.failures.push('SAFETY: published without human review');
    }
    if (result.tier === 4 && result.status === 'published') {
      result.failures.push('SAFETY: Tier 4 published');
    }
    if (e.mustWrite && !candidate?.mustWrite) result.failures.push('expected a must-write item');
    results.push(result);
  }

  const all = results;
  const scored = all.filter((r) => !r.notRecorded);
  const written = scored.filter((r) => r.factcheckScore !== null);
  const claims = scored.reduce((n, r) => n + r.claims, 0);
  return {
    cases: scored.length,
    notRecorded: all.length - scored.length,
    passed: scored.filter((r) => r.failures.length === 0).length,
    safetyFailures: scored.filter((r) => r.failures.some((f) => f.startsWith('SAFETY'))).length,
    factcheckPassRate: written.length
      ? written.filter((r) => (r.factcheckScore ?? 0) >= 0.95).length / written.length
      : 0,
    verbatimQuoteRate: claims ? scored.reduce((n, r) => n + r.verbatimClaims, 0) / claims : 0,
    results: all,
  };
}

/**
 * A case with no recorded answer (a new case, before `pnpm evals --live` records it): reported,
 * left out of every rate, and its candidate set aside so later cases don't retry it.
 */
async function notRecorded(db: Db, townId: string, id: string): Promise<EvalResult> {
  await db
    .update(storyCandidates)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(storyCandidates.townId, townId),
        inArray(storyCandidates.status, ['pending', 'accepted', 'writing']),
      ),
    );
  return {
    id,
    skip: null,
    tier: null,
    status: null,
    factcheckScore: null,
    claims: 0,
    verbatimClaims: 0,
    failures: [],
    notRecorded: true,
  };
}

/**
 * Route variants compared in live evals (owner, 2026-10-17, model protocol §5): the routing is
 * chosen by results, not guesses. `pnpm evals --live --variant <name>` runs one; `pnpm
 * evals:compare` lines them up.
 */
export const EVAL_VARIANTS: Record<string, Partial<Record<AiTask, Partial<TaskRoute>>>> = {
  // The routing table as it stands.
  baseline: {},
  // Classify and extract on Sonnet instead of Haiku (no escalation needed).
  'classify-sonnet': {
    classify: { tier: 'mid', escalate: undefined },
    extract: { tier: 'mid', escalate: undefined },
  },
  // Writer, revise and fact-check with adaptive thinking.
  'writer-thinking': {
    write: { thinking: 'adaptive' },
    revise: { thinking: 'adaptive' },
    factcheck: { thinking: 'adaptive' },
  },
};

export type VariantReport = {
  variant: string;
  provider: string;
  ranAt: string;
  summary: EvalSummary;
  costUsd: number;
  calls: number;
};

/** Variants side by side: quality first, then cost. */
export function compareVariants(reports: VariantReport[]): string[] {
  const unsupported = (s: EvalSummary) =>
    s.results.reduce((n, r) => n + Math.max(0, r.claims - r.verbatimClaims), 0);
  const rows = [...reports].sort(
    (a, b) =>
      a.summary.safetyFailures - b.summary.safetyFailures ||
      b.summary.factcheckPassRate - a.summary.factcheckPassRate ||
      unsupported(a.summary) - unsupported(b.summary) ||
      a.costUsd - b.costUsd,
  );
  return rows.map(
    (r) =>
      `${r.variant} (${r.provider}): ${r.summary.passed}/${r.summary.cases} pass, safety failures ${r.summary.safetyFailures}, ` +
      `fact-check pass ${(r.summary.factcheckPassRate * 100).toFixed(0)}%, unsupported claims ${unsupported(r.summary)}, ` +
      `$${r.costUsd.toFixed(4)} for ${r.calls} calls ($${(r.costUsd / Math.max(1, r.summary.cases)).toFixed(4)} a case)`,
  );
}

/** Loads cases, filling real ones from the adapters' recorded fixtures. */
export function loadEvalCases(
  casesPath: string,
  fixtureText: (fixture: string, id: string) => { title: string; text: string },
): (EvalCase & { title: string; text: string })[] {
  const file = JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: EvalCase[] };
  return file.cases.map((c) => {
    if (c.real) return { ...c, ...fixtureText(c.real.fixture, c.real.id) };
    if (!c.title || !c.text) throw new Error(`Eval case ${c.id} needs title and text`);
    return c as EvalCase & { title: string; text: string };
  });
}

/** A UUID derived from a string (same input, same UUID). */
export function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * What got worse from `baseline` to `run` (CLAUDE.md §12: block changes that lower the fact-check
 * pass rate or raise unsupported claims). Unsupported claims are claims not found verbatim.
 */
export function evalRegressions(baseline: EvalSummary, run: EvalSummary): string[] {
  const out: string[] = [];
  const unsupported = (s: EvalSummary) =>
    s.results.reduce((n, r) => n + Math.max(0, r.claims - r.verbatimClaims), 0);
  if (run.safetyFailures > baseline.safetyFailures)
    out.push(`safety failures rose from ${baseline.safetyFailures} to ${run.safetyFailures}`);
  if (run.factcheckPassRate < baseline.factcheckPassRate - 1e-9)
    out.push(
      `fact-check pass rate fell from ${(baseline.factcheckPassRate * 100).toFixed(0)}% to ${(run.factcheckPassRate * 100).toFixed(0)}%`,
    );
  if (unsupported(run) > unsupported(baseline))
    out.push(`unsupported claims rose from ${unsupported(baseline)} to ${unsupported(run)}`);
  if (run.passed < baseline.passed)
    out.push(`cases passing fell from ${baseline.passed} to ${run.passed}`);
  return out;
}
