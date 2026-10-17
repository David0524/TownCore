// Audience and growth (owner, 2026-10-17: "build traffic and self-serve revenue"). Shared by the
// town sites, the pipeline's metrics and Admin → Health, for every town. Everything here counts
// in aggregate: no cookies, no reader identifiers (D-M4-3).

/** Where a newsletter sign-up form sits. Stored on the subscriber as `signup_form:<placement>`. */
export const SIGNUP_PLACEMENTS = ['home', 'article', 'second-article', 'newsletter-page'] as const;
export type SignupPlacement = (typeof SIGNUP_PLACEMENTS)[number];

export function isSignupPlacement(value: unknown): value is SignupPlacement {
  return typeof value === 'string' && (SIGNUP_PLACEMENTS as readonly string[]).includes(value);
}

/** The subscriber `source` a sign-up from a placement records. */
export const signupSource = (placement: SignupPlacement | null | undefined) =>
  placement ? `signup_form:${placement}` : 'signup_form';

/** The placement back from a subscriber's `source`, or null. */
export function placementOf(source: string | null): SignupPlacement | null {
  const value = source?.startsWith('signup_form:') ? source.slice('signup_form:'.length) : null;
  return isSignupPlacement(value) ? value : null;
}

/** Where an article view came from, as a class: never the URL itself. */
export const REFERRAL_SOURCES = [
  'facebook',
  'search',
  'newsletter',
  'social',
  'other',
  'direct',
  'internal',
] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export function isReferralSource(value: unknown): value is ReferralSource {
  return typeof value === 'string' && (REFERRAL_SOURCES as readonly string[]).includes(value);
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|search\.brave|yandex|baidu)\./i;
const FACEBOOK = /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|instagram\.com)$/i;
const SOCIAL =
  /(^|\.)(t\.co|x\.com|twitter\.com|reddit\.com|linkedin\.com|nextdoor\.com|threads\.net|bsky\.app)$/i;

/**
 * Classifies a page view's referrer in the reader's browser. Only the class is sent: the
 * referrer URL never leaves the page. `?ref=newsletter` (D-M5-5) wins over the referrer.
 */
export function classifyReferral(input: {
  referrer: string;
  pageHost: string;
  search: string;
}): ReferralSource {
  if (/(^|[?&])ref=newsletter(&|$)/.test(input.search.replace(/^\?/, '&'))) return 'newsletter';
  if (!input.referrer) return 'direct';
  let host: string;
  try {
    host = new URL(input.referrer).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host === input.pageHost.toLowerCase()) return 'internal';
  if (FACEBOOK.test(host)) return 'facebook';
  if (SEARCH.test(`${host}.`)) return 'search';
  if (SOCIAL.test(host)) return 'social';
  return 'other';
}

/** What a weak funnel number means and where to look (owner, 2026-10-17). */
export const FUNNEL_ADVICE = {
  claims: 'Low claims: fix discovery (house ads, outreach, business pages in search).',
  trials: 'Trials not converting: fix the proof reports and the lead flow.',
  traffic: 'Low traffic: fix the content and the newsletter.',
} as const;

/** Below these a number reads as weak on Admin → Health (starting guesses, tuned with data). */
export const FUNNEL_FLOORS = {
  /** Active subscribers per 1,000 households, once a town is past its first month. */
  subscribersPer1k: 10,
  /** Claimed listings as a share of active ones. */
  claimRate: 0.02,
  /** Trials that became paid placements. */
  trialToPaid: 0.25,
} as const;

/**
 * Experiments (§11a-2): copy and placement variants assigned per town or per cohort, chosen by a
 * hash so a town always gets the same one, never per reader. The first variant is the control,
 * shown when an experiment isn't running. A decided experiment shows its winner everywhere.
 * Variants that change layout parts must keep the neighbor rule (§11a-2); `module-order` only
 * swaps the first two homepage modules on phones, which leaves the first-three set unchanged.
 */
export const EXPERIMENTS = {
  'signup-prompt': {
    label: 'Newsletter prompt heading',
    metric: 'subscribers per 1,000 households',
    variants: ['control', 'local-news'],
  },
  'second-article-offer': {
    label: 'Email offer after a reader’s second story',
    metric: 'sign-ups from the offer',
    variants: ['on', 'off'],
  },
  'module-order': {
    label: 'Sign-up box first on phones',
    metric: 'sign-ups from the homepage',
    variants: ['control', 'signup-first'],
  },
  'house-ad-copy': {
    label: 'Advertise house ad headline',
    metric: 'featured trials started',
    variants: ['control', 'reach-readers'],
  },
  'proof-report-wording': {
    label: 'Monthly proof report subject',
    metric: 'trial-to-paid conversion',
    variants: ['control', 'people-saw'],
  },
  // Revenue experiments (owner, 2026-10-17: "Grow ad and directory revenue").
  'upgrade-prompt-timing': {
    label: 'Owner page upgrade prompt: after claim approval and a good month, or a good month only',
    metric: 'featured trials started',
    variants: ['control', 'good-month-only'],
  },
  'advertise-tiers': {
    label: 'Advertise page: featured spots first, or the category sponsorship first',
    metric: 'featured trials started',
    variants: ['control', 'premium-first'],
  },
  // A price test varies by town or cohort, never by business: `hold` towns keep their prices
  // for the month instead of the monthly recalculation.
  'monthly-pricing': {
    label: 'Monthly price recalculation, or prices held',
    metric: 'revenue per town',
    variants: ['control', 'hold'],
  },
} as const satisfies Record<
  string,
  { label: string; metric: string; variants: readonly [string, ...string[]] }
>;
export type ExperimentKey = keyof typeof EXPERIMENTS;
export type ExperimentVariant<K extends ExperimentKey> =
  (typeof EXPERIMENTS)[K]['variants'][number];

/** FNV-1a, so assignment is stable across processes and needs nothing stored. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The variant a unit (a town id, or a cohort) gets in an experiment: the same every time. */
export function assignVariant<K extends ExperimentKey>(key: K, unit: string): ExperimentVariant<K> {
  const variants = EXPERIMENTS[key].variants as readonly ExperimentVariant<K>[];
  return variants[hash(`${key}:${unit}`) % variants.length]!;
}

export type ExperimentState = {
  status: 'off' | 'running' | 'decided';
  unit: 'town' | 'cohort';
  winner: string | null;
};

/**
 * Which variant a town shows: the control while off, the winner once decided (the network-wide
 * default), else its recorded assignment or, for a town assigned after the start, the hash.
 */
export function resolveVariant<K extends ExperimentKey>(
  key: K,
  state: ExperimentState | null,
  town: { id: string; cohort: string | null },
  recorded?: string | null,
): ExperimentVariant<K> {
  const variants = EXPERIMENTS[key].variants as readonly string[];
  const control = variants[0] as ExperimentVariant<K>;
  if (!state || state.status === 'off') return control;
  if (state.status === 'decided')
    return (
      state.winner && variants.includes(state.winner) ? state.winner : control
    ) as ExperimentVariant<K>;
  if (recorded && variants.includes(recorded)) return recorded as ExperimentVariant<K>;
  return assignVariant(key, state.unit === 'cohort' ? `cohort:${town.cohort ?? 'none'}` : town.id);
}
