import { directoryCategory } from '@towncore/config';
import {
  and,
  businesses,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  leads,
  lt,
  or,
  placements,
  proofReports,
  slotStatsDaily,
  sql,
  towns,
  townVariant,
  type Db,
} from '@towncore/db';
import { CTA_SLOT, QUOTE_SLOT } from './leads';
import { SPONSOR_SLOT } from './creatives';
import {
  ownerMailToken,
  ownerUnsubscribe,
  sendDirectoryMail,
  siteOrigin,
  townMailDomain,
  type DirectoryMailDeps,
} from './mail';

// The monthly proof report (M6 PR E, D-M6-10): what a business got from its listing and paid
// placements. Shown in the owner portal and emailed on the 1st to every claimed business, paying
// or not (owner, 2026-10-17). An owner who doesn't pay also sees what a featured spot did for
// listings like theirs, from real counts across our towns with the basis stated (or a plain
// "not enough data yet"), and how many quote requests in their category went to paying
// businesses.

export type ProofTotals = {
  /** Times the listing's contact area was on screen (its page was read that far). */
  listingViews: number;
  /** The sponsored card, on its category page. */
  cardImpressions: number;
  cardClicks: number;
  calls: number;
  quoteRequests: number;
};

/** "2026-10" → the first day of that month and of the next, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** The previous calendar month in a time zone, as YYYY-MM. */
export function previousMonth(now: Date, timeZone: string): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export async function proofReport(
  db: Db,
  input: { businessId: string; timezone: string; month: string },
): Promise<ProofTotals> {
  const { from, to } = monthRange(input.month);
  const stats = await db
    .select({
      slot: slotStatsDaily.slot,
      impressions: sql<number>`coalesce(sum(${slotStatsDaily.impressions}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${slotStatsDaily.clicks}), 0)::int`,
    })
    .from(slotStatsDaily)
    .where(
      and(
        eq(slotStatsDaily.businessId, input.businessId),
        gte(slotStatsDaily.day, from),
        lt(slotStatsDaily.day, to),
      ),
    )
    .groupBy(slotStatsDaily.slot);
  const bySlot = new Map(stats.map((s) => [s.slot, s]));
  const leadCounts = await db
    .select({ kind: leads.kind, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.businessId, input.businessId),
        sql`to_char(${leads.createdAt} at time zone ${input.timezone}, 'YYYY-MM') = ${input.month}`,
      ),
    )
    .groupBy(leads.kind);
  const leadsOf = (kind: 'call' | 'form') => leadCounts.find((l) => l.kind === kind)?.n ?? 0;
  return {
    listingViews: bySlot.get(CTA_SLOT)?.impressions ?? 0,
    cardImpressions: bySlot.get(SPONSOR_SLOT)?.impressions ?? 0,
    cardClicks: bySlot.get(SPONSOR_SLOT)?.clicks ?? 0,
    calls: leadsOf('call'),
    quoteRequests: leadsOf('form'),
  };
}

/** Featured spots that count toward the uplift: paid, started, any status since. */
const PAID_STATUSES = ['active', 'canceled', 'expired'] as const;
/** The uplift looks back this far. */
export const UPLIFT_DAYS = 90;
/** Fewer than this many listings on either side (or featured days) is "not enough data yet". */
export const UPLIFT_MIN = { featured: 3, unfeatured: 5, featuredDays: 60 };

export type FeaturedUplift =
  | {
      status: 'ok';
      /** Listing views a month for a featured listing, and for one without a spot. */
      featuredViews: number;
      unfeaturedViews: number;
      /** Quote requests a month, the same way. */
      featuredQuotes: number;
      unfeaturedQuotes: number;
      /** Where the numbers come from, in a sentence for the owner. */
      basis: string;
    }
  | { status: 'thin'; basis: string };

const dayMs = 86_400_000;
const perMonth = (count: number, days: number) => (days > 0 ? (count / days) * 30 : 0);

/**
 * What a featured spot did for listings like this one: listing views and quote requests a month
 * for listings while they held a featured spot, against claimed listings that held none, over
 * the last 90 days in every town. The listing's own category first; all categories when the
 * category alone is too thin; "not enough data yet" below that. Payment never changes organic
 * order, so the difference is what the labeled card and the quote form bring.
 */
