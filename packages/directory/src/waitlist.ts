import { directoryCategory } from '@towncore/config';
import { and, businesses, directoryWaitlist, eq, gte, isNotNull, sql, type Db } from '@towncore/db';
import { openFeaturedRanks } from './stripe/checkout';

// The featured-spot waitlist (owner, 2026-10-17). Real scarcity only: a business can join when
// every featured spot in its category is sold, never before, and nothing on the site says
// anyone else is looking. Joining is consent to one email when a spot opens. That email is a
// `waitlist_open` follow-up (./followups.ts): a draft first, sent by itself only under the town's
// standing approval (Rule 10), and only to an entry tied to a claimed listing, never to an
// unclaimed one. The waiting count is one of the monthly pricing signals.

/** Joins per address (by IP) an hour. */
export const WAITLIST_PER_HOUR = 5;

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;

export type WaitlistOutcome = 'joined' | 'already' | 'open' | 'invalid' | 'rate_limited';

export async function joinWaitlist(
  db: Db,
  input: {
    townId: string;
    category: string;
    email: string;
    /** The form's consent box, or the owner pressing the button on their own page. */
    consent: boolean;
    source: 'category' | 'advertise' | 'owner';
    businessId?: string | null;
    ip?: string | null;
  },
  now = new Date(),
): Promise<WaitlistOutcome> {
  const email = input.email.trim().toLowerCase();
  const category = directoryCategory(input.category);
  if (!category || !input.consent || email.length > 200 || !EMAIL.test(email)) return 'invalid';
  if ((await openFeaturedRanks(db, input.townId, category.slug, now)).length > 0) return 'open';
  if (input.ip) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(directoryWaitlist)
      .where(
        and(
          eq(directoryWaitlist.ip, input.ip),
          gte(directoryWaitlist.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= WAITLIST_PER_HOUR) return 'rate_limited';
  }
  // Tie it to the owner's claimed listing in this category, when the email is its claim email.
  let businessId = input.businessId ?? null;
  if (!businessId) {
    const [owned] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        and(
          eq(businesses.townId, input.townId),
          eq(businesses.category, category.slug),
          isNotNull(businesses.claimedAt),
          sql`lower(${businesses.claimedByEmail}) = ${email}`,
        ),
      )
      .limit(1);
    businessId = owned?.id ?? null;
  }
  const [row] = await db
    .insert(directoryWaitlist)
    .values({
      townId: input.townId,
      category: category.slug,
      businessId,
      email,
      consentAt: now,
      source: input.source,
      ip: input.ip ?? null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: directoryWaitlist.id });
  return row ? 'joined' : 'already';
}

/** Businesses waiting for a featured spot in a category. */
export async function waitlistCount(db: Db, townId: string, category: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(directoryWaitlist)
    .where(
      and(
        eq(directoryWaitlist.townId, townId),
        eq(directoryWaitlist.category, category),
        eq(directoryWaitlist.status, 'waiting'),
      ),
    );
  return row?.n ?? 0;
}

/** Whether this address is waiting in the category (the owner page shows it). */
export async function onWaitlist(
  db: Db,
  input: { townId: string; category: string; email: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: directoryWaitlist.id })
    .from(directoryWaitlist)
    .where(
      and(
        eq(directoryWaitlist.townId, input.townId),
        eq(directoryWaitlist.category, input.category),
        eq(directoryWaitlist.status, 'waiting'),
        sql`lower(${directoryWaitlist.email}) = ${input.email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Waiting entries per town and category, for Admin → Directory → Pricing. */
export async function waitlistSummary(db: Db) {
  return db
    .select({
      townId: directoryWaitlist.townId,
      category: directoryWaitlist.category,
      waiting: sql<number>`count(*)::int`,
      claimed: sql<number>`count(${directoryWaitlist.businessId})::int`,
    })
    .from(directoryWaitlist)
    .where(eq(directoryWaitlist.status, 'waiting'))
    .groupBy(directoryWaitlist.townId, directoryWaitlist.category);
}
