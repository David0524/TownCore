import { directoryProducts, type DirectoryProduct, type FeaturedRank } from '@towncore/config';
import { and, eq, isNull, placements, stripeEvents, type Db } from '@towncore/db';
import type Stripe from 'stripe';
import { bookedPeriods } from '../bookings';
import { endPlacementCampaigns, syncPlacementCampaigns } from '../creatives';
import { placesTaken } from './checkout';

// Stripe webhooks (M6 PR D). Stripe delivers each event at least once and in any order, so:
// the route verifies the signature, every event is stored once by its id, and handling is
// idempotent. Webhooks are the only thing that turns a placement on or off.

type Status = (typeof placements.$inferSelect)['status'];

export type WebhookResult = 'processed' | 'duplicate' | 'ignored';

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

/** Stores a verified event once and handles it. A failure is recorded and rethrown (Stripe retries). */
export async function handleStripeEvent(
  db: Db,
  event: Stripe.Event,
  now = new Date(),
): Promise<WebhookResult> {
  const inserted = await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      payload: event as unknown as Record<string, unknown>,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  if (!inserted.length) {
    const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
    if (seen?.processedAt) return 'duplicate';
  }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    await markProcessed(db, event.id, now);
    return 'ignored';
  }
  try {
    await apply(db, event, now);
  } catch (error) {
    await db
      .update(stripeEvents)
      .set({ error: error instanceof Error ? error.message : String(error) })
      .where(eq(stripeEvents.id, event.id));
    throw error;
  }
  await markProcessed(db, event.id, now);
  return 'processed';
}

async function markProcessed(db: Db, id: string, now: Date) {
  await db
    .update(stripeEvents)
    .set({ processedAt: now, error: null })
    .where(and(eq(stripeEvents.id, id), isNull(stripeEvents.processedAt)));
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

/** Our status for a Stripe subscription status. Past due stays on while Stripe retries. */
export function placementStatusFor(subscription: Stripe.Subscription['status']): Status {
  switch (subscription) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
      return 'pending';
    default:
      // unpaid (retries ended), incomplete_expired, paused: off until it is paid again.
      return 'expired';
  }
}

/** When a placement stops: cancellation, or the end of the period when set to cancel then. */
function endsAt(sub: Stripe.Subscription): Date | null {
  const seconds =
    sub.ended_at ??
    sub.cancel_at ??
    (sub.cancel_at_period_end
      ? Math.max(0, ...sub.items.data.map((item) => item.current_period_end))
      : null);
  return seconds ? new Date(seconds * 1000) : null;
}

async function apply(db: Db, event: Stripe.Event, now: Date) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const placementId = session.metadata?.placement_id ?? session.client_reference_id;
      if (!placementId || (session.mode !== 'subscription' && session.mode !== 'payment')) return;
      const [placement] = await db.select().from(placements).where(eq(placements.id, placementId));
      if (!placement) throw new Error(`No placement ${placementId} for ${session.id}`);
      if (session.mode === 'payment') {
        // A dated booking (newsletter week, category month), paid once. Its period is checked
        // again: one someone else booked first is held, never shown.
        if (
          !placement.period ||
          placement.status !== 'pending' ||
          session.payment_status !== 'paid'
        )
          return;
        const taken = await bookedPeriods(
          db,
          placement.townId,
          placement.product as DirectoryProduct,
          placement.category,
          now,
          placement.id,
        );
        await db
          .update(placements)
          .set({
            status: taken.has(placement.period) ? 'held' : 'active',
            stripeCustomerId: idOf(session.customer),
            updatedAt: now,
          })
          .where(eq(placements.id, placement.id));
        return;
      }
      if (placement.status !== 'pending') {
        // A subscription event got here first; just record the ids.
        await db
          .update(placements)
          .set({
            stripeSubscriptionId: idOf(session.subscription),
            stripeCustomerId: idOf(session.customer),
            updatedAt: now,
          })
          .where(eq(placements.id, placement.id));
        return;
      }
      // Inventory is checked again here: a fourth sponsored slot, or a featured spot someone
      // else took first, is held, never shown.
      const cap = placement.rank
        ? 1
        : directoryProducts[placement.product as DirectoryProduct].perCategory;
      const taken =
        cap === null
          ? 0
          : await placesTaken(
              db,
              placement.townId,
              placement.product,
              placement.category,
              now,
              placement.id,
              placement.rank as FeaturedRank | null,
            );
      const status: Status = cap !== null && taken >= cap ? 'held' : 'active';
      await db
        .update(placements)
        .set({
          status,
          stripeSubscriptionId: idOf(session.subscription),
          stripeCustomerId: idOf(session.customer),
          startsAt: now,
          updatedAt: now,
        })
        .where(eq(placements.id, placement.id));
      return;
    }
    case 'checkout.session.expired': {
      const session = event.data.object;
      await db
        .update(placements)
        .set({ status: 'canceled', endsAt: now, updatedAt: now })
        .where(
          and(eq(placements.stripeCheckoutSessionId, session.id), eq(placements.status, 'pending')),
        );
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const placementId = sub.metadata?.placement_id;
      const [placement] = await db
        .select()
        .from(placements)
        .where(
          placementId
            ? eq(placements.id, placementId)
            : eq(placements.stripeSubscriptionId, sub.id),
        );
      if (!placement) return; // Not one of ours.
      let status = placementStatusFor(
        event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
      );
      // A held placement stays held while it is paid: it never shows until staff resolve it.
      if (placement.status === 'held' && status === 'active') status = 'held';
      // Only a completed Checkout switches a placement on (after the inventory check above), so
      // a subscription event that arrives first leaves it pending.
      if (placement.status === 'pending' && status === 'active') status = 'pending';
      await db
        .update(placements)
        .set({
          status,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: idOf(sub.customer),
          endsAt: endsAt(sub),
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          updatedAt: now,
        })
        .where(eq(placements.id, placement.id));
      // The sponsor card follows its placement: down when it stops, same end date while on.
      if (status === 'active') await syncPlacementCampaigns(db, placement.id, endsAt(sub), now);
      else await endPlacementCampaigns(db, placement.id, now);
      return;
    }
    default:
      return;
  }
}
