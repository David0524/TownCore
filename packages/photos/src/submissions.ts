import { randomUUID } from 'node:crypto';
import { AI_ILLUSTRATION_LABEL } from '@towncore/config';
import {
  and,
  eq,
  gte,
  images,
  logAdminAction,
  or,
  photoSubmissions,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { businessLicense, readerLicense } from './license';
import { PhotoRejected, processPhoto } from './process';
import { photoSpec, type PhotoSubmission } from './queries';
import type { PhotoStorage } from './storage';

// Photo submissions (M9, CLAUDE.md §11c): readers and contributors through a town site's form,
// owners through the owner portal. Nothing shows until staff approve it with alt text they wrote
// from what the photo shows (D-M9-3). Every decision is audited.

/** Most reader submissions from one address or email an hour (the form's rate limit). */
export const SUBMISSIONS_PER_HOUR = 5;
/** Most photos a listing keeps (pending or approved). */
export const PHOTOS_PER_LISTING = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: string | undefined | null, max: number) =>
  (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function submitPhoto(
  db: Db,
  storage: PhotoStorage,
  input: {
    townId: string;
    kind: 'reader' | 'business';
    businessId?: string;
    bytes: Uint8Array;
    caption: string;
    takenWhere?: string;
    takenWhen?: string;
    credit: string;
    name: string;
    email: string;
    /** The sender ticked the license grant. */
    agreed: boolean;
    ip?: string | null;
    now?: Date;
  },
): Promise<PhotoSubmission> {
  const now = input.now ?? new Date();
  const [town] = await db.select().from(towns).where(eq(towns.id, input.townId));
  if (!town) throw new PhotoRejected('site');
  if (!input.agreed) throw new PhotoRejected('license');
  const caption = clean(input.caption, 300);
  const credit = clean(input.credit, 80);
  const name = clean(input.name, 120);
  const email = clean(input.email, 254).toLowerCase();
  if (!caption) throw new PhotoRejected('caption');
  if (!credit) throw new PhotoRejected('credit');
  if (!name || !EMAIL.test(email)) throw new PhotoRejected('contact');
  if (input.kind === 'business' && !input.businessId) throw new PhotoRejected('listing');

  if (input.kind === 'reader') {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(photoSubmissions)
      .where(
        and(
          gte(photoSubmissions.createdAt, new Date(now.getTime() - 3_600_000)),
          or(
            eq(photoSubmissions.submitterEmail, email),
            input.ip ? eq(photoSubmissions.consentIp, input.ip) : sql`false`,
          ),
        ),
      );
    if ((recent?.n ?? 0) >= SUBMISSIONS_PER_HOUR) throw new PhotoRejected('rate');
  } else {
    const [kept] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(photoSubmissions)
      .where(
        and(
          eq(photoSubmissions.businessId, input.businessId!),
          sql`${photoSubmissions.status} <> 'rejected'`,
        ),
      );
    if ((kept?.n ?? 0) >= PHOTOS_PER_LISTING) throw new PhotoRejected('limit');
  }

  const { jpeg, width, height } = await processPhoto(input.bytes);
  const key = `photos/${town.id}/${randomUUID()}.jpg`;
  await storage.put(key, jpeg);
  const license =
    input.kind === 'reader' ? readerLicense(town.siteName) : businessLicense(town.siteName);
  const [row] = await db
    .insert(photoSubmissions)
    .values({
      townId: town.id,
      businessId: input.kind === 'business' ? input.businessId! : null,
      kind: input.kind,
      storageKey: key,
      width,
      height,
      bytes: jpeg.byteLength,
      caption,
      takenWhere: clean(input.takenWhere, 120) || null,
      takenWhen: clean(input.takenWhen, 60) || null,
      credit,
      submitterName: name,
      submitterEmail: email,
      licenseVersion: license.version,
      licenseText: license.text,
      consentIp: input.ip ?? null,
      consentAt: now,
      createdAt: now,
    })
    .returning();
  return row!;
}

export class PhotoDecisionError extends Error {}

export async function decidePhoto(
  db: Db,
  input: {
    id: string;
    staff: { id: string };
    decision: 'approve' | 'reject';
    alt?: string;
    reason?: string;
  },
  now = new Date(),
): Promise<PhotoSubmission> {
  const alt = clean(input.alt, 300);
  if (input.decision === 'approve' && alt.length < 10)
    throw new PhotoDecisionError(
      'Write alt text from what the photo shows (at least a short sentence).',
    );
  const [row] = await db
    .update(photoSubmissions)
    .set(
      input.decision === 'approve'
        ? {
            status: 'approved',
            alt,
            reviewedBy: input.staff.id,
            reviewedAt: now,
            rejectReason: null,
          }
        : {
            status: 'rejected',
            reviewedBy: input.staff.id,
            reviewedAt: now,
            rejectReason: clean(input.reason, 300) || null,
          },
    )
    .where(and(eq(photoSubmissions.id, input.id), eq(photoSubmissions.status, 'pending')))
    .returning();
  if (!row) throw new PhotoDecisionError('That photo is unknown or already decided.');
  // An approved AI illustration becomes its guide's visual right away: labeled, recorded as
  // AI-generated, with the approver (the images table refuses an AI image without one).
  if (row.kind === 'illustration' && row.status === 'approved' && row.articleId) {
    const values = {
      articleId: row.articleId,
      kind: 'ai-illustration' as const,
      spec: photoSpec(row),
      alt,
      license: row.licenseVersion,
      attribution: AI_ILLUSTRATION_LABEL,
      sourceUrl: null,
      aiGenerated: true,
      approvedBy: input.staff.id,
      updatedAt: now,
    };
    await db
      .insert(images)
      .values(values)
      .onConflictDoUpdate({ target: images.articleId, set: values });
  }
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: `photo.${input.decision}`,
    target: { type: 'photo_submission', id: row.id },
    detail: {
      kind: row.kind,
      townId: row.townId,
      ...(input.decision === 'reject' ? { reason: row.rejectReason } : { alt }),
    },
  });
  return row;
}
