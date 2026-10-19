import type { TownConfig } from '@towncore/config';
import { checkDraft, lintStyle, type FactcheckReport, type StyleHit } from '@towncore/pipeline';

// Shared review helpers for /admin.

const MINOR = /^(names a minor|possible minor)/;
const HARD_TIER4 = /^(arrest without|sexual-assault|rumor)/;

/** Tier 4 only because a minor may be named: a reviewer may override it (CLAUDE.md §7). */
export function minorOverridable(article: { tier: number; tierReasons: string[] | null }): boolean {
  const reasons = article.tierReasons ?? [];
  return (
    article.tier === 4 &&
    reasons.some((r) => MINOR.test(r)) &&
    !reasons.some((r) => HARD_TIER4.test(r))
  );
}

export const reviewReasonLabel: Record<string, string> = {
  tier3: 'Tier 3: needs human approval',
  sample: 'Tier 2 random sample',
  factcheck: 'Failed fact-check',
  model_error: 'Model error during fact-check or the libel review',
  minor_override: 'Minor flag overridden; needs approval',
  transcript: 'Uses a machine transcript: check names against the minutes',
  style: 'Filler or speculation left after the revise',
};

/** Code checks (names, numbers, quotations, filler) on an edited draft: no model call. */
export function recheckEdit(input: {
  draft: { headline: string; dek: string; bodyMd: string };
  sources: { id: string; title: string | null; text: string | null }[];
  town: { name: string; siteName: string; county: string };
  config: TownConfig;
}): Pick<FactcheckReport, 'unsupportedClaims' | 'wrongTownRisk' | 'wrongTownReason'> & {
  styleLint: StyleHit[];
} {
  const report = checkDraft({
    draft: input.draft,
    sources: input.sources,
    model: { claims: [], wrong_town_risk: false, wrong_town_reason: null },
    knownNames: [
      input.town.name,
      input.town.siteName,
      input.town.county,
      'Florida',
      ...input.config.agencies,
    ],
    otherPlaces: input.config.same_name_elsewhere,
  });
  return {
    unsupportedClaims: report.unsupportedClaims,
    wrongTownRisk: report.wrongTownRisk,
    wrongTownReason: report.wrongTownReason,
    styleLint: lintStyle(input.draft, input.sources),
  };
}
