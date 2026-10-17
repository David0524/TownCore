import {
  FUNNEL_ADVICE,
  FUNNEL_FLOORS,
  placementOf,
  REFERRAL_SOURCES,
  SIGNUP_PLACEMENTS,
  type ReferralSource,
  type SignupPlacement,
  type TownConfig,
} from '@towncore/config';
import {
  and,
  articleStatsDaily,
  businesses,
  eq,
  gte,
  inArray,
  isNotNull,
  ne,
  placements,
  referralStatsDaily,
  sources,
  sql,
  stripePrices,
  subscribers,
  towns,
  type Db,
} from '@towncore/db';

// Audience and self-serve revenue per town, launch cohort and platform (owner, 2026-10-17:
// "build traffic and self-serve revenue"). Everything is aggregate: subscriber counts, daily
// view counts by referral class and the directory's own rows. No reader is identified.
//
// Return visits: we can't count them without recognising a browser again (a cookie or a stored
// id), which D-M4-3 rules out. The nearest honest signal is views that came from the newsletter
// (`?ref=newsletter`), which are by definition readers coming back; it's shown as such.

const DAY = 86_400_000;
/** The window for views, referrals, sign-ups and trial starts. */
export const AUDIENCE_DAYS = 30;

/** The counts a town's funnel is built from; groups add them up, then derive the rates. */
export type FunnelCounts = {
  towns: number;
  /** Towns with a household figure, and the households and subscribers of just those towns. */
  townsWithHouseholds: number;
  households: number;
  subscribersInHouseholdTowns: number;
  subscribers: number;
  signups: Record<SignupPlacement | 'other', number>;
  views: number;
  referrals: Record<ReferralSource, number>;
  listings: number;
  claimed: number;
  trialStarts: number;
  trialsEnded: number;
  trialsConverted: number;
  /** Monthly recurring revenue from paid (not trialing) placements, in cents. */
  mrrCents: number;
};

export type FunnelRates = {
  subscribersPer1k: number | null;
  claimRate: number | null;
  trialToPaid: number | null;
  /** Share of views that came from the newsletter: our proxy for returning readers. */
  newsletterShare: number | null;
  /** Revenue per town per month, in dollars. */
  revenuePerTown: number | null;
  advice: Array<keyof typeof FUNNEL_ADVICE>;
};

export type TownAudience = {
  id: string;
  siteName: string;
  state: string;
  cohort: string | null;
  platform: string;
  householdsKnown: boolean;
  counts: FunnelCounts;
  rates: FunnelRates;
};

export type AudienceGroup = { key: string; counts: FunnelCounts; rates: FunnelRates };

export function emptyCounts(): FunnelCounts {
  return {
    towns: 0,
    townsWithHouseholds: 0,
    households: 0,
    subscribersInHouseholdTowns: 0,
    subscribers: 0,
    signups: Object.fromEntries([...SIGNUP_PLACEMENTS, 'other'].map((p) => [p, 0])) as Record<
      SignupPlacement | 'other',
      number
    >,
    views: 0,
    referrals: Object.fromEntries(REFERRAL_SOURCES.map((r) => [r, 0])) as Record<
      ReferralSource,
      number
    >,
    listings: 0,
    claimed: 0,
    trialStarts: 0,
    trialsEnded: 0,
    trialsConverted: 0,
    mrrCents: 0,
  };
}

export function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const out = emptyCounts();
  for (const key of Object.keys(out) as Array<keyof FunnelCounts>) {
    if (key === 'signups' || key === 'referrals') {
      const into = out[key] as Record<string, number>;
      for (const k of Object.keys(into))
        into[k] = (a[key] as Record<string, number>)[k]! + (b[key] as Record<string, number>)[k]!;
    } else (out[key] as number) = (a[key] as number) + (b[key] as number);
  }
  return out;
}

/** Rates from counts, with the owner's advice where a number is below its floor. */
export function funnelRates(c: FunnelCounts): FunnelRates {
  const subscribersPer1k =
    c.households > 0 ? (c.subscribersInHouseholdTowns / c.households) * 1000 : null;
  const claimRate = c.listings > 0 ? c.claimed / c.listings : null;
  const trialToPaid = c.trialsEnded > 0 ? c.trialsConverted / c.trialsEnded : null;
  const advice: FunnelRates['advice'] = [];
  if (subscribersPer1k !== null && subscribersPer1k < FUNNEL_FLOORS.subscribersPer1k)
    advice.push('traffic');
  if (claimRate !== null && claimRate < FUNNEL_FLOORS.claimRate) advice.push('claims');
  if (trialToPaid !== null && trialToPaid < FUNNEL_FLOORS.trialToPaid) advice.push('trials');
  return {
    subscribersPer1k,
    claimRate,
    trialToPaid,
    newsletterShare: c.views > 0 ? c.referrals.newsletter / c.views : null,
    revenuePerTown: c.towns > 0 ? c.mrrCents / 100 / c.towns : null,
    advice,
  };
}

/** The town's meeting platform (where most of its civic news starts), else "none". */
function meetingPlatform(rows: Array<{ kind: string; platform: string }>): string {
  const meeting =
    rows.find((r) => r.kind === 'agenda') ?? rows.find((r) => r.kind === 'meeting_video');
  return meeting?.platform ?? 'none';
}

