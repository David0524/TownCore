import type { TownConfig } from '@towncore/config';
import {
  adminActions,
  and,
  desc,
  emailCampaignSends,
  eq,
  gte,
  inArray,
  isNotNull,
  mailDomains,
  newsletterIssues,
  newsletterTesters,
  sql,
  staff,
  towns,
  type Db,
  type Town,
} from '@towncore/db';
import {
  bulkFromAddress,
  buildBulkMime,
  domainBrand,
  networkBulkPause,
  scheduleNewsletterIssue,
  type BulkDeps,
} from '@towncore/mail';
import { gatherIssue, localDate } from './gather';
import { renderIssue } from './render';
import { shouldSend } from './select';

// The daily schedule (docs/plans/M5.md "How it runs"). Every few minutes the worker calls
// runNewsletterTick: for each town whose newsletter isn't off, once its local send time has
// passed, build that day's issue once and send it to the test list (test mode) or hand it to
// Mail-5 for every active subscriber (live mode).

export const LATE_CUTOFF_MINUTES = 180;
/** D-M5-2: test issues that must have gone out before a town can go live. */
export const TEST_ISSUES_BEFORE_LIVE = 3;

export type NewsletterMode = 'off' | 'test' | 'live';
export class NewsletterError extends Error {}

/** Minutes since local midnight in a timezone. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

export function sendWindow(
  now: Date,
  timezone: string,
  sendTime: string,
): 'before' | 'due' | 'late' {
  const [h, m] = sendTime.split(':').map(Number);
  const target = (h ?? 6) * 60 + (m ?? 0);
  const minutes = localMinutes(now, timezone);
  if (minutes < target) return 'before';
  return minutes - target > LATE_CUTOFF_MINUTES ? 'late' : 'due';
}

export type TickOutcome = {
  town: string;
  outcome: 'sent_test' | 'handed_off' | 'skipped' | 'exists' | 'waiting';
  detail?: string;
};

async function testers(db: Db, domainId: string): Promise<string[]> {
  const rows = await db
    .select({ email: staff.email })
    .from(newsletterTesters)
    .innerJoin(staff, eq(staff.id, newsletterTesters.staffId))
    .where(and(eq(newsletterTesters.domainId, domainId), eq(staff.active, true)));
  return rows.map((r) => r.email);
}

/** Builds (once) and sends one town's issue for its local date. */
export async function runTownIssue(
  deps: BulkDeps,
  town: Town,
  domain: typeof mailDomains.$inferSelect,
  now: Date,
): Promise<TickOutcome> {
  const { db } = deps;
  const date = localDate(now, town.timezone);
  const window = sendWindow(now, town.timezone, (town.config as TownConfig).newsletter_send_time);
  if (window === 'before') return { town: town.slug, outcome: 'waiting' };
  const [existing] = await db
    .select({ id: newsletterIssues.id })
    .from(newsletterIssues)
    .where(and(eq(newsletterIssues.townId, town.id), eq(newsletterIssues.date, date)));
  if (existing) return { town: town.slug, outcome: 'exists' };

  const mode = domain.newsletterMode as NewsletterMode;
  const skip = async (reason: string): Promise<TickOutcome> => {
    await db
      .insert(newsletterIssues)
      .values({
        townId: town.id,
        date,
        mode: mode === 'live' ? 'live' : 'test',
        skippedReason: reason,
      })
      .onConflictDoNothing();
    return { town: town.slug, outcome: 'skipped', detail: reason };
  };
  if (window === 'late')
    return skip(`more than ${LATE_CUTOFF_MINUTES / 60} hours past the send time`);

  const content = await gatherIssue(db, town, now);
  const decision = shouldSend(content.items.length, content.weather?.alerts.length ?? 0);
  if (!decision.send) return skip(decision.reason);
  const rendered = renderIssue(content);
  const recipients = mode === 'test' ? await testers(db, domain.id) : [];
  if (mode === 'test' && !recipients.length) return skip('test mode with nobody on the test list');

  // Claiming the (town, date) row first means a retried or concurrent tick never sends twice.
  const [issue] = await db
    .insert(newsletterIssues)
    .values({
      townId: town.id,
      date,
      mode: mode === 'live' ? 'live' : 'test',
      articleIds: content.items.map((i) => i.id),
      subject: mode === 'test' ? `[Test] ${rendered.subject}` : rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    .onConflictDoNothing()
    .returning();
  if (!issue) return { town: town.slug, outcome: 'exists' };

  if (mode === 'live') {
    const campaign = await scheduleNewsletterIssue(db, {
      domainId: domain.id,
      issueId: issue.id,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      at: now,
    });
    await db
      .update(newsletterIssues)
      .set({ campaignId: campaign.id, sentAt: now })
      .where(eq(newsletterIssues.id, issue.id));
    return { town: town.slug, outcome: 'handed_off', detail: campaign.id };
  }

  const brand = await domainBrand(db, domain.id, deps.postalAddress);
  let sent = 0;
  for (const to of recipients) {
    const raw = await buildBulkMime({
      brand,
      to,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      unsubscribeToken: 'test',
      campaignId: issue.id,
      kind: 'newsletter',
    });
    await deps.transport.send({
      raw,
      from: bulkFromAddress(brand.domain),
      to: [to],
      cc: [],
      configurationSet: deps.configurationSet,
      tags: { domain: brand.domain, domain_id: domain.id, stream: 'bulk', kind: 'newsletter_test' },
    });
    sent++;
  }
  await db
    .update(newsletterIssues)
    .set({ sentAt: now, stats: { testRecipients: sent } })
    .where(eq(newsletterIssues.id, issue.id));
  return { town: town.slug, outcome: 'sent_test', detail: `${sent} tester(s)` };
}

/** Every town whose mail domain can send bulk mail and whose newsletter isn't off. */
export async function runNewsletterTick(deps: BulkDeps, now = new Date()): Promise<TickOutcome[]> {
  const { db } = deps;
  if (await networkBulkPause(db)) return [];
  const rows = await db
    .select({ domain: mailDomains, town: towns })
    .from(mailDomains)
    .innerJoin(towns, eq(towns.id, mailDomains.townId))
    .where(
      and(
        inArray(mailDomains.newsletterMode, ['test', 'live']),
        eq(mailDomains.status, 'live'),
        inArray(mailDomains.bulkStatus, ['warming', 'active']),
      ),
    );
  const out: TickOutcome[] = [];
  for (const { domain, town } of rows) {
    try {
      out.push(await runTownIssue(deps, town, domain, now));
    } catch (error) {
      out.push({
        town: town.slug,
        outcome: 'skipped',
        detail: `error: ${(error as Error).message}`,
      });
    }
  }
  await rollUpStats(db, now);
  return out;
}

/** Copies Mail-5's per-send counts onto the last week's live issues (no opens are counted). */
export async function rollUpStats(db: Db, now = new Date()): Promise<void> {
  const recent = await db
    .select({ id: newsletterIssues.id, campaignId: newsletterIssues.campaignId })
    .from(newsletterIssues)
    .where(
      and(
        isNotNull(newsletterIssues.campaignId),
        gte(newsletterIssues.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    );
  for (const issue of recent) {
    const counts = await db
      .select({ status: emailCampaignSends.status, n: sql<number>`count(*)::int` })
      .from(emailCampaignSends)
      .where(eq(emailCampaignSends.campaignId, issue.campaignId!))
      .groupBy(emailCampaignSends.status);
    await db
      .update(newsletterIssues)
      .set({ stats: Object.fromEntries(counts.map((c) => [c.status, c.n])) })
      .where(eq(newsletterIssues.id, issue.id));
  }
}

/** Test issues that actually went out for this town. */
export async function testIssuesSent(db: Db, townId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(newsletterIssues)
    .where(
      and(
        eq(newsletterIssues.townId, townId),
        eq(newsletterIssues.mode, 'test'),
        isNotNull(newsletterIssues.sentAt),
      ),
    );
  return row?.n ?? 0;
}

/**
 * D-M5-2 and D-MAIL-11: an admin moves a town off → test → live. Going live needs at least
 * three test issues sent, and records the standing approval; leaving live withdraws it.
 */
export async function setNewsletterMode(
  db: Db,
  actor: { id: string },
  domainId: string,
  mode: NewsletterMode,
): Promise<void> {
  const [who] = await db.select().from(staff).where(eq(staff.id, actor.id));
  if (who?.role !== 'admin' || !who.active)
    throw new NewsletterError('Only an admin can change this.');
  const [domain] = await db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
  if (!domain?.townId) throw new NewsletterError('Only a town domain has a newsletter.');
  if (mode === 'live') {
    const sent = await testIssuesSent(db, domain.townId);
    if (sent < TEST_ISSUES_BEFORE_LIVE)
      throw new NewsletterError(
        `Send at least ${TEST_ISSUES_BEFORE_LIVE} test issues first (${sent} so far).`,
      );
  }
  await db
    .update(mailDomains)
    .set({
      newsletterMode: mode,
      ...(mode === 'live'
        ? { newsletterApprovedAt: new Date(), newsletterApprovedBy: actor.id }
        : { newsletterApprovedAt: null, newsletterApprovedBy: null }),
    })
    .where(eq(mailDomains.id, domainId));
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: 'newsletter_mode',
    targetType: 'mail_domain',
    targetId: domainId,
    detail: { from: domain.newsletterMode, to: mode },
  });
}

export async function setNewsletterTester(
  db: Db,
  actor: { id: string },
  domainId: string,
  staffId: string,
  on: boolean,
): Promise<void> {
  if (on) await db.insert(newsletterTesters).values({ domainId, staffId }).onConflictDoNothing();
  else
    await db
      .delete(newsletterTesters)
      .where(and(eq(newsletterTesters.domainId, domainId), eq(newsletterTesters.staffId, staffId)));
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: on ? 'newsletter_tester_add' : 'newsletter_tester_remove',
    targetType: 'mail_domain',
    targetId: domainId,
    detail: { staffId },
  });
}

/** For the admin: the most recent issues of one town. */
export async function recentIssues(db: Db, townId: string, limit = 30) {
  return db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.townId, townId))
    .orderBy(desc(newsletterIssues.date))
    .limit(limit);
}
