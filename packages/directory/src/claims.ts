import { createHash, randomBytes } from 'node:crypto';
import {
  and,
  asc,
  businessClaims,
  businesses,
  desc,
  eq,
  gt,
  inArray,
  logAdminAction,
  ne,
  sql,
  towns,
  type Db,
} from '@towncore/db';
import { parseAddress } from '@towncore/mail';
import { sendDirectoryMail, siteOrigin, townMailDomain, type DirectoryMailDeps } from './mail';

// Claiming a listing (M6 PR C, D-M6-4): the person enters their name, role and business email;
// a one-time link goes to that address only; once they press the button on our site the claim
// waits for staff, who approve or reject it in Admin → Directory. Answers are the same whether
// or not the listing already has a claim, so the form can't be used to probe owners.

export const CLAIM_LIMITS = {
  /** New claims from one IP per hour. */
  perIpPerHour: 5,
  /** Verification emails per claim: at most one per 10 minutes, three a day. */
  resendEveryMs: 10 * 60_000,
  sendsPerDay: 3,
  verifyTtlMs: 7 * 86_400_000,
};

export type ClaimInput = {
  townId: string;
  slug: string;
  name: string;
  role: string;
  email: string;
  /** "I am authorized to manage this business's listing." */
  attest: boolean;
  ip: string | null;
  /** The hidden field; anything in it means a bot. */
  honeypot?: string | null;
};

export type ClaimOutcome = 'ok' | 'invalid' | 'unavailable' | 'rate_limited' | 'not_found';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const sameUtcDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export async function startClaim(
  deps: DirectoryMailDeps,
  input: ClaimInput,
): Promise<ClaimOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  if (input.honeypot?.trim()) return 'ok';
  const name = input.name.trim().slice(0, 100);
  const role = input.role.trim().slice(0, 80);
  const email = input.email.length <= 254 ? parseAddress(input.email.trim())?.address : undefined;
  if (!name || !role || !email || !input.attest) return 'invalid';

  const [listing] = await db
    .select()
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, input.townId),
        eq(businesses.slug, input.slug),
        eq(businesses.active, true),
      ),
    );
  if (!listing) return 'not_found';
  const mail = await townMailDomain(db, input.townId);
  if (!mail) return 'unavailable';

  const [existing] = await db
    .select()
    .from(businessClaims)
    .where(
      and(
        eq(businessClaims.businessId, listing.id),
        sql`lower(${businessClaims.email}) = ${email}`,
        ne(businessClaims.status, 'rejected'),
      ),
    )
    .orderBy(desc(businessClaims.createdAt))
    .limit(1);
  // Verified, waiting or approved already: nothing more to send.
  if (existing && existing.status !== 'unverified') return 'ok';
  if (!existing && input.ip) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(businessClaims)
      .where(
        and(
          eq(businessClaims.ip, input.ip),
          gt(businessClaims.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= CLAIM_LIMITS.perIpPerHour) return 'rate_limited';
  }

  const last = existing?.verifySentAt;
  const sentToday = last && sameUtcDay(last, now) ? existing!.verifySendsToday : 0;
  if (last && now.getTime() - last.getTime() < CLAIM_LIMITS.resendEveryMs) return 'ok';
  if (sentToday >= CLAIM_LIMITS.sendsPerDay) return 'ok';

  const token = newToken();
  const verify = {
    verifyTokenHash: hashToken(token),
    verifyExpiresAt: new Date(now.getTime() + CLAIM_LIMITS.verifyTtlMs),
    verifySentAt: now,
    verifySendsToday: sentToday + 1,
  };
  if (existing) {
    await db
      .update(businessClaims)
      .set({ ...verify, claimantName: name, claimantRole: role, updatedAt: now })
      .where(eq(businessClaims.id, existing.id));
  } else {
    await db.insert(businessClaims).values({
      businessId: listing.id,
      townId: input.townId,
      claimantName: name,
      claimantRole: role,
      email,
      ip: input.ip,
      createdAt: now,
      ...verify,
    });
  }
  await sendDirectoryMail(deps, mail, {
    to: email,
    kind: 'claim_verify',
    subject: `Confirm your claim on ${listing.name}`,
    lines: [
      `Someone, hopefully you, asked to manage the listing for ${listing.name} on ${mail.siteName}.`,
      'Open the link and press the button to confirm this email address. Our staff then review the claim, usually within two business days. The link expires in 7 days.',
      "If you didn't ask for this, ignore this email; nothing changes on the listing.",
    ],
    link: {
      href: `${siteOrigin(deps, mail.domain)}/directory/claim/verify?t=${encodeURIComponent(token)}`,
      label: 'Confirm my claim',
    },
  });
  return 'ok';
}

export type VerifyOutcome =
  { status: 'pending'; businessName: string } | { status: 'expired' | 'invalid' };

