import { randomUUID } from 'node:crypto';
import { directoryCategory, maxSponsoredPerCategory } from '@towncore/config';
import {
  and,
  asc,
  businesses,
  campaigns,
  eq,
  gte,
  inArray,
  isNotNull,
  leads,
  placements,
  slotStatsDaily,
  sql,
  type Db,
} from '@towncore/db';
import { parseAddress } from '@towncore/mail';
import { normalizePhone } from './owners';
import { sendDirectoryMail, siteOrigin, townMailDomain, type DirectoryMailDeps } from './mail';

// Leads and slot statistics (M6 PR E). Quote requests go only to claimed businesses that pay
// for a sponsored slot in the category (D-M6-9): they asked for leads by buying. Call-button
// taps are logged as leads; there is no paid call tracking (D-M6-8). Slot counts are cookieless.

export const QUOTE_SLOT = 'directory.quote-request';
export const CTA_SLOT = 'directory.business.cta';
export const QUOTE_LIMITS = { perIpPerHour: 5, perEmailPerDay: 3, message: 1000 };

export type QuoteRecipient = { id: string; name: string; email: string; slug: string };

/** Claimed businesses with an active sponsored slot in the category, first sold first. */
export async function quoteRecipients(
  db: Db,
  townId: string,
  category: string,
): Promise<QuoteRecipient[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      email: businesses.claimedByEmail,
      slug: businesses.slug,
    })
    .from(placements)
    .innerJoin(businesses, eq(businesses.id, placements.businessId))
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, 'sponsored_slot'),
        eq(placements.category, category),
        eq(placements.status, 'active'),
        eq(businesses.active, true),
        isNotNull(businesses.claimedAt),
        isNotNull(businesses.claimedByEmail),
      ),
    )
    .orderBy(asc(placements.startsAt))
    .limit(maxSponsoredPerCategory);
  return rows.map((r) => ({ ...r, email: r.email! }));
}

export type QuoteInput = {
  townId: string;
  category: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  /** "Send my request to these businesses" was ticked. */
  consent: boolean;
  ip: string | null;
  honeypot?: string | null;
};

export type QuoteOutcome =
  | { status: 'sent'; to: string[] }
  | { status: 'invalid' | 'rate_limited' | 'unavailable' | 'no_recipients' };

const day = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

/** Routes one quote request to up to 3 sponsored businesses, each logged as a lead. */
export async function submitQuote(
  deps: DirectoryMailDeps & { timezone: string },
  input: QuoteInput,
): Promise<QuoteOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  if (input.honeypot?.trim()) return { status: 'sent', to: [] };
  const category = directoryCategory(input.category);
  const name = input.name.trim().slice(0, 100);
  const email = input.email.length <= 254 ? parseAddress(input.email.trim())?.address : undefined;
  const message = input.message.trim();
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (!category || !name || !email || !message || !input.consent) return { status: 'invalid' };
  if (message.length > QUOTE_LIMITS.message || (input.phone?.trim() && !phone))
    return { status: 'invalid' };

  const recipients = await quoteRecipients(db, input.townId, category.slug);
  if (recipients.length === 0) return { status: 'no_recipients' };
  const mail = await townMailDomain(db, input.townId);
  if (!mail) return { status: 'unavailable' };

  const since = (ms: number) => gte(leads.createdAt, new Date(now.getTime() - ms));
  const count = async (where: ReturnType<typeof and>) =>
    (
      await db
        .select({ n: sql<number>`count(distinct ${leads.requestId})::int` })
        .from(leads)
        .where(where)
    )[0]?.n ?? 0;
  if (
    input.ip &&
    (await count(and(eq(leads.ip, input.ip), since(3_600_000)))) >= QUOTE_LIMITS.perIpPerHour
  )
    return { status: 'rate_limited' };
  if (
    (await count(
      and(
        eq(leads.kind, 'form'),
        sql`lower(${leads.meta}->>'email') = ${email}`,
        since(86_400_000),
      ),
    )) >= QUOTE_LIMITS.perEmailPerDay
  )
    return { status: 'rate_limited' };

  const requestId = randomUUID();
  for (const to of recipients) {
    await db.insert(leads).values({
      businessId: to.id,
      kind: 'form',
      townId: input.townId,
      slot: QUOTE_SLOT,
      requestId,
      ip: input.ip,
      meta: { name, email, phone, message, category: category.slug },
      createdAt: now,
    });
    await countSlot(db, input.townId, day(now, deps.timezone), QUOTE_SLOT, null, to.id, 'leads');
    await sendDirectoryMail(deps, mail, {
      to: to.email,
      replyTo: email,
      kind: 'quote_request',
      subject: `Quote request from ${mail.siteName}: ${category.singular}`,
      lines: [
        `${name} asked for a quote from ${category.name.toLowerCase()} on ${mail.siteName}, and chose to send it to ${to.name} among up to ${maxSponsoredPerCategory} sponsored businesses.`,
        `Message: ${message}`,
        `Email: ${email}${phone ? ` · Phone: ${phone}` : ''}`,
        'Reply to this email to answer them directly.',
      ],
      link: {
        href: `${siteOrigin(deps, mail.domain)}/owner/${to.slug}/report`,
        label: 'See your leads this month',
      },
    });
  }
  return { status: 'sent', to: recipients.map((r) => r.name) };
}

