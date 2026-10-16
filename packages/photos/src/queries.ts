import type { PhotoSpec } from '@towncore/config';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lt,
  or,
  photoSubmissions,
  towns,
  type Db,
} from '@towncore/db';

// Reading approved photos (M9). Kept apart from the upload code, so the image router and the
// pages can use it without loading the image library.

export type PhotoSubmission = typeof photoSubmissions.$inferSelect;

/** A reader photo isn't used again in a story within this many days. */
export const REUSE_DAYS = 7;

export async function pendingPhotos(db: Db, limit = 50) {
  return db
    .select({ photo: photoSubmissions, siteName: towns.siteName })
    .from(photoSubmissions)
    .innerJoin(towns, eq(photoSubmissions.townId, towns.id))
    .where(eq(photoSubmissions.status, 'pending'))
    .orderBy(asc(photoSubmissions.createdAt))
    .limit(limit);
}

/** An approved photo of this town, for serving; null for anything not approved. */
export async function approvedPhoto(db: Db, townId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(photoSubmissions)
    .where(
      and(
        eq(photoSubmissions.id, id),
        eq(photoSubmissions.townId, townId),
        eq(photoSubmissions.status, 'approved'),
      ),
    );
  return row ?? null;
}

/** Approved photos of a listing, newest first (its business page). */
export async function listingPhotos(db: Db, businessId: string) {
  return db
    .select()
    .from(photoSubmissions)
    .where(
      and(eq(photoSubmissions.businessId, businessId), eq(photoSubmissions.status, 'approved')),
    )
    .orderBy(desc(photoSubmissions.reviewedAt));
}

/**
 * The image router's reader photo for a town story (§11c "reader-photo"): the newest approved one
 * not used in the last week, marked as used. Null when there's none.
 */
export async function takeReaderPhoto(db: Db, townId: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(photoSubmissions)
    .where(
      and(
        eq(photoSubmissions.townId, townId),
        eq(photoSubmissions.kind, 'reader'),
        eq(photoSubmissions.status, 'approved'),
        or(
          isNull(photoSubmissions.lastUsedAt),
          lt(photoSubmissions.lastUsedAt, new Date(now.getTime() - REUSE_DAYS * 86_400_000)),
        ),
      ),
    )
    .orderBy(desc(photoSubmissions.reviewedAt))
    .limit(1);
  if (!row) return null;
  await db.update(photoSubmissions).set({ lastUsedAt: now }).where(eq(photoSubmissions.id, row.id));
  return row;
}

/** The newest approved photo of a listing, for a story about that business. */
export async function businessPhotoFor(db: Db, businessId: string) {
  const [row] = await listingPhotos(db, businessId);
  return row ?? null;
}

/** Where a town site serves an approved photo. */
export const photoPath = (id: string) => `/photos/${id}.jpg`;

/** The approved AI illustration made for this article, if a person approved one. */
export async function approvedIllustration(db: Db, articleId: string) {
  const [row] = await db
    .select()
    .from(photoSubmissions)
    .where(
      and(
        eq(photoSubmissions.articleId, articleId),
        eq(photoSubmissions.kind, 'illustration'),
        eq(photoSubmissions.status, 'approved'),
      ),
    )
    .orderBy(desc(photoSubmissions.reviewedAt))
    .limit(1);
  return row ?? null;
}

/** Whether a photo is (still) approved: a story keeps its reader photo only while it is. */
export async function isApproved(db: Db, id: string) {
  const [row] = await db
    .select({ id: photoSubmissions.id })
    .from(photoSubmissions)
    .where(and(eq(photoSubmissions.id, id), eq(photoSubmissions.status, 'approved')));
  return Boolean(row);
}

/** What an article's `images` row stores for an approved photo. */
export function photoSpec(row: PhotoSubmission): PhotoSpec {
  return {
    type: 'photo',
    photoId: row.id,
    width: row.width,
    height: row.height,
    caption: row.caption,
    credit: row.credit,
    takenWhere: row.takenWhere,
    takenWhen: row.takenWhen,
  };
}

/** A listing's photos for its owner: waiting, approved and turned down, newest first. */
export async function ownerPhotos(db: Db, businessId: string) {
  return db
    .select()
    .from(photoSubmissions)
    .where(eq(photoSubmissions.businessId, businessId))
    .orderBy(desc(photoSubmissions.createdAt))
    .limit(20);
}

/**
 * The homepage's photo of the week: the newest reader photo approved in the last `days` days,
 * or null. Reading it doesn't count as a story using it.
 */
export async function photoOfTheWeek(db: Db, townId: string, now = new Date(), days = 14) {
  const [row] = await db
    .select()
    .from(photoSubmissions)
    .where(
      and(
        eq(photoSubmissions.townId, townId),
        eq(photoSubmissions.kind, 'reader'),
        eq(photoSubmissions.status, 'approved'),
        gte(photoSubmissions.reviewedAt, new Date(now.getTime() - days * 86_400_000)),
      ),
    )
    .orderBy(desc(photoSubmissions.reviewedAt))
    .limit(1);
  return row ?? null;
}
