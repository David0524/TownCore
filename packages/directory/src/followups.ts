import { directoryCategory, featuredName, type FeaturedRank } from '@towncore/config';
import {
  and,
  asc,
  businessFollowups,
  businesses,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  logAdminAction,
  lte,
  ne,
  placements,
  sql,
  stripePrices,
  towns,
  type Db,
} from '@towncore/db';
import { openFeaturedRanks } from './stripe/checkout';
import { offerName } from './stripe/prices';
import {
  ownerMailToken,
  ownerUnsubscribe,
  sendDirectoryMail,
  townMailDomain,
  verifyOwnerMailToken,
  type DirectoryMailDeps,
  type MailOutcome,
} from './mail';
import { storyListingMatches } from './outreach';

// Follow-ups to business owners (owner, 2026-10-17): the free trial ends in 3 days, a competitor
// took a featured spot in their category, a story named the business, or another business in
// their category nearby claimed its listing. Each is a draft first. The worker sends drafts by
// itself only in towns where an admin switched on the standing approval (Admin → Directory,
// audited, off by default); elsewhere they wait for staff to press Send (Rule 10). Every message
// goes only to the owner's claim email, carries one-click List-Unsubscribe, and is never sent to
// a suppressed or unsubscribed address.

export type FollowupKind = 'trial_ending' | 'competitor_spot' | 'story_mention' | 'nearby_claim';

const dayMs = 86_400_000;
/** The trial reminder goes this long before the first charge. */
export const TRIAL_NOTICE_DAYS = 3;
/** New spots, stories and claims this recent make follow-ups. */
const RECENT_DAYS = 7;
/** At most one follow-up (other than the trial reminder) per business in this many days. */
export const FOLLOWUP_QUIET_DAYS = 7;
/** Sends per town per hour, so a busy day goes out gradually. */
export const FOLLOWUPS_PER_HOUR = 20;
/** Drafts not sent within this long are stale and skipped. */
const STALE_DAYS = 7;
/** "Nearby" for claims, when both listings have coordinates. */
const NEARBY_KM = 8;

type Draft = {
  townId: string;
  businessId: string;
  kind: FollowupKind;
  dedupeKey: string;
  toEmail: string;
  subject: string;
  lines: string[];
  linkHref: string;
  linkLabel: string;
};

type Owner = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  email: string;
  lat: number | null;
  lng: number | null;
};

function km(a: Owner, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

const dateLabel = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone }).format(d);

/** Claimed, active listings whose owners haven't opted out. */
async function owners(db: Db, townId: string): Promise<Owner[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      category: businesses.category,
      email: businesses.claimedByEmail,
      lat: businesses.lat,
      lng: businesses.lng,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.active, true),
        isNotNull(businesses.claimedAt),
        isNotNull(businesses.claimedByEmail),
        isNull(businesses.ownerMailOptOutAt),
      ),
    );
  return rows.map((r) => ({ ...r, email: r.email! }));
}

/** Businesses holding a featured spot now (they don't need a sales follow-up). */
async function featuredNow(db: Db, townId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: placements.businessId })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, 'sponsored_slot'),
        inArray(placements.status, ['active', 'held', 'pending']),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Builds this town's follow-up drafts. Idempotent: one row per event (dedupe key). A business
 * gets at most one follow-up a week besides the trial reminder.
 */
