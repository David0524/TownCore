import {
  and,
  articles,
  articleStatsDaily,
  businesses,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  leads,
  or,
  pageStatsDaily,
  placements,
  referralStatsDaily,
  slotStatsDaily,
  sql,
  stripePrices,
  subscribers,
  towns,
  type Db,
} from '@towncore/db';
import { uptimeFor, type Uptime } from './uptime';

// Admin → Analytics (owner, 2026-10-17): every site's age and up/down light, then its traffic,
// time on page, newsletter, advertisers and money. Everything is an aggregate of counters and
// the directory's own rows (D-M4-3): no reader is identified. Days are the towns' local dates
// as the counters stored them; the window starts that many UTC days back.

const DAY = 86_400_000;
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export type SiteTotals = {
  pageViews: number;
  storyViews: number;
  /** Mean seconds a page stayed visible, over visits that reported it. */
  avgEngagedSeconds: number | null;
  storyClicks: number;
  adImpressions: number;
  adClicks: number;
  leads: number;
  subscribers: number;
  newSubscribers: number;
  advertisers: number;
  trialing: number;
  /** Monthly recurring revenue from paid subscriptions (not in their free trial), in cents. */
  mrrCents: number;
  /** One-off weeks and months (newsletter, category) booked to start in the window, in cents. */
  bookedCents: number;
};

export type SiteRow = {
  id: string;
  slug: string;
  siteName: string;
  domain: string;
  state: string;
  status: string;
  cohort: string | null;
  createdAt: Date;
  liveAt: Date | null;
  /** Days since it went live, or since it was set up while it's a draft. */
  ageDays: number;
  uptime: Uptime;
  totals: SiteTotals;
};

export function emptyTotals(): SiteTotals {
  return {
    pageViews: 0,
    storyViews: 0,
    avgEngagedSeconds: null,
    storyClicks: 0,
    adImpressions: 0,
    adClicks: 0,
    leads: 0,
    subscribers: 0,
    newSubscribers: 0,
    advertisers: 0,
    trialing: 0,
    mrrCents: 0,
    bookedCents: 0,
  };
}

const dayString = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

