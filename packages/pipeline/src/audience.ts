import {
  FUNNEL_ADVICE,
  FUNNEL_FLOORS,
  placementOf,
  PRICING_RULES,
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
  directoryWaitlist,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
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
  /** Featured spot-days sold and available over the pricing window (60 days). */
  spotDaysSold: number;
  spotDaysAvailable: number;
  /** Businesses waiting for a featured spot. */
  waitlist: number;
  /** Monthly placements that ended in the window, and those running at its start. */
  churned: number;
  activeAtStart: number;
};

export type FunnelRates = {
  subscribersPer1k: number | null;
  claimRate: number | null;
  trialToPaid: number | null;
  /** Share of views that came from the newsletter: our proxy for returning readers. */
  newsletterShare: number | null;
  /** Revenue per town per month, in dollars. */
  revenuePerTown: number | null;
  /** Monthly revenue per 1,000 story views in the window, in dollars. */
  revenuePer1kVisits: number | null;
  /** Featured spots sold, as a share of the time available. */
  fillRate: number | null;
  /** Monthly placements lost in the window, as a share of those running at its start. */
  churn: number | null;
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
    spotDaysSold: 0,
    spotDaysAvailable: 0,
    waitlist: 0,
    churned: 0,
    activeAtStart: 0,
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
    revenuePer1kVisits: c.views > 0 ? c.mrrCents / 100 / (c.views / 1000) : null,
    fillRate: c.spotDaysAvailable > 0 ? c.spotDaysSold / c.spotDaysAvailable : null,
    churn: c.activeAtStart > 0 ? c.churned / c.activeAtStart : null,
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
    Object.assign(counts, await inventoryCounts(db, town.id, since, now));
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

/**
 * Featured-spot inventory and churn: spot-days sold against 3 spots in every category the town
 * lists over the pricing window, the waitlist, and monthly placements that ended in the window.
 */
async function inventoryCounts(
  db: Db,
  townId: string,
  since: Date,
  now: Date,
): Promise<
  Pick<
    FunnelCounts,
    'spotDaysSold' | 'spotDaysAvailable' | 'waitlist' | 'churned' | 'activeAtStart'
  >
> {
  const windowStart = new Date(now.getTime() - PRICING_RULES.windowDays * DAY);
  const [cats] = await db
    .select({ n: sql<number>`count(distinct ${businesses.category})::int` })
    .from(businesses)
    .where(and(eq(businesses.townId, townId), eq(businesses.active, true)));
  const spots = await db
    .select({ startsAt: placements.startsAt, endsAt: placements.endsAt })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, 'sponsored_slot'),
        inArray(placements.status, ['active', 'canceled', 'expired']),
        isNotNull(placements.startsAt),
      ),
    );
  let sold = 0;
  for (const s of spots) {
    const from = Math.max(s.startsAt!.getTime(), windowStart.getTime());
    const to = Math.min(s.endsAt?.getTime() ?? now.getTime(), now.getTime());
    if (to > from) sold += (to - from) / DAY;
  }
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(directoryWaitlist)
    .where(and(eq(directoryWaitlist.townId, townId), eq(directoryWaitlist.status, 'waiting')));
  const monthly = await db
    .select({ status: placements.status, startsAt: placements.startsAt, endsAt: placements.endsAt })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        isNull(placements.period),
        inArray(placements.status, ['active', 'canceled', 'expired']),
        isNotNull(placements.startsAt),
      ),
    );
  const runningAt = (r: (typeof monthly)[number], at: Date) =>
    r.startsAt! < at && (r.endsAt === null || r.endsAt >= at);
  return {
    spotDaysSold: Math.round(sold),
    spotDaysAvailable: (cats?.n ?? 0) * 3 * PRICING_RULES.windowDays,
    waitlist: waiting?.n ?? 0,
    churned: monthly.filter(
      (r) => r.status !== 'active' && r.endsAt !== null && r.endsAt >= since && r.endsAt <= now,
    ).length,
    activeAtStart: monthly.filter((r) => runningAt(r, since)).length,
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