export async function draftFollowups(
  db: Db,
  townId: string,
  now = new Date(),
): Promise<{ created: number }> {
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);
  const origin = `https://${town.domain}`;
  const all = await owners(db, townId);
  const byId = new Map(all.map((o) => [o.id, o]));
  const featured = await featuredNow(db, townId);
  const recent = new Date(now.getTime() - RECENT_DAYS * dayMs);
  const drafts: Draft[] = [];
  const ownerPage = (o: Owner) => `${origin}/owner/${encodeURIComponent(o.slug)}`;

  // 1. The trial ends within 3 days: the first charge is coming.
  const trials = await db
    .select({ placement: placements, cents: stripePrices.unitAmountCents })
    .from(placements)
    .leftJoin(stripePrices, eq(stripePrices.stripePriceId, placements.stripePriceId))
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.status, 'active'),
        gt(placements.trialEndsAt, now),
        lte(placements.trialEndsAt, new Date(now.getTime() + TRIAL_NOTICE_DAYS * dayMs)),
      ),
    );
  for (const { placement, cents } of trials) {
    const owner = byId.get(placement.businessId);
    if (!owner) continue;
    const offer = offerName(
      placement.product as 'enhanced' | 'sponsored_slot',
      placement.rank as FeaturedRank | null,
    );
    const when = dateLabel(placement.trialEndsAt!, town.timezone);
    drafts.push({
      townId,
      businessId: owner.id,
      kind: 'trial_ending',
      dedupeKey: `trial:${placement.id}:${placement.trialEndsAt!.toISOString().slice(0, 10)}`,
      toEmail: placement.buyerEmail ?? owner.email,
      subject: `Your free trial of ${offer} on ${town.siteName} ends ${when}`,
      lines: [
        `Your free trial of ${offer} for ${owner.name} on ${town.siteName} ends on ${when}.`,
        cents
          ? `After that, Stripe charges $${cents / 100} a month to the card you added. You can keep it, or cancel before then and pay nothing.`
          : 'After that, Stripe charges the card you added each month. You can keep it, or cancel before then and pay nothing.',
        'Your owner page shows what your listing did this month.',
      ],
      linkHref: ownerPage(owner),
      linkLabel: 'Manage billing or cancel',
    });
  }

  // 2. A competitor took a featured spot in their category.
  const spots = await db
    .select({ placement: placements })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, 'sponsored_slot'),
        eq(placements.status, 'active'),
        gte(placements.startsAt, recent),
      ),
    );
  for (const { placement } of spots) {
    const category = directoryCategory(placement.category ?? '');
    if (!category) continue;
    const open = await openFeaturedRanks(db, townId, category.slug, now);
    if (open.length === 0) continue;
    for (const owner of all) {
      if (owner.category !== category.slug || owner.id === placement.businessId) continue;
      if (featured.has(owner.id)) continue;
      drafts.push({
        townId,
        businessId: owner.id,
        kind: 'competitor_spot',
        dedupeKey: `competitor:${placement.id}:${owner.id}`,
        toEmail: owner.email,
        subject: `A ${category.singular} took a featured spot on ${town.siteName}`,
        lines: [
          `Another ${category.singular} just took ${placement.rank ? featuredName(placement.rank as FeaturedRank).toLowerCase() : 'a featured spot'} in ${category.name.toLowerCase()} on ${town.siteName}. Featured businesses show above every other listing, labeled Sponsored, and receive the quote requests readers send from the category page.`,
          `Still open: ${open.map((r) => `#${r}`).join(', ')}. Your owner page has the prices and the first-month offer.`,
        ],
        linkHref: ownerPage(owner),
        linkLabel: 'See open spots',
      });
    }
  }

  // 3. A story named the business.
  for (const { story, listing } of await storyListingMatches(db, townId, now)) {
    const owner = byId.get(listing.id);
    if (!owner) continue;
    drafts.push({
      townId,
      businessId: owner.id,
      kind: 'story_mention',
      dedupeKey: `story:${story.id}:${owner.id}`,
      toEmail: owner.email,
      subject: `${owner.name} in ${town.siteName}`,
      lines: [
        `${town.siteName} mentioned ${owner.name} in a story${story.publishedAt ? ` published on ${dateLabel(story.publishedAt, town.timezone)}` : ''}: "${story.headline}"`,
        `Read it: ${origin}/news/${story.slug}`,
        'Your listing shows the stories that mention you. Keep its hours, phone and description current from your owner page.',
      ],
      linkHref: ownerPage(owner),
      linkLabel: 'Update your listing',
    });
  }

  // 4. Another business in their category nearby claimed its listing.
  const claims = await db
    .select({
      id: businesses.id,
      category: businesses.category,
      lat: businesses.lat,
      lng: businesses.lng,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.active, true),
        gte(businesses.claimedAt, recent),
      ),
    );
  for (const claim of claims) {
    const category = directoryCategory(claim.category ?? '');
    if (!category) continue;
    for (const owner of all) {
      if (owner.category !== category.slug || owner.id === claim.id) continue;
      if (featured.has(owner.id)) continue;
      const distance = km(owner, claim);
      if (distance !== null && distance > NEARBY_KM) continue;
      drafts.push({
        townId,
        businessId: owner.id,
        kind: 'nearby_claim',
        dedupeKey: `claim:${claim.id}:${owner.id}`,
        toEmail: owner.email,
        subject: `Another ${category.singular} near you joined ${town.siteName}`,
        lines: [
          `Another ${category.singular} in ${town.name} just claimed its listing on ${town.siteName}, so readers comparing ${category.name.toLowerCase()} now see its hours and details too.`,
          'A complete listing (hours, phone, a short description and photos) helps you stand out, and a featured spot puts you above every other listing, labeled Sponsored.',
        ],
        linkHref: ownerPage(owner),
        linkLabel: 'Update your listing',
      });
    }
  }

  // One follow-up a week per business, besides the trial reminder.
  const quietSince = new Date(now.getTime() - FOLLOWUP_QUIET_DAYS * dayMs);
  const recentRows = drafts.length
    ? await db
        .select({ businessId: businessFollowups.businessId })
        .from(businessFollowups)
        .where(
          and(
            inArray(
              businessFollowups.businessId,
              drafts.map((d) => d.businessId),
            ),
            ne(businessFollowups.kind, 'trial_ending'),
            gte(businessFollowups.createdAt, quietSince),
          ),
        )
    : [];
  const quiet = new Set(recentRows.map((r) => r.businessId));
  let created = 0;
  for (const draft of drafts) {
    if (draft.kind !== 'trial_ending' && quiet.has(draft.businessId)) continue;
    const [row] = await db
      .insert(businessFollowups)
      .values({ ...draft, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: businessFollowups.id });
    if (!row) continue;
    created++;
    if (draft.kind !== 'trial_ending') quiet.add(draft.businessId);
  }
  return { created };
}

