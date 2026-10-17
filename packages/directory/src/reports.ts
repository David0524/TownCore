import {
  and,
  businesses,
  eq,
  gte,
  inArray,
  isNotNull,
  leads,
  lt,
  placements,
  proofReports,
  slotStatsDaily,
  sql,
  towns,
  townVariant,
  type Db,
} from '@towncore/db';
import { CTA_SLOT } from './leads';
import { SPONSOR_SLOT } from './creatives';
import { sendDirectoryMail, siteOrigin, townMailDomain, type DirectoryMailDeps } from './mail';

// The monthly proof report (M6 PR E, D-M6-10): what a business got from its listing and paid
// placements. Shown in the owner portal; emailed on the 1st to businesses that paid that month.

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

/**
 * On the first days of a month, emails last month's report to each claimed business that had
 * an active paid placement in it. Once per business and month (proof_reports); the owner's
 * claim email only; never to a suppressed address.
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
    const paying = await db
      .selectDistinct({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        email: businesses.claimedByEmail,
      })
      .from(placements)
      .innerJoin(businesses, eq(businesses.id, placements.businessId))
      .where(
        and(
          eq(placements.townId, town.id),
          inArray(placements.status, ['active', 'canceled', 'expired']),
          isNotNull(placements.startsAt),
          lt(placements.startsAt, new Date(`${to}T00:00:00Z`)),
          sql`(${placements.endsAt} is null or ${placements.endsAt} >= ${`${from}T00:00:00Z`}::timestamptz)`,
          isNotNull(businesses.claimedByEmail),
        ),
      );
    if (paying.length === 0) continue;
    const mail = await townMailDomain(db, town.id);
    if (!mail) continue;
    // The subject line is an experiment per town or cohort (owner, 2026-10-17).
    const wording = await townVariant(db, 'proof-report-wording', town);
    for (const business of paying) {
      const totals = await proofReport(db, {
        businessId: business.id,
        timezone: town.timezone,
        month,
      });
      // Claim the month first, so a retry or a second worker never sends it twice.
      const [claimed] = await db
        .insert(proofReports)
        .values({ businessId: business.id, month, email: business.email!, totals, sentAt: now })
        .onConflictDoNothing()
        .returning({ id: proofReports.id });
      if (!claimed) continue;
      const monthName = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${from}T12:00:00Z`));
      await sendDirectoryMail(deps, mail, {
        to: business.email!,
        kind: 'proof_report',
        subject: reportSubject(wording, business.name, mail.siteName, monthName, totals),
        lines: [
          `Here is what your listing on ${mail.siteName} did in ${monthName}.`,
          `Listing views: ${totals.listingViews}. Sponsored card: ${totals.cardImpressions} views, ${totals.cardClicks} clicks.`,
          `Calls from the call button: ${totals.calls}. Quote requests: ${totals.quoteRequests}.`,
          'Views are counted without cookies or tracking: a view is the listing or card being on screen.',
        ],
        link: {
          href: `${siteOrigin(deps, mail.domain)}/owner/${business.slug}/report?month=${month}`,
          label: 'See the full report',
        },
      });
      sent++;
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
