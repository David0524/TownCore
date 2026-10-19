import {
  adminActions,
  and,
  articles,
  eq,
  gte,
  skippedCandidates,
  sql,
  storyCandidates,
  type Db,
} from '@towncore/db';

// Score calibration (ported from Kyle's TownCore, lib/intake/quality-math.ts): does the story
// finder's newsworthiness score (§6a) predict what happens to a story? Per score band, how many
// candidates were published, approved by a reviewer, rejected by a reviewer or skipped. If 90+
// stories are rejected as often as 40–59 ones, the score is decoration and the weights in
// scoring.ts need work. Pure math here; `scoreCalibration` reads the counts from existing tables
// (story_candidates, articles, skipped_candidates, admin_actions).

export const SCORE_BANDS = [
  { id: '0-39', label: '0–39', lo: 0 },
  { id: '40-59', label: '40–59', lo: 40 },
  { id: '60-74', label: '60–74', lo: 60 },
  { id: '75-89', label: '75–89', lo: 75 },
  { id: '90+', label: '90+', lo: 90 },
] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number]['id'];

/** The band for a 0–100 score; out of range or not a number clamps. */
export function bandFor(score: number): ScoreBand {
  const n = Number.isFinite(score) ? score : 0;
  let band: ScoreBand = SCORE_BANDS[0].id;
  for (const b of SCORE_BANDS) if (n >= b.lo) band = b.id;
  return band;
}

/** What became of one scored candidate. */
export type CandidateOutcome = {
  score: number;
  outcome: 'published' | 'rejected' | 'skipped' | 'open' | 'other';
  /** Published after a person approved it in review (Tier 3, a sample, a failed check). */
  reviewerApproved: boolean;
};

export type BandRow = {
  band: ScoreBand;
  label: string;
  candidates: number;
  published: number;
  /** Published by a reviewer's approval (a subset of published). */
  approved: number;
  rejected: number;
  skipped: number;
  /** Still in the pipeline or in review. */
  open: number;
  /** Shares of all candidates in the band; null when the band is empty. */
  publishRate: number | null;
  rejectRate: number | null;
  skipRate: number | null;
  /** approved / (approved + rejected): how often reviewers say yes. Null with no decisions. */
  approvalRate: number | null;
};

const share = (n: number, of: number) => (of > 0 ? n / of : null);

export function bandRows(outcomes: CandidateOutcome[]): BandRow[] {
  return SCORE_BANDS.map((b) => {
    const mine = outcomes.filter((o) => bandFor(o.score) === b.id);
    const count = (k: CandidateOutcome['outcome']) => mine.filter((o) => o.outcome === k).length;
    const published = count('published');
    const approved = mine.filter((o) => o.outcome === 'published' && o.reviewerApproved).length;
    const rejected = count('rejected');
    const skipped = count('skipped');
    return {
      band: b.id,
      label: b.label,
      candidates: mine.length,
      published,
      approved,
      rejected,
      skipped,
      open: count('open'),
      publishRate: share(published, mine.length),
      rejectRate: share(rejected, mine.length),
      skipRate: share(skipped, mine.length),
      approvalRate: share(approved, approved + rejected),
    };
  });
}

/** A band needs this many reviewer decisions before its approval rate means anything. */
export const MIN_DECIDED_PER_BAND = 8;
/** Reviewer decisions needed across bands before any verdict. */
export const MIN_DECIDED_TOTAL = 40;

export type Calibration = {
  bands: BandRow[];
  /** Reviewer decisions (approved + rejected) across all bands. */
  decided: number;
  /** Approval rate of the highest usable band over the lowest's; above 1 the score works. */
  lift: number | null;
  /** Share of neighboring usable bands whose approval rate rises with the score. */
  monotonicity: number | null;
  verdict: 'no-data' | 'working' | 'weak' | 'broken';
  headline: string;
};

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);

/**
 * Reads the bands against reviewers' decisions: the one signal the score doesn't decide itself
 * (skips below the threshold are the score's own doing, so they aren't evidence either way).
 */