/** A tap on a listing's call button (D-M6-8). */
export async function logCall(
  db: Db,
  input: { townId: string; timezone: string; slug: string },
  now = new Date(),
): Promise<boolean> {
  const [listing] = await db
    .select({ id: businesses.id, phone: businesses.phone })
    .from(businesses)
    .where(and(eq(businesses.townId, input.townId), eq(businesses.slug, input.slug)));
  if (!listing?.phone) return false;
  await db.insert(leads).values({
    businessId: listing.id,
    kind: 'call',
    townId: input.townId,
    slot: CTA_SLOT,
    createdAt: now,
  });
  await countSlot(db, input.townId, day(now, input.timezone), CTA_SLOT, null, listing.id, 'leads');
  return true;
}

type Counter = 'impressions' | 'clicks' | 'leads';

async function countSlot(
  db: Db,
  townId: string,
  dayKey: string,
  slot: string,
  campaignId: string | null,
  businessId: string | null,
  counter: Counter,
  by = 1,
) {
  await db
    .insert(slotStatsDaily)
    .values({ townId, day: dayKey, slot, campaignId, businessId, [counter]: by })
    .onConflictDoUpdate({
      target: [
        slotStatsDaily.townId,
        slotStatsDaily.day,
        slotStatsDaily.slot,
        slotStatsDaily.campaignId,
        slotStatsDaily.businessId,
      ],
      set: { [counter]: sql`${slotStatsDaily[counter]} + ${by}` },
    });
}

export type SlotEvent = {
  slot: string;
  kind: 'impression' | 'click';
  campaignId?: string | null;
  businessId?: string | null;
};

/**
 * Counts what the slot beacon reports. A campaign's business is looked up here, never taken
 * from the browser; ids that aren't this town's are dropped.
 */
export async function recordSlotEvents(
  db: Db,
  input: { townId: string; timezone: string; events: SlotEvent[] },
  now = new Date(),
): Promise<number> {
  const events = input.events.slice(0, 40);
  const campaignIds = [...new Set(events.map((e) => e.campaignId).filter((x): x is string => !!x))];
  const businessIds = [...new Set(events.map((e) => e.businessId).filter((x): x is string => !!x))];
  const campaignRows = campaignIds.length
    ? await db
        .select({ id: campaigns.id, businessId: placements.businessId })
        .from(campaigns)
        .leftJoin(placements, eq(placements.id, campaigns.placementId))
        .where(and(eq(campaigns.townId, input.townId), inArray(campaigns.id, campaignIds)))
    : [];
  const campaignBusiness = new Map(campaignRows.map((r) => [r.id, r.businessId]));
  const knownBusinesses = new Set(
    businessIds.length
      ? (
          await db
            .select({ id: businesses.id })
            .from(businesses)
            .where(and(eq(businesses.townId, input.townId), inArray(businesses.id, businessIds)))
        ).map((r) => r.id)
      : [],
  );
  const dayKey = day(now, input.timezone);
  let counted = 0;
  for (const event of events) {
    const campaignId =
      event.campaignId && campaignBusiness.has(event.campaignId) ? event.campaignId : null;
    if (event.campaignId && !campaignId) continue;
    const businessId = campaignId
      ? (campaignBusiness.get(campaignId) ?? null)
      : event.businessId && knownBusinesses.has(event.businessId)
        ? event.businessId
        : null;
    if (event.businessId && !campaignId && !businessId) continue;
    try {
      await countSlot(
        db,
        input.townId,
        dayKey,
        event.slot,
        campaignId,
        businessId,
        event.kind === 'impression' ? 'impressions' : 'clicks',
      );
      counted++;
    } catch (error) {
      // The campaign or business was deleted since we looked it up: nothing to count.
      if ((error as { cause?: { code?: string } }).cause?.code !== '23503') throw error;
    }
  }
  return counted;
}
