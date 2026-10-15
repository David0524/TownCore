import {
  and,
  emailCampaignSends,
  eq,
  gt,
  inArray,
  mailDomains,
  sql,
  subscribers,
  suppressions,
  towns,
  type Db,
} from '@towncore/db';
import { parseAddress } from '../address';
import { suppress, suppressedAddresses } from '../outbound/suppression';
import type { MailTransport } from '../outbound/transport';
import { BULK_CONFIG } from './config';
import { networkBulkPause } from './health';
import { bulkFromAddress, buildConfirmationMime, type BulkBrand } from './message';
import { confirmToken, verifyConfirmToken, verifyUnsubscribeToken } from './tokens';

// Newsletter signups (brief Phase 5, §7.3): double opt-in from the town's own site, consent
// evidence, rate limits, and unsubscribe that takes effect at once.

export type BulkDeps = {
  db: Db;
  transport: MailTransport;
  /** The bulk configuration set (SES_CONFIG_SET_BULK). */
  configurationSet: string;
  secret: string;
  /** Company-wide footer address (MAIL_POSTAL_ADDRESS) when the domain has none. */
  postalAddress: string | null;
  /** Origin for links on a town site; https://<domain> unless overridden (dev, tests). */
  siteOrigin?: (domain: string) => string;
  now?: () => Date;
};

export const siteOriginOf = (deps: Pick<BulkDeps, 'siteOrigin'>, domain: string) =>
  deps.siteOrigin?.(domain) ?? `https://${domain}`;

export type NewsletterDomain = {
  domainId: string;
  domain: string;
  townId: string;
  brand: BulkBrand;
};

/**
 * The mail domain that sends this town's newsletter, or null while the town can't take
 * signups (no live domain, bulk not started or paused, or bulk paused for every town).
 */
export async function newsletterDomain(
  db: Db,
  townId: string,
  fallbackPostalAddress: string | null,
): Promise<NewsletterDomain | null> {
  const [row] = await db
    .select({ domain: mailDomains, siteName: towns.siteName })
    .from(mailDomains)
    .innerJoin(towns, eq(towns.id, mailDomains.townId))
    .where(
      and(
        eq(mailDomains.townId, townId),
        eq(mailDomains.status, 'live'),
        inArray(mailDomains.bulkStatus, ['warming', 'active']),
      ),
    )
    .limit(1);
  const postalAddress = row?.domain.postalAddress ?? fallbackPostalAddress;
  if (!row || !postalAddress) return null;
  if (await networkBulkPause(db)) return null;
  return {
    domainId: row.domain.id,
    domain: row.domain.name,
    townId,
    brand: { siteName: row.siteName, domain: row.domain.name, postalAddress },
  };
}

export type SignupInput = {
  townId: string;
  email: string;
  ip: string | null;
  sourceUrl: string;
  /** The hidden field; anything in it means a bot. */
  honeypot?: string | null;
};

export type SignupOutcome = 'ok' | 'invalid' | 'unavailable' | 'rate_limited';

const sameUtcDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * Starts double opt-in. Answers 'ok' whether or not the address was already subscribed, so the
 * form can't be used to find out who is on the list.
 */
export async function signup(deps: BulkDeps, input: SignupInput): Promise<SignupOutcome> {
  const now = deps.now?.() ?? new Date();
  if (input.honeypot?.trim()) return 'ok';
  const parsed = parseAddress(input.email.trim());
  if (!parsed || input.email.length > 254) return 'invalid';
  const email = parsed.address;
  const nd = await newsletterDomain(deps.db, input.townId, deps.postalAddress);
  if (!nd) return 'unavailable';
  const { db } = deps;
  const cfg = BULK_CONFIG.signup;

  const [existing] = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.townId, input.townId), sql`lower(${subscribers.email}) = ${email}`));
  if (!existing && input.ip) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.consentIp, input.ip),
          gt(subscribers.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= cfg.perIpPerHour) return 'rate_limited';
  }
  if (existing && ['active', 'bounced', 'complained'].includes(existing.status)) return 'ok';

  const consent = {
    consentAt: now,
    consentSource: input.sourceUrl.slice(0, 500),
    consentIp: input.ip,
    source: 'signup_form',
  };
  const [sub] = existing
    ? await db
        .update(subscribers)
        .set({
          ...consent,
          status: existing.status === 'unsubscribed' ? 'pending' : existing.status,
        })
        .where(eq(subscribers.id, existing.id))
        .returning()
    : await db
        .insert(subscribers)
        .values({ townId: input.townId, email, status: 'pending', ...consent })
        .returning();
  if (!sub) return 'ok';

  // A hard bounce, complaint or manual block anywhere means we don't write to them at all.
  const blocked = (
    await suppressedAddresses(db, [email], { domainId: nd.domainId, stream: 'conversational' })
  ).length;
  const last = sub.confirmSentAt;
  const tooSoon = last && now.getTime() - last.getTime() < cfg.confirmEveryMs;
  const sentToday = last && sameUtcDay(last, now) ? sub.confirmSendsToday : 0;
  if (blocked || tooSoon || sentToday >= cfg.confirmPerDay) return 'ok';

  const token = confirmToken(deps.secret, sub.id, new Date(now.getTime() + cfg.confirmTtlMs));
  const confirmUrl = `${siteOriginOf(deps, nd.domain)}/newsletter/confirm?t=${encodeURIComponent(token)}`;
  const raw = await buildConfirmationMime({ brand: nd.brand, to: email, confirmUrl });
  await db
    .update(subscribers)
    .set({ confirmSentAt: now, confirmSendsToday: sentToday + 1 })
    .where(eq(subscribers.id, sub.id));
  await deps.transport.send({
    raw,
    from: bulkFromAddress(nd.domain),
    to: [email],
    cc: [],
    configurationSet: deps.configurationSet,
    tags: { domain: nd.domain, domain_id: nd.domainId, stream: 'bulk', kind: 'confirm' },
  });
  return 'ok';
}