type FollowupRow = typeof businessFollowups.$inferSelect;

/** Sends one draft. Opted-out and suppressed owners are skipped with a note, never mailed. */
async function deliver(
  deps: DirectoryMailDeps,
  row: FollowupRow,
  sentBy: string | null,
  now: Date,
): Promise<'sent' | 'skipped' | 'waiting'> {
  const { db } = deps;
  const [business] = await db
    .select({ optOut: businesses.ownerMailOptOutAt })
    .from(businesses)
    .where(eq(businesses.id, row.businessId));
  const skip = async (note: string) => {
    await db
      .update(businessFollowups)
      .set({ status: 'skipped', note, decidedAt: now, sentBy })
      .where(and(eq(businessFollowups.id, row.id), eq(businessFollowups.status, 'draft')));
    return 'skipped' as const;
  };
  if (!business || business.optOut) return skip('unsubscribed');
  const mail = await townMailDomain(db, row.townId);
  // No live mail domain or no unsubscribe secret yet: it waits.
  if (!mail || !deps.tokenSecret) return 'waiting';
  // Claim the row first, so two senders never mail it twice.
  const [claimed] = await db
    .update(businessFollowups)
    .set({ status: 'sent', decidedAt: now, sentBy })
    .where(and(eq(businessFollowups.id, row.id), eq(businessFollowups.status, 'draft')))
    .returning({ id: businessFollowups.id });
  if (!claimed) return 'skipped';
  const origin = new URL(row.linkHref).origin;
  let outcome: MailOutcome;
  try {
    outcome = await sendDirectoryMail(deps, mail, {
      to: row.toEmail,
      kind: `followup_${row.kind}`,
      subject: row.subject,
      lines: row.lines,
      link: { href: row.linkHref, label: row.linkLabel },
      unsubscribe: ownerUnsubscribe(origin, ownerMailToken(deps.tokenSecret, row.businessId)),
      postalAddress: deps.postalAddress ?? null,
    });
  } catch (error) {
    // Not sent: back to a draft for the next run.
    await db
      .update(businessFollowups)
      .set({ status: 'draft', decidedAt: null, sentBy: null })
      .where(eq(businessFollowups.id, row.id));
    throw error;
  }
  if (outcome === 'sent') return 'sent';
  await db
    .update(businessFollowups)
    .set({ status: 'skipped', note: outcome })
    .where(eq(businessFollowups.id, row.id));
  return 'skipped';
}