export async function featuredUplift(
  db: Db,
  input: { category: string | null },
  now = new Date(),
): Promise<FeaturedUplift> {
  const since = new Date(now.getTime() - UPLIFT_DAYS * dayMs);
  const category = directoryCategory(input.category ?? '');
  for (const scope of category ? [category.slug, null] : [null]) {
    const spots = await db
      .select({
        businessId: placements.businessId,
        startsAt: placements.startsAt,
        endsAt: placements.endsAt,
      })
      .from(placements)
      .where(
        and(
          eq(placements.product, 'sponsored_slot'),
          inArray(placements.status, [...PAID_STATUSES]),
          isNotNull(placements.startsAt),
          lt(placements.startsAt, now),
          or(isNull(placements.endsAt), gt(placements.endsAt, since)),
          scope ? eq(placements.category, scope) : undefined,
        ),
      );
    // Days each business was featured inside the window.
    const featuredDays = new Map<string, Array<[number, number]>>();
    for (const spot of spots) {
      const from = Math.max(spot.startsAt!.getTime(), since.getTime());
      const to = Math.min(spot.endsAt?.getTime() ?? now.getTime(), now.getTime());
      if (to > from)
        featuredDays.set(spot.businessId, [
          ...(featuredDays.get(spot.businessId) ?? []),
          [from, to],
        ]);
    }
    const featuredIds = [...featuredDays.keys()];
    const totalFeaturedDays = [...featuredDays.values()]
      .flat()
      .reduce((n, [a, b]) => n + (b - a) / dayMs, 0);
    const others = await db
      .select({ id: businesses.id, claimedAt: businesses.claimedAt })
      .from(businesses)
      .where(
        and(
          isNotNull(businesses.claimedAt),
          eq(businesses.active, true),
          scope ? eq(businesses.category, scope) : undefined,
          sql`not exists (select 1 from ${placements} where ${placements.businessId} = ${businesses.id}
            and ${placements.product} = 'sponsored_slot' and ${placements.startsAt} is not null
            and (${placements.endsAt} is null or ${placements.endsAt} > ${since.toISOString()}::timestamptz))`,
        ),
      );
    const scopeName = scope
      ? `${directoryCategory(scope)!.name.toLowerCase()} listings`
      : 'listings';
    if (
      featuredIds.length < UPLIFT_MIN.featured ||
      totalFeaturedDays < UPLIFT_MIN.featuredDays ||
      others.length < UPLIFT_MIN.unfeatured
    ) {
      if (scope) continue;
      return {
        status: 'thin',
        basis: `Not enough data yet: we compare featured and unfeatured listings once at least ${UPLIFT_MIN.featured} featured and ${UPLIFT_MIN.unfeatured} claimed unfeatured listings have ${UPLIFT_DAYS} days of counts (now ${featuredIds.length} and ${others.length}).`,
      };
    }
    const sinceDay = since.toISOString().slice(0, 10);
    const views = await db
      .select({
        businessId: slotStatsDaily.businessId,
        day: slotStatsDaily.day,
        n: slotStatsDaily.impressions,
      })
      .from(slotStatsDaily)
      .where(
        and(
          eq(slotStatsDaily.slot, CTA_SLOT),
          gte(slotStatsDaily.day, sinceDay),
          inArray(slotStatsDaily.businessId, [...featuredIds, ...others.map((o) => o.id)]),
        ),
      );
    const quotes = await db
      .select({ businessId: leads.businessId, at: leads.createdAt })
      .from(leads)
      .where(
        and(
          eq(leads.kind, 'form'),
          gte(leads.createdAt, since),
          inArray(leads.businessId, [...featuredIds, ...others.map((o) => o.id)]),
        ),
      );
    const whileFeatured = (businessId: string | null, at: number) =>
      (featuredDays.get(businessId ?? '') ?? []).some(([a, b]) => at >= a && at < b);
    const dayAt = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
    // An unfeatured listing counts from its claim (or the window's start).
    const otherFrom = new Map(
      others.map((o) => [o.id, Math.max(o.claimedAt!.getTime(), since.getTime())]),
    );
    const isOther = (businessId: string | null, at: number) =>
      at >= (otherFrom.get(businessId ?? '') ?? Infinity);
    const otherDays = others.reduce(
      (n, o) => n + (now.getTime() - Math.max(o.claimedAt!.getTime(), since.getTime())) / dayMs,
      0,
    );
    let fv = 0;
    let uv = 0;
    for (const v of views) {
      if (whileFeatured(v.businessId, dayAt(v.day))) fv += v.n;
      else if (isOther(v.businessId, dayAt(v.day))) uv += v.n;
    }
    let fq = 0;
    let uq = 0;
    for (const q of quotes) {
      if (whileFeatured(q.businessId, q.at.getTime())) fq++;
      else if (isOther(q.businessId, q.at.getTime())) uq++;
    }
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      status: 'ok',
      featuredViews: round(perMonth(fv, totalFeaturedDays)),
      unfeaturedViews: round(perMonth(uv, otherDays)),
      featuredQuotes: round(perMonth(fq, totalFeaturedDays)),
      unfeaturedQuotes: round(perMonth(uq, otherDays)),
      basis: `Averages across our towns over the last ${UPLIFT_DAYS} days: ${featuredIds.length} ${scopeName} while they held a featured spot, against ${others.length} claimed ${scopeName} without one. Counted without cookies; a past average, not a promise.`,
    };
  }
  // Unreachable: the unscoped pass always returns.
  return { status: 'thin', basis: 'Not enough data yet.' };
}

