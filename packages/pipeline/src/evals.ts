import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SourceKind, TownConfig } from '@towncore/config';
import {
  articles,
  eq,
  records,
  skippedCandidates,
  sources,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { runStoryFinder } from './finder';
import type { Llm } from './llm';
import { writeCandidate } from './write';

// Eval harness (CLAUDE.md §12): runs each case through the real story finder and writer
// against a test database, then checks the outcome against the case's expectations. With
// recorded model responses it runs offline in CI; `pnpm evals --live` records new ones.

export type EvalCase = {
  id: string;
  synthetic?: boolean;
  real?: { fixture: string; id: string };
  kind: SourceKind;
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
};

export type EvalSummary = {
  cases: number;
  passed: number;
  /** Hard failures: a Tier 4 story published, or a story published that needed review. */
  safetyFailures: number;
  factcheckPassRate: number;
  verbatimQuoteRate: number;
  results: EvalResult[];
};

export async function runEvals(
  db: Db,
  townId: string,
  cases: (EvalCase & { title: string; text: string })[],
  opts: { llm: Llm; now: Date },
): Promise<EvalSummary> {
  // Every case is judged on tiers and checks, not on the budget: write everything that passes.
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  await db
    .update(towns)
    .set({ config: { ...(town!.config as TownConfig), story_budget: 1000, score_threshold: 0 } })
    .where(eq(towns.id, townId));
  const sourceIds = new Map<string, string>();

  const results: EvalResult[] = [];
  for (const c of cases) {
    if (!sourceIds.has(c.kind)) {
      const [s] = await db
        .insert(sources)
        .values({ townId, kind: c.kind, platform: 'eval', adapter: 'eval', key: `eval-${c.kind}` })
        .onConflictDoNothing()
        .returning();
      sourceIds.set(
        c.kind,
        s?.id ??
          (
            await db
              .select()
              .from(sources)
              .where(eq(sources.key, `eval-${c.kind}`))
          )[0]!.id,
      );
    }
    const [record] = await db
      .insert(records)
      .values({
        // Fixed IDs, so prompts (which cite record IDs) are identical run to run and recorded
        // responses replay.
        id: stableUuid(`eval:${c.id}`),
        sourceId: sourceIds.get(c.kind)!,
        townId,
        externalId: `eval:${c.id}`,
        type: 'release',
        title: c.title,
        text: c.text,
        contentHash: c.id,
        occurredAt: opts.now,
      })
      .onConflictDoNothing()
      .returning();
    if (!record) throw new Error(`Eval case ${c.id} was already loaded into this database.`);

    await runStoryFinder(db, townId, { llm: opts.llm, now: opts.now });
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
      const outcome = await writeCandidate(db, candidate.id, {
        llm: opts.llm,
        now: opts.now,
        random: () => 0.5,
      });
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

  const written = results.filter((r) => r.factcheckScore !== null);
  const claims = results.reduce((n, r) => n + r.claims, 0);
  return {
    cases: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    safetyFailures: results.filter((r) => r.failures.some((f) => f.startsWith('SAFETY'))).length,
    factcheckPassRate: written.length
      ? written.filter((r) => (r.factcheckScore ?? 0) >= 0.95).length / written.length
      : 0,
    verbatimQuoteRate: claims ? results.reduce((n, r) => n + r.verbatimClaims, 0) / claims : 0,
    results,
  };
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
