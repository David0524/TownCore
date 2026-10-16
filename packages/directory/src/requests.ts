import { randomBytes } from 'node:crypto';
import { directoryCategory } from '@towncore/config';
import {
  and,
  asc,
  businessRequests,
  businesses,
  desc,
  eq,
  gte,
  inArray,
  logAdminAction,
  or,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { listingSlug } from './names';
import { normalizePhone, normalizeWebsite } from './owners';

// "Add your business" (owner, 2026-10-16): a business that isn't in Places asks to be listed.
// Nothing shows until staff check the request and press Add; nothing is emailed (Rule 10).

/** Data source of listings added from a request. */
export const REQUEST = 'request';
/** Most requests from one address or email an hour. */
export const REQUESTS_PER_HOUR = 3;

export type RequestInput = {
  townId: string;
  name: string;
  category: string;
  address?: string;
  zip?: string;
  phone?: string;
  website?: string;
  contactName: string;
  email: string;
  note?: string;
  ip?: string | null;
};

export type RequestOutcome = 'sent' | 'missing' | 'contact' | 'category' | 'rate';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: string | undefined | null, max: number) =>
  (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function submitBusinessRequest(
  db: Db,
  input: RequestInput,
  now = new Date(),
): Promise<RequestOutcome> {
  const name = clean(input.name, 120);
  const contactName = clean(input.contactName, 120);
  const email = clean(input.email, 254).toLowerCase();
  if (!name) return 'missing';
  if (!contactName || !EMAIL.test(email)) return 'contact';
  if (!directoryCategory(input.category)) return 'category';
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businessRequests)
    .where(
      and(
        gte(businessRequests.createdAt, new Date(now.getTime() - 3_600_000)),
        or(
          eq(businessRequests.email, email),
          input.ip ? eq(businessRequests.ip, input.ip) : sql`false`,
        ),
      ),
    );
  if ((recent?.n ?? 0) >= REQUESTS_PER_HOUR) return 'rate';
  const zip = clean(input.zip, 10).match(/^\d{5}/)?.[0] ?? null;
  await db.insert(businessRequests).values({
    townId: input.townId,
    name,
    category: input.category,
    address: clean(input.address, 160) || null,
    zip,
    phone: input.phone ? normalizePhone(input.phone) : null,
    website: input.website ? normalizeWebsite(clean(input.website, 300)) : null,
    contactName,
    email,
    note: clean(input.note, 500) || null,
    ip: input.ip ?? null,
    createdAt: now,
  });
  return 'sent';
}

export type PendingRequest = typeof businessRequests.$inferSelect & {
  town: { name: string; domain: string };
};

/** Requests waiting for staff, oldest first. */
export async function pendingBusinessRequests(db: Db): Promise<PendingRequest[]> {
  const rows = await db
    .select({ request: businessRequests, town: { name: towns.name, domain: towns.domain } })
    .from(businessRequests)
    .innerJoin(towns, eq(towns.id, businessRequests.townId))
    .where(eq(businessRequests.status, 'pending'))
    .orderBy(asc(businessRequests.createdAt));
  return rows.map((r) => ({ ...r.request, town: r.town }));
}

/** The latest decided requests, newest first. */
export async function decidedBusinessRequests(db: Db, limit = 10) {
  return db
    .select()
    .from(businessRequests)
    .where(inArray(businessRequests.status, ['added', 'rejected']))
    .orderBy(desc(businessRequests.decidedAt))
    .limit(limit);
}

export class RequestNotPending extends Error {}

/**
 * Staff decide a request. Adding lists the business with the details sent, shown publicly, since
 * the sender gave them as the business's own; the sender can then claim it like any listing.
 */
export async function decideBusinessRequest(
  db: Db,
  input: { requestId: string; staffId: string; decision: 'add' | 'reject' },
  now = new Date(),
): Promise<{ businessId: string | null }> {
  const [request] = await db
    .select()
    .from(businessRequests)
    .where(eq(businessRequests.id, input.requestId));
  if (!request || request.status !== 'pending') {
    throw new RequestNotPending('That request was already decided.');
  }
  let businessId: string | null = null;
  if (input.decision === 'add') {
    const [town] = await db.select().from(towns).where(eq(towns.id, request.townId));
    const [created] = await db
      .insert(businesses)
      .values({
        townId: request.townId,
        slug: listingSlug(request.name, `r${randomBytes(3).toString('hex')}`),
        name: request.name,
        category: request.category,
        address: request.address,
        addressPublic: request.address != null,
        city: town?.name ?? null,
        zip: request.zip,
        phone: request.phone,
        website: request.website,
        dataSource: REQUEST,
        licenseVerified: false,
        active: true,
      })
      .returning({ id: businesses.id });
    businessId = created!.id;
  }
  await db
    .update(businessRequests)
    .set({
      status: input.decision === 'add' ? 'added' : 'rejected',
      businessId,
      decidedBy: input.staffId,
      decidedAt: now,
    })
    .where(eq(businessRequests.id, request.id));
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'add' ? 'directory.request.add' : 'directory.request.reject',
    target: { type: 'business_request', id: request.id },
    detail: { name: request.name, category: request.category, businessId },
  });
  return { businessId };
}
