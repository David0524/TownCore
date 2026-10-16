import { randomBytes } from 'node:crypto';
import {
  and,
  asc,
  businesses,
  eq,
  gte,
  isNotNull,
  isNull,
  logAdminAction,
  ownerLoginTokens,
  ownerSessions,
  sql,
  type Db,
} from '@towncore/db';
import { parseAddress } from '@towncore/mail';
import { hashToken } from './claims';
import { sendDirectoryMail, siteOrigin, townMailDomain, type DirectoryMailDeps } from './mail';
import type { Listing } from './queries';

// The owner portal (M6 PR C, D-M6-11): owners of approved claims sign in on the town's site with
// a single-use email link (no passwords) and edit their listing. A new business name waits for
// staff, like the claim itself; everything else shows at once.

export const OWNER_LINK_TTL_MS = 30 * 60_000;
export const OWNER_SESSION_TTL_MS = 30 * 86_400_000;
export const OWNER_LINKS_PER_HOUR = 5;

const newToken = () => randomBytes(32).toString('base64url');

/** Listings this email owns in the town (active ones; one owner email per listing). */
export async function ownerListings(db: Db, townId: string, email: string): Promise<Listing[]> {
  return db
    .select()
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.active, true),
        isNotNull(businesses.claimedAt),
        sql`lower(${businesses.claimedByEmail}) = ${email.toLowerCase()}`,
      ),
    )
    .orderBy(asc(businesses.name));
}

export type OwnerLinkOutcome = 'ok' | 'invalid' | 'unavailable';

/**
 * Emails a sign-in link if the address owns a listing here. The answer is 'ok' either way, so
 * the form can't be used to find out who owns what.
 */
export async function requestOwnerLink(
  deps: DirectoryMailDeps,
  input: { townId: string; email: string },
): Promise<OwnerLinkOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const email = input.email.length <= 254 ? parseAddress(input.email.trim())?.address : undefined;
  if (!email) return 'invalid';
  const mail = await townMailDomain(db, input.townId);
  if (!mail) return 'unavailable';
  if ((await ownerListings(db, input.townId, email)).length === 0) return 'ok';
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ownerLoginTokens)
    .where(
      and(
        eq(ownerLoginTokens.townId, input.townId),
        eq(ownerLoginTokens.email, email),
        gte(ownerLoginTokens.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if ((recent?.n ?? 0) >= OWNER_LINKS_PER_HOUR) return 'ok';
  const token = newToken();
  await db.insert(ownerLoginTokens).values({
    townId: input.townId,
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + OWNER_LINK_TTL_MS),
    createdAt: now,
  });
  await sendDirectoryMail(deps, mail, {
    to: email,
    kind: 'owner_signin',
    subject: `Sign in to manage your listing on ${mail.siteName}`,
    lines: [
      'Open the link and press the button to sign in. It works once and expires in 30 minutes.',
      "If you didn't ask for it, ignore this email.",
    ],
    link: {
      href: `${siteOrigin(deps, mail.domain)}/owner/signin?t=${encodeURIComponent(token)}`,
      label: 'Sign in',
    },
  });
  return 'ok';
}

/** Uses a sign-in link once; returns a session token, or null if invalid or expired. */
export async function redeemOwnerLink(
  db: Db,
  townId: string,
  token: string,
  now = new Date(),
): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .update(ownerLoginTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(ownerLoginTokens.townId, townId),
        eq(ownerLoginTokens.tokenHash, hashToken(token)),
        isNull(ownerLoginTokens.usedAt),
        gte(ownerLoginTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row) return null;
  const session = newToken();
  await db.insert(ownerSessions).values({
    townId,
    email: row.email,
    tokenHash: hashToken(session),
    expiresAt: new Date(now.getTime() + OWNER_SESSION_TTL_MS),
    createdAt: now,
  });
  return session;
}

/** The signed-in owner's email for this town, or null. */
export async function ownerForSession(
  db: Db,
  townId: string,
  session: string | undefined,
  now = new Date(),
): Promise<string | null> {
  if (!session || session.length > 100) return null;
  const [row] = await db
    .select({ email: ownerSessions.email })
    .from(ownerSessions)
    .where(
      and(
        eq(ownerSessions.townId, townId),
        eq(ownerSessions.tokenHash, hashToken(session)),
        gte(ownerSessions.expiresAt, now),
      ),
    );
  return row?.email ?? null;
}

export async function endOwnerSession(db: Db, session: string): Promise<void> {
  await db.delete(ownerSessions).where(eq(ownerSessions.tokenHash, hashToken(session)));
}

export type ListingEdit = {
  name?: string;
  phone?: string;
  website?: string;
  hours?: string;
  description?: string;
  serviceArea?: string;
};

export type EditResult = { ok: true; nameReview: boolean } | { ok: false; errors: string[] };

/** Normalizes a US phone number to "(561) 555-0142", or null if it isn't one. */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** An http(s) URL with a real host, normalized; null otherwise. */
export function normalizeWebsite(value: string): string | null {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    if (url.username || url.password) return null;
    return url.toString().slice(0, 300);
  } catch {
    return null;
  }
}