/** The button on our site posts the token; a GET alone verifies nothing. Single use. */
export async function verifyClaim(
  db: Db,
  townId: string,
  token: string,
  now = new Date(),
): Promise<VerifyOutcome> {
  if (!token || token.length > 100) return { status: 'invalid' };
  const [claim] = await db
    .select({ claim: businessClaims, businessName: businesses.name })
    .from(businessClaims)
    .innerJoin(businesses, eq(businesses.id, businessClaims.businessId))
    .where(
      and(
        eq(businessClaims.townId, townId),
        eq(businessClaims.verifyTokenHash, hashToken(token)),
        eq(businessClaims.status, 'unverified'),
      ),
    );
  if (!claim) return { status: 'invalid' };
  if (!claim.claim.verifyExpiresAt || claim.claim.verifyExpiresAt < now)
    return { status: 'expired' };
  await db
    .update(businessClaims)
    .set({ status: 'pending', verifiedAt: now, verifyTokenHash: null, updatedAt: now })
    .where(eq(businessClaims.id, claim.claim.id));
  return { status: 'pending', businessName: claim.businessName };
}

export type ClaimRow = {
  id: string;
  status: (typeof businessClaims.$inferSelect)['status'];
  claimantName: string;
  claimantRole: string;
  email: string;
  createdAt: Date;
  verifiedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  business: {
    id: string;
    name: string;
    slug: string;
    category: string | null;
    licenseNumber: string | null;
    licenseType: string | null;
    claimedByEmail: string | null;
  };
  town: { id: string; slug: string; name: string; domain: string };
};

/** Claims for Admin → Directory: verified ones waiting first, then recent decisions. */
export async function listClaims(
  db: Db,
  { statuses = ['pending'] as ClaimRow['status'][], limit = 100 } = {},
): Promise<ClaimRow[]> {
  const rows = await db
    .select({ claim: businessClaims, business: businesses, town: towns })
    .from(businessClaims)
    .innerJoin(businesses, eq(businesses.id, businessClaims.businessId))
    .innerJoin(towns, eq(towns.id, businessClaims.townId))
    .where(inArray(businessClaims.status, statuses))
    .orderBy(
      ...(statuses.includes('pending')
        ? [asc(businessClaims.verifiedAt)]
        : [desc(businessClaims.decidedAt)]),
    )
    .limit(limit);
  return rows.map(({ claim, business, town }) => ({
    id: claim.id,
    status: claim.status,
    claimantName: claim.claimantName,
    claimantRole: claim.claimantRole,
    email: claim.email,
    createdAt: claim.createdAt,
    verifiedAt: claim.verifiedAt,
    decidedAt: claim.decidedAt,
    decisionNote: claim.decisionNote,
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      category: business.category,
      licenseNumber: business.licenseNumber,
      licenseType: business.licenseType,
      claimedByEmail: business.claimedByEmail,
    },
    town: { id: town.id, slug: town.slug, name: town.name, domain: town.domain },
  }));
}

export class ClaimNotPending extends Error {}

/**
 * Staff decide a verified claim (audited). Approving makes the claimant the listing's one owner
 * email (D-M6-11), closes the listing's other open claims, and emails the owner how to sign in.
 */
export async function decideClaim(
  deps: DirectoryMailDeps,
  input: { claimId: string; staffId: string; decision: 'approve' | 'reject'; note?: string },
): Promise<void> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const note = input.note?.trim().slice(0, 500) || null;
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(businessClaims)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: input.staffId,
        decidedAt: now,
        decisionNote: note,
        updatedAt: now,
      })
      .where(and(eq(businessClaims.id, input.claimId), eq(businessClaims.status, 'pending')))
      .returning();
    if (!row) throw new ClaimNotPending('This claim is not waiting for a decision.');
    if (input.decision === 'approve') {
      await tx
        .update(businesses)
        .set({ claimedByEmail: row.email, claimedAt: now, updatedAt: now })
        .where(eq(businesses.id, row.businessId));
      await tx
        .update(businessClaims)
        .set({
          status: 'rejected',
          decidedBy: input.staffId,
          decidedAt: now,
          decisionNote: 'Another claim on this listing was approved.',
          updatedAt: now,
        })
        .where(
          and(
            eq(businessClaims.businessId, row.businessId),
            ne(businessClaims.id, row.id),
            inArray(businessClaims.status, ['unverified', 'pending']),
          ),
        );
    }
    return row;
  });
  await logAdminAction(db, {
    staffId: input.staffId,
    action: input.decision === 'approve' ? 'directory.claim.approve' : 'directory.claim.reject',
    target: { type: 'business_claim', id: claim.id },
    detail: { businessId: claim.businessId, email: claim.email, note },
  });
  if (input.decision !== 'approve') return;
  // The owner asked for this listing and a person approved it: account mail, not marketing.
  const mail = await townMailDomain(db, claim.townId);
  const [listing] = await db.select().from(businesses).where(eq(businesses.id, claim.businessId));
  if (!mail || !listing) return;
  await sendDirectoryMail(deps, mail, {
    to: claim.email,
    kind: 'claim_approved',
    subject: `Your claim on ${listing.name} is approved`,
    lines: [
      `You now manage the listing for ${listing.name} on ${mail.siteName}.`,
      'Sign in with this email address to add your phone number, website, hours and a short description. We send a sign-in link each time; there is no password.',
    ],
    link: { href: `${siteOrigin(deps, mail.domain)}/owner`, label: 'Sign in to edit your listing' },
  });
}