/**
 * The worker's sender: in towns with the standing approval on, mails waiting drafts oldest first,
 * up to FOLLOWUPS_PER_HOUR an hour per town. Stale drafts are skipped everywhere. Towns without
 * the approval send nothing here; their drafts wait for staff.
 */
export async function sendApprovedFollowups(
  deps: DirectoryMailDeps,
  now = deps.now?.() ?? new Date(),
): Promise<{ sent: number; skipped: number }> {
  const { db } = deps;
  await db
    .update(businessFollowups)
    .set({ status: 'skipped', note: 'stale', decidedAt: now })
    .where(
      and(
        eq(businessFollowups.status, 'draft'),
        lte(businessFollowups.createdAt, new Date(now.getTime() - STALE_DAYS * dayMs)),
      ),
    );
  let sent = 0;
  let skipped = 0;
  const approved = await db
    .select({ id: towns.id })
    .from(towns)
    .where(isNotNull(towns.businessMailApprovedAt));
  for (const town of approved) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(businessFollowups)
      .where(
        and(
          eq(businessFollowups.townId, town.id),
          eq(businessFollowups.status, 'sent'),
          gte(businessFollowups.decidedAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    const budget = FOLLOWUPS_PER_HOUR - n;
    if (budget <= 0) continue;
    const rows = await db
      .select()
      .from(businessFollowups)
      .where(and(eq(businessFollowups.townId, town.id), eq(businessFollowups.status, 'draft')))
      .orderBy(asc(businessFollowups.createdAt))
      .limit(budget);
    for (const row of rows) {
      const result = await deliver(deps, row, null, now);
      if (result === 'sent') sent++;
      else if (result === 'skipped') skipped++;
      else break;
    }
  }
  return { sent, skipped };
}

export class FollowupError extends Error {}

/** Staff press Send on one draft (the Rule 10 approval for that message). Audited. */
export async function sendFollowup(
  deps: DirectoryMailDeps,
  input: { followupId: string; staffId: string },
): Promise<'sent' | 'skipped'> {
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select()
    .from(businessFollowups)
    .where(and(eq(businessFollowups.id, input.followupId), eq(businessFollowups.status, 'draft')));
  if (!row) throw new FollowupError('This follow-up was already sent or skipped.');
  const result = await deliver(deps, row, input.staffId, now);
  if (result === 'waiting')
    throw new FollowupError('This town can’t send yet (no live mail domain or MAIL_TOKEN_SECRET).');
  await logAdminAction(deps.db, {
    staffId: input.staffId,
    action: 'directory.followup.send',
    target: { type: 'business_followup', id: row.id },
    detail: { businessId: row.businessId, kind: row.kind, result },
  });
  return result;
}

/** Staff skip a draft. Audited. */
export async function skipFollowup(
  db: Db,
  input: { followupId: string; staffId: string },
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .update(businessFollowups)
    .set({ status: 'skipped', note: 'staff', sentBy: input.staffId, decidedAt: now })
    .where(and(eq(businessFollowups.id, input.followupId), eq(businessFollowups.status, 'draft')))
    .returning();
  if (!row) throw new FollowupError('This follow-up was already sent or skipped.');
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'directory.followup.skip',
    target: { type: 'business_followup', id: row.id },
    detail: { businessId: row.businessId, kind: row.kind },
  });
}