/** An owner's edit to their own listing. Blank fields clear; a new name goes to staff review. */
export async function updateOwnedListing(
  db: Db,
  input: { townId: string; email: string; slug: string; edit: ListingEdit },
  now = new Date(),
): Promise<EditResult> {
  const listing = (await ownerListings(db, input.townId, input.email)).find(
    (l) => l.slug === input.slug,
  );
  if (!listing) return { ok: false, errors: ['You can only edit listings you manage.'] };
  const { edit } = input;
  const errors: string[] = [];
  const clean = (v: string | undefined, max: number) => {
    const t = v?.trim() ?? '';
    if (t.length > max) errors.push(`Keep it under ${max} characters.`);
    return t || null;
  };
  const phoneText = clean(edit.phone, 40);
  const phone = phoneText ? normalizePhone(phoneText) : null;
  if (phoneText && !phone) errors.push('Enter a 10-digit US phone number.');
  const siteText = clean(edit.website, 300);
  const website = siteText ? normalizeWebsite(siteText) : null;
  if (siteText && !website) errors.push('Enter a website address, like example.com.');
  const hours = clean(edit.hours, 500);
  const description = clean(edit.description, 1000);
  const serviceArea = clean(edit.serviceArea, 200);
  const name = clean(edit.name, 120);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const nameReview = Boolean(name && name !== listing.name && name !== listing.pendingName);
  await db
    .update(businesses)
    .set({
      phone,
      website,
      hours,
      description,
      serviceArea,
      ...(nameReview ? { pendingName: name } : {}),
      ownerUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(businesses.id, listing.id));
  return { ok: true, nameReview };
}

/** Listings with a name change waiting for staff. */
export async function pendingNameChanges(db: Db): Promise<Listing[]> {
  return db
    .select()
    .from(businesses)
    .where(isNotNull(businesses.pendingName))
    .orderBy(asc(businesses.ownerUpdatedAt));
}

export async function decideNameChange(
  db: Db,
  input: { businessId: string; staffId: string; decision: 'approve' | 'reject' },
  now = new Date(),
): Promise<void> {
  const [listing] = await db.select().from(businesses).where(eq(businesses.id, input.businessId));
  if (!listing?.pendingName) return;
  await db
    .update(businesses)
    .set({
      ...(input.decision === 'approve' ? { name: listing.pendingName } : {}),
      pendingName: null,
      updatedAt: now,
    })
    .where(eq(businesses.id, listing.id));
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'approve' ? 'directory.name.approve' : 'directory.name.reject',
    target: { type: 'business', id: listing.id },
    detail: { from: listing.name, to: listing.pendingName },
  });
}