/** Each town's funnel (towns that aren't paused). */
export async function townAudience(db: Db, now = new Date()): Promise<TownAudience[]> {
  const since = new Date(now.getTime() - AUDIENCE_DAYS * DAY);
  const sinceDay = since.toISOString().slice(0, 10);
  const out: TownAudience[] = [];
  for (const town of await db
    .select()
    .from(towns)
    .where(ne(towns.status, 'paused'))
    .orderBy(towns.siteName)) {
    const counts = emptyCounts();
    counts.towns = 1;
    const [subs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscribers)
      .where(and(eq(subscribers.townId, town.id), eq(subscribers.status, 'active')));
    counts.subscribers = subs?.n ?? 0;
    if (town.households && town.households > 0) {
      counts.townsWithHouseholds = 1;
      counts.households = town.households;
      counts.subscribersInHouseholdTowns = counts.subscribers;
    }
    // Sign-ups by the prompt used: consent given in the window, whatever came of it since.
    for (const row of await db
      .select({ source: subscribers.source, n: sql<number>`count(*)::int` })
      .from(subscribers)
      .where(and(eq(subscribers.townId, town.id), gte(subscribers.consentAt, since)))
      .groupBy(subscribers.source)) {
      const placement = placementOf(row.source);
      counts.signups[placement ?? 'other'] += row.n;
    }
    const [views] = await db
      .select({ n: sql<number>`coalesce(sum(${articleStatsDaily.views}), 0)::int` })
      .from(articleStatsDaily)
      .where(and(eq(articleStatsDaily.townId, town.id), gte(articleStatsDaily.day, sinceDay)));
    counts.views = views?.n ?? 0;
    for (const row of await db
      .select({
        source: referralStatsDaily.source,
        n: sql<number>`sum(${referralStatsDaily.views})::int`,
      })
      .from(referralStatsDaily)
      .where(and(eq(referralStatsDaily.townId, town.id), gte(referralStatsDaily.day, sinceDay)))
      .groupBy(referralStatsDaily.source)) {
      if (row.source in counts.referrals) counts.referrals[row.source as ReferralSource] += row.n;
    }
    const [listings] = await db
      .select({
        n: sql<number>`count(*)::int`,
        claimed: sql<number>`count(${businesses.claimedAt})::int`,
      })
      .from(businesses)
      .where(and(eq(businesses.townId, town.id), eq(businesses.active, true)));
    counts.listings = listings?.n ?? 0;
    counts.claimed = listings?.claimed ?? 0;
    Object.assign(counts, await trialCounts(db, town, since, now));
    const src = await db
      .select({ kind: sources.kind, platform: sources.platform })
      .from(sources)
      .where(and(eq(sources.townId, town.id), inArray(sources.kind, ['agenda', 'meeting_video'])));
    out.push({
      id: town.id,
      siteName: town.siteName,
      state: town.state,
      cohort: town.cohort,
      platform: meetingPlatform(src),
      householdsKnown: counts.townsWithHouseholds > 0,
      counts,
      rates: funnelRates(counts),
    });
  }
  return out;
}

/**
 * Trials, from placements: a business's first featured spot starts with the town's free days
 * (D-M6-6 as changed 2026-10-16), so its first ranked placement is the trial. It converted when
 * it was still running once the free days were over.
 */
async function trialCounts(
  db: Db,
  town: typeof towns.$inferSelect,
  since: Date,
  now: Date,
): Promise<Pick<FunnelCounts, 'trialStarts' | 'trialsEnded' | 'trialsConverted' | 'mrrCents'>> {
  const freeDays = (town.config as Partial<TownConfig>).pricing?.free_trial_days ?? 0;
  const rows = await db
    .select({
      businessId: placements.businessId,
      rank: placements.rank,
      status: placements.status,
      startsAt: placements.startsAt,
      endsAt: placements.endsAt,
      cents: stripePrices.unitAmountCents,
    })
    .from(placements)
    .leftJoin(stripePrices, eq(stripePrices.stripePriceId, placements.stripePriceId))
    .where(and(eq(placements.townId, town.id), isNotNull(placements.startsAt)))
    .orderBy(placements.startsAt);
  const firstRanked = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (row.rank !== null && !firstRanked.has(row.businessId)) firstRanked.set(row.businessId, row);
  const trials = freeDays > 0 ? [...firstRanked.values()] : [];
  const trialEnd = (r: (typeof rows)[number]) => r.startsAt!.getTime() + freeDays * DAY;
  const ended = trials.filter((r) => trialEnd(r) <= now.getTime());
  const converted = ended.filter(
    (r) =>
      r.status === 'active' ||
      (r.status !== 'pending' && r.endsAt !== null && r.endsAt.getTime() > trialEnd(r)),
  );
  const trialing = new Set(trials.filter((r) => trialEnd(r) > now.getTime()));
  const mrrCents = rows
    .filter((r) => r.status === 'active' && !trialing.has(r))
    .reduce((n, r) => n + (r.cents ?? 0), 0);
  return {
    trialStarts: trials.filter((r) => r.startsAt! >= since).length,
    trialsEnded: ended.length,
    trialsConverted: converted.length,
    mrrCents,
  };
}

/** Towns grouped by a key (cohort, platform, state), with their counts added up. */
export function groupAudience(
  rows: readonly TownAudience[],
  keyOf: (t: TownAudience) => string,
): AudienceGroup[] {
  const groups = new Map<string, FunnelCounts>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, addCounts(groups.get(key) ?? emptyCounts(), row.counts));
  }
  return [...groups]
    .map(([key, counts]) => ({ key, counts, rates: funnelRates(counts) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export const byCohort = (t: TownAudience) => t.cohort ?? 'not live';
export const byPlatform = (t: TownAudience) => t.platform;
export const byState = (t: TownAudience) => t.state;
