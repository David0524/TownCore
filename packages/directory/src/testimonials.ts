import {
  and,
  asc,
  businessTestimonials,
  businesses,
  desc,
  eq,
  isNotNull,
  logAdminAction,
  placements,
  towns,
  type Db,
} from '@towncore/db';
import { ownerListings } from './owners';

// Owner testimonials (owner, 2026-10-17): an owner who has advertised may write a sentence or two
// about it in the owner portal, ticking a box that lets us show it. Nothing shows until staff
// approve it in Admin → Directory (audited); approved ones appear on /advertise, credited to the
// business by name. No invented or edited quotes: staff approve or reject, never rewrite.

export const TESTIMONIAL_LIMITS = { min: 20, max: 300 } as const;

export type TestimonialOutcome = 'sent' | 'invalid' | 'not_eligible' | 'waiting';

export class TestimonialNotPending extends Error {}

/** Whether a listing has run a paid placement (only advertisers write testimonials). */
async function advertised(db: Db, businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: placements.id })
    .from(placements)
    .where(and(eq(placements.businessId, businessId), isNotNull(placements.startsAt)))
    .limit(1);
  return Boolean(row);
}

/** Whether the owner portal offers the testimonial form for this listing. */
export async function canWriteTestimonial(db: Db, businessId: string): Promise<boolean> {
  return advertised(db, businessId);
}

export async function submitTestimonial(
  db: Db,
  input: { townId: string; email: string; slug: string; quote: string; permission: boolean },
  now = new Date(),
): Promise<TestimonialOutcome> {
  const quote = input.quote.replace(/\s+/g, ' ').trim();
  if (
    !input.permission ||
    quote.length < TESTIMONIAL_LIMITS.min ||
    quote.length > TESTIMONIAL_LIMITS.max
  )
    return 'invalid';
  const listing = (await ownerListings(db, input.townId, input.email)).find(
    (l) => l.slug === input.slug,
  );
  if (!listing || !(await advertised(db, listing.id))) return 'not_eligible';
  const [pending] = await db
    .select({ id: businessTestimonials.id })
    .from(businessTestimonials)
    .where(
      and(
        eq(businessTestimonials.businessId, listing.id),
        eq(businessTestimonials.status, 'pending'),
      ),
    );
  if (pending) return 'waiting';
  await db.insert(businessTestimonials).values({
    townId: input.townId,
    businessId: listing.id,
    email: input.email,
    quote,
    attribution: listing.name,
    permissionAt: now,
    createdAt: now,
  });
  return 'sent';
}

/** The listing's latest testimonial, for the owner page. */
export async function ownerTestimonial(db: Db, businessId: string) {
  const [row] = await db
    .select()
    .from(businessTestimonials)
    .where(eq(businessTestimonials.businessId, businessId))
    .orderBy(desc(businessTestimonials.createdAt))
    .limit(1);
  return row ?? null;
}

/** Staff approve or reject one (audited). */
export async function decideTestimonial(
  db: Db,
  input: { testimonialId: string; staffId: string; decision: 'approve' | 'reject' },
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .update(businessTestimonials)
    .set({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: input.staffId,
      decidedAt: now,
    })
    .where(
      and(
        eq(businessTestimonials.id, input.testimonialId),
        eq(businessTestimonials.status, 'pending'),
      ),
    )
    .returning();
  if (!row) throw new TestimonialNotPending('This testimonial was already decided.');
  await logAdminAction(db, {
    staffId: input.staffId,
    action:
      input.decision === 'approve'
        ? 'directory.testimonial.approve'
        : 'directory.testimonial.reject',
    target: { type: 'business_testimonial', id: row.id },
    detail: { businessId: row.businessId, quote: row.quote },
  });
}

/** Testimonials waiting for staff, oldest first. */
export async function pendingTestimonials(db: Db) {
  return db
    .select({
      id: businessTestimonials.id,
      quote: businessTestimonials.quote,
      attribution: businessTestimonials.attribution,
      email: businessTestimonials.email,
      createdAt: businessTestimonials.createdAt,
      townName: towns.name,
    })
    .from(businessTestimonials)
    .innerJoin(towns, eq(towns.id, businessTestimonials.townId))
    .where(eq(businessTestimonials.status, 'pending'))
    .orderBy(asc(businessTestimonials.createdAt));
}

/** Approved testimonials for a town's /advertise page, newest first, from active listings. */
export async function approvedTestimonials(db: Db, townId: string, limit = 3) {
  return db
    .select({
      id: businessTestimonials.id,
      quote: businessTestimonials.quote,
      attribution: businessTestimonials.attribution,
    })
    .from(businessTestimonials)
    .innerJoin(businesses, eq(businesses.id, businessTestimonials.businessId))
    .where(
      and(
        eq(businessTestimonials.townId, townId),
        eq(businessTestimonials.status, 'approved'),
        eq(businesses.active, true),
      ),
    )
    .orderBy(desc(businessTestimonials.decidedAt))
    .limit(limit);
}
