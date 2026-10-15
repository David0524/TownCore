import { beatInterestPrior, type BeatSlug } from '@towncore/config';
import type { Classification } from '@towncore/prompts';

// Newsworthiness, 0–100 (CLAUDE.md §6a). The weights are starting values, to be tuned from
// article_scores and reader data, not by feel. Every component is stored with the score.

export const weights = {
  impact: 30,
  timeliness: 20,
  novelty: 15,
  proximity: 10,
  interest: 25,
} as const;

export const penalties = {
  duplicate: 30,
  thinSource: 10,
  degradedSource: 10,
} as const;

/** Source text shorter than this is too thin to write a story from. */
export const MIN_SOURCE_CHARS = 400;
/** Below this the story is written but scored down. */
export const SHORT_SOURCE_CHARS = 800;

export type ScoreComponents = {
  impact: number;
  timeliness: number;
  novelty: number;
  proximity: number;
  interest: number;
  penalties: { duplicate: boolean; thinSource: boolean; degradedSource: boolean };
};

/**
 * Timeliness from the record date: fresh news decays over three days; an upcoming date is
 * most timely in the next two days.
 */
export function timeliness(occurredAt: Date | null, now: Date): number {
  if (!occurredAt) return 0.5;
  const hours = (now.getTime() - occurredAt.getTime()) / 3_600_000;
  if (hours >= 0) return Math.max(0.1, 1 - hours / 72);
  const daysAhead = -hours / 24;
  return daysAhead <= 2 ? 1 : daysAhead <= 7 ? 0.7 : 0.4;
}

export function scoreCandidate(input: {
  classification: Classification;
  occurredAt: Date | null;
  sourceChars: number;
  duplicate: boolean;
  degradedSource: boolean;
  now: Date;
}): { score: number; components: ScoreComponents } {
  const c = input.classification;
  const components: ScoreComponents = {
    impact: c.impact,
    timeliness: timeliness(input.occurredAt, input.now),
    novelty: c.novelty,
    proximity: c.proximity,
    interest: beatInterestPrior[c.beat as BeatSlug] ?? 0.5,
    penalties: {
      duplicate: input.duplicate,
      thinSource: input.sourceChars < SHORT_SOURCE_CHARS,
      degradedSource: input.degradedSource,
    },
  };
  let score =
    weights.impact * components.impact +
    weights.timeliness * components.timeliness +
    weights.novelty * components.novelty +
    weights.proximity * components.proximity +
    weights.interest * components.interest;
  if (components.penalties.duplicate) score -= penalties.duplicate;
  if (components.penalties.thinSource) score -= penalties.thinSource;
  if (components.penalties.degradedSource) score -= penalties.degradedSource;
  return { score: Math.round(Math.min(100, Math.max(0, score)) * 10) / 10, components };
}

/** Word-overlap similarity of two headlines (Jaccard on words of 3+ letters). */
export function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    );
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}
