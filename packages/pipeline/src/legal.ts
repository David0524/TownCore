import { legalV1, type LegalReview } from '@towncore/prompts';
import { normalize } from './factcheck';
import { callModel, routeFor, type Llm, type LlmTown } from './llm';
import type { Tier } from './tiers';

// Libel review (prompts v1/legal.ts): a separate model call after fact-check, on Tier 1–2 drafts
// only (Tier 3 and up already wait for a person). The model flags passages; code keeps only the
// flags whose excerpt is a verbatim slice of the draft, and the review can only raise the tier:
// high or critical → at least Tier 3, so the story waits for a person. It never lowers anything,
// and it is off until the `legal` route is switched on (packages/config models.ts).

export type LegalFlag = LegalReview['flags'][number];

export type LegalReport = {
  level: LegalReview['level'];
  /** Flags whose excerpt is in the draft word for word. */
  flags: LegalFlag[];
  /** Flags dropped because their excerpt isn't in the draft. */
  dropped: number;
  /** The prompt that produced it. */
  promptVersion: string;
};

/** Flags shown to reviewers, at most. */
const MAX_FLAGS = 12;

/** True once the owner switches the `legal` route on. */
export function legalReviewOn(llm: Pick<Llm, 'routeOverrides'>): boolean {
  return !routeFor(llm, 'legal').disabled;
}

/** Keeps the flags whose excerpt is a verbatim slice of the draft (whitespace and quote marks aside). */
export function verifyLegalFlags(
  draft: { headline: string; dek: string; bodyMd: string },
  review: LegalReview,
): Omit<LegalReport, 'promptVersion'> {
  const text = normalize(`${draft.headline}\n${draft.dek}\n${draft.bodyMd}`);
  const flags = review.flags.filter((f) => {
    const excerpt = normalize(f.excerpt);
    return excerpt.length > 0 && text.includes(excerpt);
  });
  return {
    level: review.level,
    flags: flags.slice(0, MAX_FLAGS),
    dropped: review.flags.length - flags.length,
  };
}

/** The tier after the review: high or critical raise it to at least Tier 3; never lowered. */
export function tierAfterLegal(tier: Tier, report: Pick<LegalReport, 'level'>): Tier {
  return report.level === 'high' || report.level === 'critical'
    ? (Math.max(tier, 3) as Tier)
    : tier;
}

export async function reviewLibel(
  llm: Llm,
  args: {
    town: LlmTown;
    inputPrefix: string;
    draft: { headline: string; dek: string; bodyMd: string };
    sourcesText: string[];
  },
): Promise<LegalReport> {
  const { value } = await callModel(llm, {
    job: 'legal',
    town: args.town,
    prompt: legalV1,
    inputPrefix: args.inputPrefix,
    input: [
      '',
      '=== Draft',
      `Headline: ${args.draft.headline}`,
      `Dek: ${args.draft.dek}`,
      args.draft.bodyMd,
      '',
      '=== Records',
      ...args.sourcesText,
    ].join('\n'),
  });
  return {
    ...verifyLegalFlags(args.draft, value),
    promptVersion: `${legalV1.id}@${legalV1.version}`,
  };
}
