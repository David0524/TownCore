import { createHash, randomBytes } from 'node:crypto';
import { placeholderReviewerName } from '@towncore/config';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { adminActions, staff, staffLoginTokens, staffSessions } from './schema';

// Staff sign-in by email link (CLAUDE.md §3; docs/plans/M3.md §8). Tokens are random, single
// use and short-lived; only their SHA-256 hashes are stored.

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;
export const LOGIN_LINKS_PER_HOUR = 5;

export type StaffMember = typeof staff.$inferSelect;

export class TooManyLoginLinks extends Error {}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const newToken = () => randomBytes(32).toString('base64url');

/**
 * The staff member for an email, creating one for addresses in ADMIN_EMAILS. New staff start
 * as the placeholder reviewer until they set their real name. Anyone else gets null.
 */
export async function findOrCreateStaff(
  db: Db,
  email: string,
  adminEmails: readonly string[],
): Promise<StaffMember | null> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(staff).where(eq(staff.email, normalized));
  if (existing) return existing.active ? existing : null;
  if (!adminEmails.map((e) => e.toLowerCase()).includes(normalized)) return null;
  const [created] = await db
    .insert(staff)
    .values({ email: normalized, name: placeholderReviewerName, role: 'admin', placeholder: true })
    .onConflictDoNothing({ target: staff.email })
    .returning();
  return created ?? (await db.select().from(staff).where(eq(staff.email, normalized)))[0] ?? null;
}

export async function createLoginToken(db: Db, staffId: string, now = new Date()): Promise<string> {
  const [{ recent }] = (await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(staffLoginTokens)
    .where(
      and(
        eq(staffLoginTokens.staffId, staffId),
        gte(staffLoginTokens.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    )) as [{ recent: number }];
  if (recent >= LOGIN_LINKS_PER_HOUR)
    throw new TooManyLoginLinks('Too many sign-in links; try later.');
  const token = newToken();
  await db.insert(staffLoginTokens).values({
    staffId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
    createdAt: now,
  });
  return token;
}

/** Uses a sign-in token once; returns a new session token, or null if invalid. */
export async function redeemLoginToken(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ sessionToken: string; staff: StaffMember } | null> {
  const [row] = await db
    .update(staffLoginTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(staffLoginTokens.tokenHash, hashToken(token)),
        isNull(staffLoginTokens.usedAt),
        gte(staffLoginTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row) return null;
  const [member] = await db.select().from(staff).where(eq(staff.id, row.staffId));
  if (!member?.active) return null;
  const sessionToken = newToken();
  await db.insert(staffSessions).values({
    staffId: member.id,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
  });
  return { sessionToken, staff: member };
}

export async function getSessionStaff(
  db: Db,
  sessionToken: string,
  now = new Date(),
): Promise<StaffMember | null> {
  const [row] = await db
    .select({ member: staff })
    .from(staffSessions)
    .innerJoin(staff, eq(staffSessions.staffId, staff.id))
    .where(
      and(
        eq(staffSessions.tokenHash, hashToken(sessionToken)),
        gte(staffSessions.expiresAt, now),
        eq(staff.active, true),
      ),
    );
  return row?.member ?? null;
}

export async function endSession(db: Db, sessionToken: string): Promise<void> {
  await db.delete(staffSessions).where(eq(staffSessions.tokenHash, hashToken(sessionToken)));
}

export async function logAdminAction(
  db: Db,
  entry: {
    staffId: string;
    action: string;
    articleId?: string | null;
    candidateId?: string | null;
    /** For non-editorial actions: what was acted on, e.g. { type: 'mail_domain', id }. */
    target?: { type: string; id: string } | null;
    detail?: unknown;
  },
): Promise<void> {
  await db.insert(adminActions).values({
    staffId: entry.staffId,
    action: entry.action,
    articleId: entry.articleId ?? null,
    candidateId: entry.candidateId ?? null,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    detail: entry.detail ?? null,
  });
}