export function calibrate(outcomes: CandidateOutcome[]): Calibration {
  const bands = bandRows(outcomes);
  const decided = bands.reduce((n, b) => n + b.approved + b.rejected, 0);
  const usable = bands.filter((b) => b.approved + b.rejected >= MIN_DECIDED_PER_BAND);
  if (decided < MIN_DECIDED_TOTAL || usable.length < 2)
    return {
      bands,
      decided,
      lift: null,
      monotonicity: null,
      verdict: 'no-data',
      headline: `Not enough review decisions yet (${decided} of ${MIN_DECIDED_TOTAL}, at least ${MIN_DECIDED_PER_BAND} in two bands) to judge the score.`,
    };
  const lo = usable[0]!;
  const hi = usable[usable.length - 1]!;
  const lift = lo.approvalRate! > 0 ? hi.approvalRate! / lo.approvalRate! : null;
  let up = 0;
  for (let i = 1; i < usable.length; i++)
    if (usable[i]!.approvalRate! >= usable[i - 1]!.approvalRate!) up++;
  const monotonicity = up / (usable.length - 1);
  // 1.25× is a low bar on purpose: at these volumes anything tighter is noise. A bottom band
  // with no approvals at all and a top band with some is a working score too.
  const strong = (lift === null ? hi.approvalRate! > 0 : lift >= 1.25) && monotonicity >= 0.6;
  const weak = lift !== null && lift >= 1.05;
  const verdict = strong ? 'working' : weak ? 'weak' : 'broken';
  const compare = `${hi.label} is approved ${pct(hi.approvalRate)} of the time, ${lo.label} ${pct(lo.approvalRate)}`;
  const headline =
    verdict === 'working'
      ? `The score predicts reviewers' decisions: ${compare}.`
      : verdict === 'weak'
        ? `The score barely predicts reviewers' decisions: ${compare}. Worth tuning the weights in scoring.ts.`
        : `The score doesn't predict reviewers' decisions: ${compare}. Ranking by it is close to random.`;
  return { bands, decided, lift, monotonicity, verdict, headline };
}

/** Candidates scored in the last this many days are counted. */
export const CALIBRATION_DAYS = 90;

/**
 * Every story candidate the finder scored in the last `days` days (code-built roundups and
 * alerts aren't scored), with what became of it, and the calibration over them.
 */
export async function scoreCalibration(
  db: Db,
  now = new Date(),
  days = CALIBRATION_DAYS,
): Promise<Calibration & { days: number }> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({
      score: storyCandidates.newsworthiness,
      candidateStatus: storyCandidates.status,
      skipped: sql<boolean>`${skippedCandidates.id} is not null`,
      articleStatus: articles.status,
      reviewerId: articles.reviewerId,
      approvedByAction: sql<boolean>`exists (
        select 1 from ${adminActions}
        where ${adminActions.articleId} = ${articles.id} and ${adminActions.action} = 'approve'
      )`,
    })
    .from(storyCandidates)
    .leftJoin(skippedCandidates, eq(skippedCandidates.candidateId, storyCandidates.id))
    .leftJoin(articles, eq(articles.candidateId, storyCandidates.id))
    .where(
      and(
        eq(storyCandidates.kind, 'story'),
        sql`${storyCandidates.newsworthiness} is not null`,
        gte(storyCandidates.createdAt, since),
      ),
    );
  const outcomes: CandidateOutcome[] = rows.map((r) => ({
    score: r.score ?? 0,
    outcome: outcomeOf(r),
    reviewerApproved: Boolean(r.reviewerId) || r.approvedByAction,
  }));
  return { ...calibrate(outcomes), days };
}

export function outcomeOf(r: {
  candidateStatus: string;
  skipped: boolean;
  articleStatus: string | null;
}): CandidateOutcome['outcome'] {
  if (r.articleStatus === 'published' || r.articleStatus === 'corrected') return 'published';
  if (r.articleStatus === 'rejected') return 'rejected';
  if (r.articleStatus === 'blocked' || r.candidateStatus === 'dropped') return 'other';
  // Skipped, then written anyway by a reviewer: the article (in review or a draft) decides.
  if (r.articleStatus) return 'open';
  if (r.skipped || r.candidateStatus === 'skipped') return 'skipped';
  return 'open';
}