export type ConfirmOutcome =
  | { status: 'confirmed' | 'already'; email: string; townId: string }
  | { status: 'expired' | 'invalid' };

export async function confirmSubscription(
  deps: Pick<BulkDeps, 'db' | 'secret' | 'now'>,
  token: string,
): Promise<ConfirmOutcome> {
  const now = deps.now?.() ?? new Date();
  const check = verifyConfirmToken(deps.secret, token, now);
  if ('error' in check) return { status: check.error };
  const [sub] = await deps.db.select().from(subscribers).where(eq(subscribers.id, check.id));
  if (!sub) return { status: 'invalid' };
  if (sub.status === 'active') return { status: 'already', email: sub.email, townId: sub.townId };
  if (sub.status !== 'pending') return { status: 'invalid' };
  await deps.db
    .update(subscribers)
    .set({ status: 'active', confirmedAt: now, lastEngagedAt: now, unsubscribedAt: null })
    .where(eq(subscribers.id, sub.id));
  // Asking again lifts their own earlier unsubscribe for this town (never a bounce or complaint).
  const domains = await deps.db
    .select({ id: mailDomains.id })
    .from(mailDomains)
    .where(eq(mailDomains.townId, sub.townId));
  if (domains.length)
    await deps.db.delete(suppressions).where(
      and(
        eq(suppressions.email, sub.email.toLowerCase()),
        eq(suppressions.reason, 'unsubscribe'),
        inArray(
          suppressions.domainId,
          domains.map((d) => d.id),
        ),
      ),
    );
  return { status: 'confirmed', email: sub.email, townId: sub.townId };
}

/** Unsubscribes now: status, a bulk-only suppression, and no further queued sends. */
export async function unsubscribeSubscriber(
  db: Db,
  subscriberId: string,
  now = new Date(),
): Promise<{ email: string; townId: string } | null> {
  const [sub] = await db.select().from(subscribers).where(eq(subscribers.id, subscriberId));
  if (!sub) return null;
  if (sub.status === 'active' || sub.status === 'pending')
    await db
      .update(subscribers)
      .set({ status: 'unsubscribed', unsubscribedAt: now })
      .where(eq(subscribers.id, sub.id));
  const domains = await db
    .select({ id: mailDomains.id })
    .from(mailDomains)
    .where(eq(mailDomains.townId, sub.townId));
  for (const d of domains)
    await suppress(db, { email: sub.email, reason: 'unsubscribe', domainId: d.id });
  await db
    .update(emailCampaignSends)
    .set({ status: 'suppressed', error: 'unsubscribed' })
    .where(
      and(
        eq(emailCampaignSends.subscriberId, sub.id),
        inArray(emailCampaignSends.status, ['queued', 'deferred_cap']),
      ),
    );
  return { email: sub.email, townId: sub.townId };
}

export async function unsubscribeByToken(
  deps: Pick<BulkDeps, 'db' | 'secret' | 'now'>,
  token: string,
): Promise<{ email: string; townId: string } | null> {
  const id = verifyUnsubscribeToken(deps.secret, token);
  if (!id) return null;
  return unsubscribeSubscriber(deps.db, id, deps.now?.() ?? new Date());
}

/** For the preference page: who the token belongs to, without changing anything. */
export async function subscriberForToken(
  deps: Pick<BulkDeps, 'db' | 'secret'>,
  token: string,
): Promise<{ id: string; email: string; townId: string; status: string } | null> {
  const id = verifyUnsubscribeToken(deps.secret, token);
  if (!id) return null;
  const [sub] = await deps.db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      townId: subscribers.townId,
      status: subscribers.status,
    })
    .from(subscribers)
    .where(eq(subscribers.id, id));
  return sub ?? null;
}
