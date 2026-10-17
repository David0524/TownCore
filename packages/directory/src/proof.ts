import { directoryCategory, PROOF_MINIMUMS } from '@towncore/config';
import {
  and,
  eq,
  gte,
  isNotNull,
  leads,
  lte,
  placements,
  slotStatsDaily,
  sql,
  subscribers,
  type Db,
} from '@towncore/db';
import { CTA_SLOT } from './leads';
import type { FeaturedUplift } from './reports';

// Proof beats pitch (owner, 2026-10-17): what owners and advertisers are shown comes from real
// counts, with the basis stated, and a line is left out (or says "not enough data yet") when the
// numbers are too thin to mean anything. Nothing here is per reader: only aggregate counters.

const DAY = 86_400_000;

export type ListingProof = {
  days: number;
  views: number;
  calls: number;
  quotes: number;
  /** Enough views for the personal line ("seen 214 times") to mean something. */
  enough: boolean;
};

/** A listing's own numbers over the last `days` days. */
export async function listingProof(
  db: Db,
  businessId: string,
  now = new Date(),
  days = 30,
): Promise<ListingProof> {
  const since = new Date(now.getTime() - days * DAY);
  const [views] = await db
    .select({ n: sql<number>`coalesce(sum(${slotStatsDaily.impressions}), 0)::int` })
    .from(slotStatsDaily)
    .where(
      and(
        eq(slotStatsDaily.businessId, businessId),
        eq(slotStatsDaily.slot, CTA_SLOT),
        gte(slotStatsDaily.day, since.toISOString().slice(0, 10)),
      ),
    );
  const counts = await db
    .select({ kind: leads.kind, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.businessId, businessId), gte(leads.createdAt, since)))
    .groupBy(leads.kind);
  const n = views?.n ?? 0;
  return {
    days,
    views: n,
    calls: counts.find((c) => c.kind === 'call')?.n ?? 0,
    quotes: counts.find((c) => c.kind === 'form')?.n ?? 0,
    enough: n >= PROOF_MINIMUMS.listingViews,
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Your listing was seen 214 times in the last 30 days and got 3 calls", or null when thin. */
export function proofLine(proof: ListingProof): string | null {
  if (!proof.enough) return null;
  const extras = [
    proof.calls ? plural(proof.calls, 'call') : null,
    proof.quotes ? plural(proof.quotes, 'quote request') : null,
  ].filter(Boolean);
  return `Your listing was seen ${plural(proof.views, 'time')} in the last ${proof.days} days${extras.length ? ` and got ${extras.join(' and ')}` : ''}.`;
}

/** Businesses running a paid placement in the town now. */
export async function advertiserCount(db: Db, townId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${placements.businessId})::int` })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.status, 'active'),
        isNotNull(placements.startsAt),
        lte(placements.startsAt, now),
      ),
    );
  return row?.n ?? 0;
}

/** "12 Boca Raton businesses advertise here", only when true and at least the minimum. */
export function socialProofLine(count: number, townName: string): string | null {
  return count >= PROOF_MINIMUMS.advertisers
    ? `${count.toLocaleString('en-US')} ${townName} businesses advertise here.`
    : null;
}

/** Active newsletter subscribers, or null below the minimum (then copy stays generic). */
export async function readerReach(db: Db, townId: string): Promise<number | null> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscribers)
    .where(and(eq(subscribers.townId, townId), eq(subscribers.status, 'active')));
  const n = row?.n ?? 0;
  return n >= PROOF_MINIMUMS.readers ? n : null;
}

/**
 * A peer comparison from the network's real numbers, with the basis: "Featured restaurants
 * listings got about 3× the listing views…", or the uplift's own "not enough data yet".
 */
export function peerLine(uplift: FeaturedUplift, categoryName: string | null): string {
  if (uplift.status !== 'ok') return uplift.basis;
  if (uplift.unfeaturedViews <= 0 || uplift.featuredViews <= uplift.unfeaturedViews * 1.2)
    return `Featured listings got about ${uplift.featuredViews} listing views a month, against ${uplift.unfeaturedViews} without a spot. ${uplift.basis}`;
  const times = Math.round((uplift.featuredViews / uplift.unfeaturedViews) * 2) / 2;
  const scope = uplift.basis.includes(`${categoryName?.toLowerCase()} listings`)
    ? `in ${categoryName}`
    : 'across categories';
  return `Featured listings ${scope} got about ${times}× the listing views of listings without a spot. ${uplift.basis}`;
}

/** "4 people asked for a plumber quote in Boca Raton this month." */
export function missedLine(input: {
  count: number;
  category: string;
  townName: string;
  period: string;
}): string | null {
  const category = directoryCategory(input.category);
  if (!category || input.count <= 0) return null;
  return `${input.count === 1 ? '1 person' : `${input.count} people`} asked for a ${category.singular} quote in ${input.townName} ${input.period}. Featured businesses received ${input.count === 1 ? 'it' : 'them'}.`;
}

export type CategoryRevenue = {
  townId: string;
  category: string;
  /** Featured spot-days sold over available, last 60 days. */
  fillRate: number;
  waitlist: number;
  trialStarts: number;
  trialsEnded: number;
  trialsConverted: number;
  /** Paid placements that ended in the last 30 days, and those active 30 days ago. */
  churned: number;
  activeAtStart: number;
  mrrCents: number;
};

/**
 * Revenue numbers per town and category for Admin → Directory → Pricing: fill, waitlist, trials,
 * churn and monthly revenue, from placements and Stripe prices only.
 */
export async function categoryRevenue(db: Db, now = new Date()): Promise<CategoryRevenue[]> {
  const window = 60 * DAY;
  const month = 30 * DAY;
  const rows = await db.execute<{
    town_id: string;
    category: string;
    spot_days: number;
    trial_starts: number;
    trials_ended: number;
    trials_converted: number;
    churned: number;
    active_at_start: number;
    mrr_cents: number;
    waitlist: number;
  }>(sql`
    with p as (
      select pl.*, sp.unit_amount_cents as cents
      from placements pl left join stripe_prices sp on sp.stripe_price_id = pl.stripe_price_id
      where pl.category is not null and pl.product = 'sponsored_slot' and pl.starts_at is not null
    )
    select p.town_id, p.category,
      coalesce(sum(greatest(0, extract(epoch from (
        least(coalesce(p.ends_at, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)
        - greatest(p.starts_at, ${new Date(now.getTime() - window).toISOString()}::timestamptz)
      )) / 86400)) filter (where p.status in ('active', 'canceled', 'expired')), 0)::float as spot_days,
      count(*) filter (where p.trial_ends_at is not null and p.starts_at >= ${new Date(now.getTime() - month).toISOString()}::timestamptz)::int as trial_starts,
      count(*) filter (where p.trial_ends_at is not null and p.trial_ends_at <= ${now.toISOString()}::timestamptz)::int as trials_ended,
      count(*) filter (where p.trial_ends_at is not null and p.trial_ends_at <= ${now.toISOString()}::timestamptz
        and (p.status = 'active' or p.ends_at > p.trial_ends_at))::int as trials_converted,
      count(*) filter (where p.status in ('canceled', 'expired') and p.ends_at >= ${new Date(now.getTime() - month).toISOString()}::timestamptz)::int as churned,
      count(*) filter (where p.starts_at < ${new Date(now.getTime() - month).toISOString()}::timestamptz
        and (p.ends_at is null or p.ends_at >= ${new Date(now.getTime() - month).toISOString()}::timestamptz)
        and p.status in ('active', 'canceled', 'expired'))::int as active_at_start,
      coalesce(sum(p.cents) filter (where p.status = 'active'
        and (p.trial_ends_at is null or p.trial_ends_at <= ${now.toISOString()}::timestamptz)), 0)::int as mrr_cents,
      (select count(*) from directory_waitlist w where w.town_id = p.town_id and w.category = p.category
        and w.status = 'waiting')::int as waitlist
    from p group by p.town_id, p.category
    union
    select w.town_id, w.category, 0, 0, 0, 0, 0, 0, 0, count(*)::int
    from directory_waitlist w
    where w.status = 'waiting' and not exists (select 1 from p where p.town_id = w.town_id and p.category = w.category)
    group by w.town_id, w.category
  `);
  return [...rows].map((r) => ({
    townId: r.town_id,
    category: r.category,
    fillRate: Math.min(1, Number(r.spot_days) / (3 * 60)),
    waitlist: Number(r.waitlist),
    trialStarts: Number(r.trial_starts),
    trialsEnded: Number(r.trials_ended),
    trialsConverted: Number(r.trials_converted),
    churned: Number(r.churned),
    activeAtStart: Number(r.active_at_start),
    mrrCents: Number(r.mrr_cents),
  }));
}