/** Sums by town over the window, from each source table. */
async function totalsByTown(
  db: Db,
  townIds: string[],
  since: Date,
  now: Date,
): Promise<Map<string, SiteTotals>> {
  const out = new Map(townIds.map((id) => [id, emptyTotals()]));
  if (!townIds.length) return out;
  const sinceDay = dayString(since);
  const engaged = new Map<string, { seconds: number; samples: number }>();

  const pages = await db
    .select({
      townId: pageStatsDaily.townId,
      views: sql<number>`sum(${pageStatsDaily.views})`,
      seconds: sql<number>`sum(${pageStatsDaily.engagedSeconds})`,
      samples: sql<number>`sum(${pageStatsDaily.engagedSamples})`,
    })
    .from(pageStatsDaily)
    .where(and(inArray(pageStatsDaily.townId, townIds), gte(pageStatsDaily.day, sinceDay)))
    .groupBy(pageStatsDaily.townId);
  for (const r of pages) {
    out.get(r.townId)!.pageViews = num(r.views);
    engaged.set(r.townId, { seconds: num(r.seconds), samples: num(r.samples) });
  }

  const stories = await db
    .select({
      townId: articleStatsDaily.townId,
      views: sql<number>`sum(${articleStatsDaily.views})`,
      clicks: sql<number>`sum(${articleStatsDaily.listClicks})`,
    })
    .from(articleStatsDaily)
    .where(and(inArray(articleStatsDaily.townId, townIds), gte(articleStatsDaily.day, sinceDay)))
    .groupBy(articleStatsDaily.townId);
  for (const r of stories) {
    const t = out.get(r.townId)!;
    t.storyViews = num(r.views);
    t.storyClicks = num(r.clicks);
  }

  const ads = await db
    .select({
      townId: slotStatsDaily.townId,
      impressions: sql<number>`sum(${slotStatsDaily.impressions})`,
      clicks: sql<number>`sum(${slotStatsDaily.clicks})`,
    })
    .from(slotStatsDaily)
    .where(and(inArray(slotStatsDaily.townId, townIds), gte(slotStatsDaily.day, sinceDay)))
    .groupBy(slotStatsDaily.townId);
  for (const r of ads) {
    const t = out.get(r.townId)!;
    t.adImpressions = num(r.impressions);
    t.adClicks = num(r.clicks);
  }

  const leadRows = await db
    .select({ townId: leads.townId, n: sql<number>`count(*)` })
    .from(leads)
    .where(and(inArray(leads.townId, townIds), gte(leads.createdAt, since)))
    .groupBy(leads.townId);
  for (const r of leadRows) if (r.townId) out.get(r.townId)!.leads = num(r.n);

  const subs = await db
    .select({
      townId: subscribers.townId,
      active: sql<number>`count(*) filter (where ${subscribers.status} = 'active')`,
      fresh: sql<number>`count(*) filter (where ${subscribers.status} = 'active' and ${subscribers.confirmedAt} >= ${since.toISOString()})`,
    })
    .from(subscribers)
    .where(inArray(subscribers.townId, townIds))
    .groupBy(subscribers.townId);
  for (const r of subs) {
    const t = out.get(r.townId)!;
    t.subscribers = num(r.active);
    t.newSubscribers = num(r.fresh);
  }

  const paid = await db
    .select({
      townId: placements.townId,
      businessId: placements.businessId,
      period: placements.period,
      startsAt: placements.startsAt,
      trialEndsAt: placements.trialEndsAt,
      cents: stripePrices.unitAmountCents,
    })
    .from(placements)
    .leftJoin(stripePrices, eq(stripePrices.stripePriceId, placements.stripePriceId))
    .where(
      and(
        inArray(placements.townId, townIds),
        eq(placements.status, 'active'),
        or(isNull(placements.endsAt), gte(placements.endsAt, now)),
      ),
    );
  const advertisers = new Map<string, Set<string>>();
  for (const p of paid) {
    const t = out.get(p.townId)!;
    (advertisers.get(p.townId) ?? advertisers.set(p.townId, new Set()).get(p.townId)!).add(
      p.businessId,
    );
    const trialing = p.trialEndsAt !== null && p.trialEndsAt > now;
    if (p.period) {
      if (p.startsAt && p.startsAt >= since) t.bookedCents += p.cents ?? 0;
    } else if (trialing) t.trialing++;
    else t.mrrCents += p.cents ?? 0;
  }
  for (const [id, set] of advertisers) out.get(id)!.advertisers = set.size;

  for (const [id, e] of engaged)
    out.get(id)!.avgEngagedSeconds = e.samples > 0 ? e.seconds / e.samples : null;
  return out;
}

export function addTotals(rows: SiteTotals[]): SiteTotals {
  const sum = emptyTotals();
  let seconds = 0;
  let weight = 0;
  for (const r of rows) {
    for (const k of Object.keys(sum) as Array<keyof SiteTotals>)
      if (k !== 'avgEngagedSeconds') (sum[k] as number) += r[k] as number;
    if (r.avgEngagedSeconds !== null) {
      seconds += r.avgEngagedSeconds * r.pageViews;
      weight += r.pageViews;
    }
  }
  sum.avgEngagedSeconds = weight > 0 ? seconds / weight : null;
  return sum;
}

/** Every town: age, light, and the window's totals; live towns first, then by page views. */
export async function networkAnalytics(
  db: Db,
  opts: { days: AnalyticsRange; now?: Date },
): Promise<{ sites: SiteRow[]; totals: SiteTotals; days: number }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * DAY);
  const rows = await db.select().from(towns);
  const ids = rows.map((t) => t.id);
  const [totals, uptime] = await Promise.all([
    totalsByTown(db, ids, since, now),
    uptimeFor(db, ids, now),
  ]);
  const order = { live: 0, draft: 1, paused: 2 } as Record<string, number>;
  const sites = rows
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      siteName: t.siteName,
      domain: t.domain,
      state: t.state,
      status: t.status,
      cohort: t.cohort,
      createdAt: t.createdAt,
      liveAt: t.liveAt,
      ageDays: Math.max(0, Math.floor((now.getTime() - (t.liveAt ?? t.createdAt).getTime()) / DAY)),
      uptime: uptime.get(t.id)!,
      totals: totals.get(t.id)!,
    }))
    .sort(
      (a, b) =>
        (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
        b.totals.pageViews - a.totals.pageViews ||
        a.siteName.localeCompare(b.siteName),
    );
  return { sites, totals: addTotals(sites.map((s) => s.totals)), days: opts.days };
}