/**
 * The per-town standing approval for automatic follow-ups (Rule 10). Only admins may change it
 * (the caller checks the role); every change is audited.
 */
export async function setFollowupApproval(
  db: Db,
  input: { townId: string; staffId: string; on: boolean },
  now = new Date(),
): Promise<void> {
  await db
    .update(towns)
    .set(
      input.on
        ? { businessMailApprovedAt: now, businessMailApprovedBy: input.staffId }
        : { businessMailApprovedAt: null, businessMailApprovedBy: null },
    )
    .where(eq(towns.id, input.townId));
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.on ? 'directory.followups.approve' : 'directory.followups.revoke',
    target: { type: 'town', id: input.townId },
    detail: {},
  });
}

export type PendingFollowup = {
  id: string;
  kind: FollowupKind;
  toEmail: string;
  subject: string;
  lines: string[];
  link: { href: string; label: string };
  createdAt: Date;
  business: { name: string; slug: string; category: string | null };
  town: { id: string; name: string };
};

/** Drafts waiting for a person (or the next automatic run), oldest first. */
export async function pendingFollowups(db: Db, limit = 50): Promise<PendingFollowup[]> {
  const rows = await db
    .select({ f: businessFollowups, business: businesses, town: towns })
    .from(businessFollowups)
    .innerJoin(businesses, eq(businesses.id, businessFollowups.businessId))
    .innerJoin(towns, eq(towns.id, businessFollowups.townId))
    .where(eq(businessFollowups.status, 'draft'))
    .orderBy(asc(businessFollowups.createdAt))
    .limit(limit);
  return rows.map(({ f, business, town }) => ({
    id: f.id,
    kind: f.kind,
    toEmail: f.toEmail,
    subject: f.subject,
    lines: f.lines,
    link: { href: f.linkHref, label: f.linkLabel },
    createdAt: f.createdAt,
    business: { name: business.name, slug: business.slug, category: business.category },
    town: { id: town.id, name: town.name },
  }));
}

/** Each town's standing approval, for Admin → Directory. */
export async function followupApprovals(db: Db) {
  return db
    .select({
      id: towns.id,
      name: towns.name,
      status: towns.status,
      approvedAt: towns.businessMailApprovedAt,
    })
    .from(towns)
    .orderBy(asc(towns.name));
}

/**
 * The unsubscribe link in reports and follow-ups: the owner stops both, and waiting drafts are
 * skipped. Returns the business, or null when the token isn't valid for this town.
 */
export async function ownerOptOut(
  db: Db,
  input: { secret: string; token: string; townId: string },
  now = new Date(),
): Promise<{ id: string; name: string; email: string | null } | null> {
  const id = verifyOwnerMailToken(input.secret, input.token);
  if (!id) return null;
  const [business] = await db
    .update(businesses)
    .set({
      ownerMailOptOutAt: sql`coalesce(${businesses.ownerMailOptOutAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(businesses.id, id), eq(businesses.townId, input.townId)))
    .returning({ id: businesses.id, name: businesses.name, email: businesses.claimedByEmail });
  if (!business) return null;
  await db
    .update(businessFollowups)
    .set({ status: 'skipped', note: 'unsubscribed', decidedAt: now })
    .where(and(eq(businessFollowups.businessId, id), eq(businessFollowups.status, 'draft')));
  return business;
}

/** The business an unsubscribe token names, without changing anything (the page's GET). */
export async function ownerForMailToken(
  db: Db,
  input: { secret: string; token: string; townId: string },
) {
  const id = verifyOwnerMailToken(input.secret, input.token);
  if (!id) return null;
  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      email: businesses.claimedByEmail,
      optOut: businesses.ownerMailOptOutAt,
    })
    .from(businesses)
    .where(and(eq(businesses.id, id), eq(businesses.townId, input.townId)));
  return business ?? null;
}
