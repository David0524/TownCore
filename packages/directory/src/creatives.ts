import { creativeSchema, maxSponsoredPerCategory } from '@towncore/config';
import {
  adminActions,
  and,
  businesses,
  campaigns,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  logAdminAction,
  lt,
  ne,
  or,
  placements,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { ownerListings } from './owners';

// Sponsor cards (M6 PR D2, D-M6-7): the owner of a featured spot writes a short card; it becomes
// a `campaigns` row in their category, and shows only once staff approve it. Spot #1 is the
// category's Top spot (`directory.topspot`); #2 and #3 are the sponsored cards below it
// (`directory.category.top`), in rank order. The "Sponsored" label is added by the slot code,
// never by the owner.

export const SPONSOR_SLOT = 'directory.category.top';
export const TOP_SPOT_SLOT = 'directory.topspot';
/** A booked newsletter week shows in the issue's top sponsor slot. */
export const NEWSLETTER_SLOT = 'newsletter.top';
/** A booked category month shows in the category page's header slot. */
export const CATEGORY_SPONSOR_SLOT = 'directory.category.exclusive';

/** Where a featured spot's card shows. */
export const slotForRank = (rank: number | null) => (rank === 1 ? TOP_SPOT_SLOT : SPONSOR_SLOT);

/** Where a placement's card shows. */
export function slotForPlacement(p: { product: string; rank: number | null }): string {
  if (p.product === 'newsletter') return NEWSLETTER_SLOT;
  if (p.product === 'exclusive') return CATEGORY_SPONSOR_SLOT;
  return slotForRank(p.rank);
}

/** Cards a slot shows at once in a category: the Top spot one, the sponsored cards the rest. */
const slotCap = (slot: string) => (slot === TOP_SPOT_SLOT ? 1 : maxSponsoredPerCategory - 1);
export const CARD_LIMITS = { headline: 70, body: 160 };

export type SponsorCard = {
  campaignId: string;
  status: 'waiting' | 'live' | 'rejected' | 'ended';
  headline: string;
  body: string | null;
  note: string | null;
};

type CampaignRow = typeof campaigns.$inferSelect;

function card(row: CampaignRow, note: string | null): SponsorCard {
  const creative = creativeSchema.safeParse(row.creative);
  const status =
    row.status === 'draft'
      ? 'waiting'
      : row.status === 'active'
        ? 'live'
        : note
          ? 'rejected'
          : 'ended';
  return {
    campaignId: row.id,
    status,
    headline: creative.success ? creative.data.headline : '',
    body: creative.success ? (creative.data.body ?? null) : null,
    note,
  };
}

/** The listing's sponsor cards for its current placement: the live one and any waiting edit. */
export async function sponsorCards(db: Db, placementId: string): Promise<SponsorCard[]> {
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.placementId, placementId))
    // A waiting version first, then the newest.
    .orderBy(sql`(${campaigns.status} = 'draft') desc`, desc(campaigns.createdAt))
    .limit(5);
  const notes = rows.length
    ? await db
        .select({ targetId: adminActions.targetId, detail: adminActions.detail })
        .from(adminActions)
        .where(
          and(
            eq(adminActions.action, 'directory.card.reject'),
            inArray(
              adminActions.targetId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const noteOf = new Map(
    notes.map((n) => [n.targetId, ((n.detail ?? {}) as { note?: string }).note ?? 'Not approved']),
  );
  return rows.map((r) => card(r, noteOf.get(r.id) ?? null));
}

export type SubmitResult =
  { ok: true } | { ok: false; error: 'no_placement' | 'headline' | 'body' | 'not_owner' };

/**
 * The owner submits (or edits) the card for their featured spot, or for one booked week or month
 * (`placementId`). A new version waits for staff; the live one stays up.
 */
export async function submitSponsorCard(
  db: Db,
  input: {
    townId: string;
    email: string;
    slug: string;
    headline: string;
    body: string;
    placementId?: string | null;
  },
  now = new Date(),
): Promise<SubmitResult> {
  const listing = (await ownerListings(db, input.townId, input.email)).find(
    (l) => l.slug === input.slug,
  );
  if (!listing) return { ok: false, error: 'not_owner' };
  const headline = input.headline.trim().replace(/\s+/g, ' ');
  const body = input.body.trim().replace(/\s+/g, ' ');
  if (!headline || headline.length > CARD_LIMITS.headline) return { ok: false, error: 'headline' };
  if (body.length > CARD_LIMITS.body) return { ok: false, error: 'body' };
  const [placement] = await db
    .select()
    .from(placements)
    .where(
      and(
        eq(placements.businessId, listing.id),
        input.placementId
          ? eq(placements.id, input.placementId)
          : eq(placements.product, 'sponsored_slot'),
        eq(placements.status, 'active'),
      ),
    );
  if (!placement) return { ok: false, error: 'no_placement' };
  const newsletter = placement.product === 'newsletter';
  if (!newsletter && !placement.category) return { ok: false, error: 'no_placement' };
  const [town] = await db
    .select({ domain: towns.domain })
    .from(towns)
    .where(eq(towns.id, input.townId));
  const href = `/directory/${listing.category}/${listing.slug}`;
  // One waiting version at a time: a new submission replaces the previous draft.
  await db
    .update(campaigns)
    .set({ status: 'ended', updatedAt: now })
    .where(and(eq(campaigns.placementId, placement.id), eq(campaigns.status, 'draft')));
  await db.insert(campaigns).values({
    townId: input.townId,
    slot: slotForPlacement(placement),
    category: newsletter ? null : placement.category,
    placementId: placement.id,
    status: 'draft',
    startsAt: placement.period && placement.startsAt ? placement.startsAt : now,
    endsAt: placement.endsAt,
    creative: creativeSchema.parse({
      advertiser: listing.name,
      headline,
      ...(body ? { body } : {}),
      // The newsletter is an email: its link must be absolute.
      href: newsletter ? `https://${town?.domain}${href}` : href,
      cta: 'See the listing',
    }),
    createdAt: now,
  });
  return { ok: true };
}

export type PendingCard = {
  campaignId: string;
  headline: string;
  body: string | null;
  business: { name: string; slug: string; category: string | null; claimedByEmail: string | null };
  town: { name: string; domain: string };
  submittedAt: Date;
};

/** Cards waiting for staff, oldest first. */
export async function pendingSponsorCards(db: Db): Promise<PendingCard[]> {
  const rows = await db
    .select({ campaign: campaigns, business: businesses, town: towns })
    .from(campaigns)
    .innerJoin(placements, eq(placements.id, campaigns.placementId))
    .innerJoin(businesses, eq(businesses.id, placements.businessId))
    .innerJoin(towns, eq(towns.id, campaigns.townId))
    .where(and(eq(campaigns.status, 'draft'), isNotNull(campaigns.placementId)))
    .orderBy(campaigns.createdAt);
  return rows.map(({ campaign, business, town }) => {
    const c = card(campaign, null);
    return {
      campaignId: campaign.id,
      headline: c.headline,
      body: c.body,
      business: {
        name: business.name,
        slug: business.slug,
        category: business.category,
        claimedByEmail: business.claimedByEmail,
      },
      town: { name: town.name, domain: town.domain },
      submittedAt: campaign.createdAt,
    };
  });
}

export class CardNotWaiting extends Error {}

/**
 * Staff approve or reject a card (D-M6-7, audited). Approval puts it live until the placement
 * ends and retires the placement's previous card. A card only goes live while its placement is
 * active, and never beyond the category's cap.
 */
export async function decideSponsorCard(
  db: Db,
  input: { campaignId: string; staffId: string; decision: 'approve' | 'reject'; note?: string },
  now = new Date(),
): Promise<void> {
  const note = input.note?.trim().slice(0, 300) || null;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ campaign: campaigns, placement: placements })
      .from(campaigns)
      .innerJoin(placements, eq(placements.id, campaigns.placementId))
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'draft')));
    if (!row) throw new CardNotWaiting('This card is not waiting for a decision.');
    // A booked week or month starts on its own date, and holds the slot only for that period.
    const dated = Boolean(row.placement.period);
    const startsAt =
      dated && row.placement.startsAt && row.placement.startsAt > now
        ? row.placement.startsAt
        : now;
    if (input.decision === 'approve') {
      if (row.placement.status !== 'active')
        throw new CardNotWaiting('Its placement is not active, so the card can’t go live.');
      if (dated) {
        const clash = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.townId, row.campaign.townId),
              eq(campaigns.slot, row.campaign.slot),
              row.campaign.category
                ? eq(campaigns.category, row.campaign.category)
                : isNull(campaigns.category),
              eq(campaigns.status, 'active'),
              or(isNull(campaigns.placementId), ne(campaigns.placementId, row.placement.id)),
              // Overlapping periods (an open-ended campaign overlaps everything after it starts).
              lt(campaigns.startsAt, row.placement.endsAt!),
              or(isNull(campaigns.endsAt), gt(campaigns.endsAt, startsAt)),
            ),
          );
        if (clash.length)
          throw new CardNotWaiting('Another sponsor already holds that slot for this period.');
      }
      const live = dated
        ? []
        : await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(
              and(
                eq(campaigns.townId, row.campaign.townId),
                eq(campaigns.slot, row.campaign.slot),
                eq(campaigns.category, row.campaign.category ?? ''),
                eq(campaigns.status, 'active'),
                or(isNull(campaigns.placementId), ne(campaigns.placementId, row.placement.id)),
              ),
            );
      // A card from before ranks (no rank) may use all three sponsored places.
      const cap = row.placement.rank ? slotCap(row.campaign.slot) : maxSponsoredPerCategory;
      if (!dated && live.length >= cap)
        throw new CardNotWaiting(
          row.campaign.slot === TOP_SPOT_SLOT
            ? 'The category’s Top spot already shows a card.'
            : 'The category already shows its sponsored cards.',
        );
      await tx
        .update(campaigns)
        .set({ status: 'ended', updatedAt: now })
        .where(and(eq(campaigns.placementId, row.placement.id), eq(campaigns.status, 'active')));
    }
    await tx
      .update(campaigns)
      .set(
        input.decision === 'approve'
          ? { status: 'active', startsAt, endsAt: row.placement.endsAt, updatedAt: now }
          : { status: 'ended', updatedAt: now },
      )
      .where(eq(campaigns.id, row.campaign.id));
  });
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'approve' ? 'directory.card.approve' : 'directory.card.reject',
    target: { type: 'campaign', id: input.campaignId },
    detail: { note },
  });
}

/** When a placement stops (canceled, expired, refunded), its cards come down with it. */
export async function endPlacementCampaigns(db: Db, placementId: string, now = new Date()) {
  await db
    .update(campaigns)
    .set({ status: 'ended', updatedAt: now })
    .where(
      and(eq(campaigns.placementId, placementId), inArray(campaigns.status, ['draft', 'active'])),
    );
}

/** When a placement's period changes, its live card follows. */
export async function syncPlacementCampaigns(
  db: Db,
  placementId: string,
  endsAt: Date | null,
  now = new Date(),
) {
  await db
    .update(campaigns)
    .set({ endsAt, updatedAt: now })
    .where(
      and(eq(campaigns.placementId, placementId), inArray(campaigns.status, ['draft', 'active'])),
    );
}