/**
 * Quote requests in a category in a month (one per reader request, however many businesses it
 * went to). They go only to businesses with a featured spot (D-M6-9), so for an owner without
 * one this is what they missed.
 */
export async function categoryQuoteRequests(
  db: Db,
  input: { townId: string; category: string; timezone: string; month: string },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct coalesce(${leads.requestId}, ${leads.id}))::int` })
    .from(leads)
    .where(
      and(
        eq(leads.townId, input.townId),
        eq(leads.kind, 'form'),
        eq(leads.slot, QUOTE_SLOT),
        sql`${leads.meta}->>'category' = ${input.category}`,
        sql`to_char(${leads.createdAt} at time zone ${input.timezone}, 'YYYY-MM') = ${input.month}`,
      ),
    );
  return row?.n ?? 0;
}

/** Whether the business had a paid placement during the month (it then gets quote requests). */
export async function paidInMonth(
  db: Db,
  businessId: string,
  month: string,
  product?: 'sponsored_slot',
): Promise<boolean> {
  const { from, to } = monthRange(month);
  const [row] = await db
    .select({ id: placements.id })
    .from(placements)
    .where(
      and(
        eq(placements.businessId, businessId),
        product ? eq(placements.product, product) : undefined,
        inArray(placements.status, [...PAID_STATUSES]),
        isNotNull(placements.startsAt),
        lt(placements.startsAt, new Date(`${to}T00:00:00Z`)),
        sql`(${placements.endsAt} is null or ${placements.endsAt} >= ${`${from}T00:00:00Z`}::timestamptz)`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The report's lines for an owner without a featured spot that month. */
export function pitchLines(input: {
  siteName: string;
  categoryName: string | null;
  missed: number;
  uplift: FeaturedUplift;
}): string[] {
  const lines: string[] = [];
  if (input.categoryName)
    lines.push(
      input.missed === 1
        ? `1 quote request for ${input.categoryName.toLowerCase()} on ${input.siteName} went to businesses with a featured spot.`
        : `${input.missed} quote requests for ${input.categoryName.toLowerCase()} on ${input.siteName} went to businesses with a featured spot.`,
    );
  if (input.uplift.status === 'ok')
    lines.push(
      `What a featured spot did for listings like yours: about ${input.uplift.featuredViews} listing views and ${input.uplift.featuredQuotes} quote requests a month, against ${input.uplift.unfeaturedViews} and ${input.uplift.unfeaturedQuotes} without one. ${input.uplift.basis}`,
    );
  else lines.push(`What a featured spot would add: ${input.uplift.basis}`);
  return lines;
}

/**
 * On the first days of a month, emails last month's report to every claimed business (paying or
 * not, once the town's standing approval for business mail is on) that hasn't opted out. Once per business and month (proof_reports); the owner's claim
 * email only; never to a suppressed or unsubscribed address. Reports carry one-click
 * List-Unsubscribe; without MAIL_TOKEN_SECRET (no unsubscribe link) only paying businesses get
 * one, as before.
 */
export async function sendMonthlyReports(
  deps: DirectoryMailDeps,
  now = deps.now?.() ?? new Date(),
): Promise<{ sent: number }> {
  const { db } = deps;
  let sent = 0;
  for (const town of await db.select().from(towns)) {
    const localDay = Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: town.timezone, day: 'numeric' }).format(now),
    );
    if (localDay > 3) continue;
    const month = previousMonth(now, town.timezone);
    const { from, to } = monthRange(month);
    const claimed = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        category: businesses.category,
        email: businesses.claimedByEmail,
      })
      .from(businesses)
      .where(
        and(
          eq(businesses.townId, town.id),
          eq(businesses.active, true),
          isNotNull(businesses.claimedByEmail),
          lt(businesses.claimedAt, new Date(`${to}T00:00:00Z`)),
          isNull(businesses.ownerMailOptOutAt),
        ),
      );
    if (claimed.length === 0) continue;
    const mail = await townMailDomain(db, town.id);
    if (!mail) continue;
    // The subject line is an experiment per town or cohort (owner, 2026-10-17).
    const wording = await townVariant(db, 'proof-report-wording', town);
    const origin = siteOrigin(deps, mail.domain);
    const monthName = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${from}T12:00:00Z`));
    const uplifts = new Map<string, FeaturedUplift>();
    for (const business of claimed) {
      const paying = await paidInMonth(db, business.id, month);
      // Unpaid owners get the report by email only where an admin gave the town's standing
      // approval for business mail (Rule 10); paying owners get theirs as before (D-M6-10).
      if (!paying && (!deps.tokenSecret || !town.businessMailApprovedAt)) continue;
      const featured = await paidInMonth(db, business.id, month, 'sponsored_slot');
      const totals = await proofReport(db, {
        businessId: business.id,
        timezone: town.timezone,
        month,
      });
      const category = directoryCategory(business.category ?? '');
      let pitch: string[] = [];
      if (!featured) {
        const key = category?.slug ?? '';
        if (!uplifts.has(key))
          uplifts.set(key, await featuredUplift(db, { category: category?.slug ?? null }, now));
        pitch = pitchLines({
          siteName: mail.siteName,
          categoryName: category?.name ?? null,
          missed: category
            ? await categoryQuoteRequests(db, {
                townId: town.id,
                category: category.slug,
                timezone: town.timezone,
                month,
              })
            : 0,
          uplift: uplifts.get(key)!,
        });
      }
      // Claim the month first, so a retry or a second worker never sends it twice.
      const [row] = await db
        .insert(proofReports)
        .values({
          businessId: business.id,
          month,
          email: business.email!,
          totals: { ...totals, featured, pitch },
          sentAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: proofReports.id });
      if (!row) continue;
      const outcome = await sendDirectoryMail(deps, mail, {
        to: business.email!,
        kind: 'proof_report',
        subject: reportSubject(wording, business.name, mail.siteName, monthName, totals),
        lines: [
          `Here is what your listing on ${mail.siteName} did in ${monthName}.`,
          `Listing views: ${totals.listingViews}.${featured ? ` Sponsored card: ${totals.cardImpressions} views, ${totals.cardClicks} clicks.` : ''}`,
          `Calls from the call button: ${totals.calls}. Quote requests: ${totals.quoteRequests}.`,
          ...pitch,
          'Views are counted without cookies or tracking: a view is the listing or card being on screen.',
        ],
        link: {
          href: `${origin}/owner/${business.slug}/report?month=${month}`,
          label: featured ? 'See the full report' : 'See the full report and open spots',
        },
        ...(deps.tokenSecret
          ? {
              unsubscribe: ownerUnsubscribe(origin, ownerMailToken(deps.tokenSecret, business.id)),
              postalAddress: deps.postalAddress ?? null,
            }
          : {}),
      });
      if (outcome === 'sent') sent++;
    }
  }
  return { sent };
}

/** The proof report's subject: the control names the month; `people-saw` leads with the views. */
export function reportSubject(
  wording: 'control' | 'people-saw',
  businessName: string,
  siteName: string,
  monthName: string,
  totals: { listingViews: number; cardImpressions: number },
): string {
  const seen = totals.listingViews + totals.cardImpressions;
  if (wording === 'people-saw' && seen > 0)
    return `${seen.toLocaleString('en-US')} ${seen === 1 ? 'view' : 'views'} of ${businessName} on ${siteName} in ${monthName}`;
  return `${businessName} on ${siteName}: your ${monthName} report`;
}