export type DailyPoint = {
  day: string;
  pageViews: number;
  storyViews: number;
  avgEngagedSeconds: number | null;
  newSubscribers: number;
};

export type SiteDetail = SiteRow & {
  daily: DailyPoint[];
  topStories: Array<{
    slug: string;
    headline: string;
    views: number;
    clicks: number;
    avgEngagedSeconds: number | null;
  }>;
  pageKinds: Array<{ kind: string; views: number; avgEngagedSeconds: number | null }>;
  referrals: Array<{ source: string; views: number }>;
  slots: Array<{ slot: string; impressions: number; clicks: number; leads: number }>;
  newsletter: { active: number; pending: number; left: number };
  advertisers: Array<{
    business: string;
    product: string;
    category: string | null;
    rank: number | null;
    since: Date | null;
    trialEndsAt: Date | null;
    period: string | null;
    monthlyCents: number | null;
  }>;
};

/** One town in depth over the window, with a point for every day. */
export async function siteAnalytics(
  db: Db,
  slug: string,
  opts: { days: AnalyticsRange; now?: Date },
): Promise<SiteDetail | null> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * DAY);
  const sinceDay = dayString(since);
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  if (!town) return null;
  const network = await networkAnalytics(db, { days: opts.days, now });
  const row = network.sites.find((s) => s.id === town.id)!;

  const days = Array.from({ length: opts.days + 1 }, (_, i) =>
    dayString(new Date(since.getTime() + i * DAY)),
  );
  const pageDays = await db
    .select({
      day: pageStatsDaily.day,
      views: sql<number>`sum(${pageStatsDaily.views})`,
      seconds: sql<number>`sum(${pageStatsDaily.engagedSeconds})`,
      samples: sql<number>`sum(${pageStatsDaily.engagedSamples})`,
    })
    .from(pageStatsDaily)
    .where(and(eq(pageStatsDaily.townId, town.id), gte(pageStatsDaily.day, sinceDay)))
    .groupBy(pageStatsDaily.day);
  const storyDays = await db
    .select({ day: articleStatsDaily.day, views: sql<number>`sum(${articleStatsDaily.views})` })
    .from(articleStatsDaily)
    .where(and(eq(articleStatsDaily.townId, town.id), gte(articleStatsDaily.day, sinceDay)))
    .groupBy(articleStatsDaily.day);
  const subDays = await db
    .select({
      day: sql<string>`to_char(${subscribers.confirmedAt} at time zone ${town.timezone}, 'YYYY-MM-DD')`,
      n: sql<number>`count(*)`,
    })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.townId, town.id),
        eq(subscribers.status, 'active'),
        gte(subscribers.confirmedAt, since),
      ),
    )
    .groupBy(sql`1`);
  const byDay = <T extends { day: string }>(list: T[]) => new Map(list.map((r) => [r.day, r]));
  const p = byDay(pageDays);
  const s = byDay(storyDays);
  const n = byDay(subDays);
  const daily = days.map((day) => {
    const page = p.get(day);
    const samples = num(page?.samples);
    return {
      day,
      pageViews: num(page?.views),
      storyViews: num(s.get(day)?.views),
      avgEngagedSeconds: samples > 0 ? num(page?.seconds) / samples : null,
      newSubscribers: num(n.get(day)?.n),
    };
  });

  const topStories = (
    await db
      .select({
        slug: articles.slug,
        headline: articles.headline,
        views: sql<number>`sum(${articleStatsDaily.views})`,
        clicks: sql<number>`sum(${articleStatsDaily.listClicks})`,
        seconds: sql<number>`sum(${articleStatsDaily.engagedSeconds})`,
        samples: sql<number>`sum(${articleStatsDaily.engagedSamples})`,
      })
      .from(articleStatsDaily)
      .innerJoin(articles, eq(articles.id, articleStatsDaily.articleId))
      .where(and(eq(articleStatsDaily.townId, town.id), gte(articleStatsDaily.day, sinceDay)))
      .groupBy(articles.slug, articles.headline)
      .orderBy(desc(sql`sum(${articleStatsDaily.views})`))
      .limit(10)
  ).map((r) => ({
    slug: r.slug,
    headline: r.headline,
    views: num(r.views),
    clicks: num(r.clicks),
    avgEngagedSeconds: num(r.samples) > 0 ? num(r.seconds) / num(r.samples) : null,
  }));

  const pageKinds = (
    await db
      .select({
        kind: pageStatsDaily.kind,
        views: sql<number>`sum(${pageStatsDaily.views})`,
        seconds: sql<number>`sum(${pageStatsDaily.engagedSeconds})`,
        samples: sql<number>`sum(${pageStatsDaily.engagedSamples})`,
      })
      .from(pageStatsDaily)
      .where(and(eq(pageStatsDaily.townId, town.id), gte(pageStatsDaily.day, sinceDay)))
      .groupBy(pageStatsDaily.kind)
  )
    .map((r) => ({
      kind: r.kind,
      views: num(r.views),
      avgEngagedSeconds: num(r.samples) > 0 ? num(r.seconds) / num(r.samples) : null,
    }))
    .sort((a, b) => b.views - a.views);

  const referrals = (
    await db
      .select({
        source: referralStatsDaily.source,
        views: sql<number>`sum(${referralStatsDaily.views})`,
      })
      .from(referralStatsDaily)
      .where(and(eq(referralStatsDaily.townId, town.id), gte(referralStatsDaily.day, sinceDay)))
      .groupBy(referralStatsDaily.source)
  )
    .map((r) => ({ source: r.source, views: num(r.views) }))
    .sort((a, b) => b.views - a.views);

  const slots = (
    await db
      .select({
        slot: slotStatsDaily.slot,
        impressions: sql<number>`sum(${slotStatsDaily.impressions})`,
        clicks: sql<number>`sum(${slotStatsDaily.clicks})`,
        leads: sql<number>`sum(${slotStatsDaily.leads})`,
      })
      .from(slotStatsDaily)
      .where(and(eq(slotStatsDaily.townId, town.id), gte(slotStatsDaily.day, sinceDay)))
      .groupBy(slotStatsDaily.slot)
  )
    .map((r) => ({
      slot: r.slot,
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      leads: num(r.leads),
    }))
    .sort((a, b) => b.impressions - a.impressions);

  const [subs] = await db
    .select({
      active: sql<number>`count(*) filter (where ${subscribers.status} = 'active')`,
      pending: sql<number>`count(*) filter (where ${subscribers.status} = 'pending')`,
      left: sql<number>`count(*) filter (where ${subscribers.status} in ('unsubscribed', 'bounced', 'complained'))`,
    })
    .from(subscribers)
    .where(eq(subscribers.townId, town.id));

  const advertisers = (
    await db
      .select({
        business: businesses.name,
        product: placements.product,
        category: placements.category,
        rank: placements.rank,
        since: placements.startsAt,
        trialEndsAt: placements.trialEndsAt,
        period: placements.period,
        cents: stripePrices.unitAmountCents,
      })
      .from(placements)
      .innerJoin(businesses, eq(businesses.id, placements.businessId))
      .leftJoin(stripePrices, eq(stripePrices.stripePriceId, placements.stripePriceId))
      .where(
        and(
          eq(placements.townId, town.id),
          eq(placements.status, 'active'),
          or(isNull(placements.endsAt), gte(placements.endsAt, now)),
        ),
      )
      .orderBy(placements.startsAt)
  ).map((a) => ({ ...a, monthlyCents: a.period ? null : (a.cents ?? null) }));

  return {
    ...row,
    daily,
    topStories,
    pageKinds,
    referrals,
    slots,
    newsletter: { active: num(subs?.active), pending: num(subs?.pending), left: num(subs?.left) },
    advertisers: advertisers.map(({ cents: _cents, ...a }) => a),
  };
}
