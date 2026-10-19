import { randomBytes } from 'node:crypto';
import {
  adminActions,
  and,
  desc,
  emailCampaigns,
  eq,
  gte,
  inArray,
  mailDomains,
  placementResults,
  placementTests,
  type Db,
} from '@towncore/db';
import type { Actor } from '../outbound/send';
import { domainBrand } from './campaigns';
import { bulkFromAddress, buildBulkMime } from './message';
import type { BulkDeps } from './subscribers';

// Inbox-placement test (owner, 2026-10-19). Before a town goes live, staff send one copy of its
// real morning email to each of our own seed inboxes (PLACEMENT_SEED_ADDRESSES: company-held
// accounts at the big mailbox providers) and record where each landed. A measurement only: the
// seeds are a fixed handful, the test runs at most once a domain a day, it is tagged as its own
// stream so it never counts in the domain's bulk health, and code refuses any other recipient.

export class PlacementError extends Error {}

export const PLACEMENTS = [
  'pending',
  'inbox',
  'promotions',
  'spam',
  'missing',
  'not_sent',
] as const;
export type Placement = (typeof PLACEMENTS)[number];
/** What staff can record for a copy that was sent. */
export const RECORDABLE: readonly Placement[] = ['inbox', 'promotions', 'spam', 'missing'];

export const MAX_SEEDS = 10;
const ONE_A_DAY_MS = 24 * 3_600_000;

const PROVIDERS: Array<[RegExp, string]> = [
  [/^(gmail|googlemail)\.com$/, 'gmail'],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, 'outlook'],
  [/^(yahoo|ymail|rocketmail)\.[a-z.]+$/, 'yahoo'],
  [/^(icloud|me|mac)\.com$/, 'icloud'],
  [/^(aol|verizon)\.[a-z.]+$/, 'aol'],
  [/^(proton|protonmail)\.(me|com|ch)$/, 'proton'],
];

/** gmail, outlook, yahoo … or the address's own domain (a company mailbox on Google or Microsoft). */
export function providerOf(address: string): string {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  return PROVIDERS.find(([re]) => re.test(domain))?.[1] ?? domain;
}

/** Sends one copy to each seed inbox and records a pending result for each. */
export async function sendPlacementTest(
  deps: BulkDeps & { seeds: readonly string[] },
  actor: Actor,
  domainId: string,
): Promise<{ testId: string; token: string; sent: number; failed: number }> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const seeds = [...new Set(deps.seeds.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (seeds.length === 0)
    throw new PlacementError('Set PLACEMENT_SEED_ADDRESSES to our seed inboxes first.');
  if (seeds.length > MAX_SEEDS)
    throw new PlacementError(`At most ${MAX_SEEDS} seed inboxes; this is a check, not a list.`);

  const [domain] = await db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
  if (!domain) throw new PlacementError('No such mail domain.');
  if (domain.status !== 'live' || domain.bulkStatus === 'not_started')
    throw new PlacementError('The domain can’t send bulk mail yet; finish onboarding first.');
  const [recent] = await db
    .select({ id: placementTests.id })
    .from(placementTests)
    .where(
      and(
        eq(placementTests.domainId, domainId),
        gte(placementTests.createdAt, new Date(now.getTime() - ONE_A_DAY_MS)),
      ),
    )
    .limit(1);
  if (recent) throw new PlacementError('This domain had a placement test in the last 24 hours.');

  const brand = await domainBrand(db, domainId, deps.postalAddress);
  if (!brand.postalAddress)
    throw new PlacementError('Set a postal address before sending (MAIL_POSTAL_ADDRESS).');
  const content = await sampleContent(db, domainId, brand.siteName, brand.townName);

  const token = randomBytes(4).toString('hex').toUpperCase();
  const [test] = await db
    .insert(placementTests)
    .values({ domainId, token, createdBy: actor.id, createdAt: now })
    .returning();
  let sent = 0;
  let failed = 0;
  for (const seed of seeds) {
    let sesMessageId: string | null = null;
    let sendError: string | null = null;
    try {
      const raw = await buildBulkMime({
        brand,
        to: seed,
        subject: content.subject,
        html: `${content.html}<p style="color:#888;font-size:12px">Placement check ${token}</p>`,
        text: `${content.text}\n\nPlacement check ${token}`,
        unsubscribeToken: 'placement',
        campaignId: test!.id,
        kind: 'placement',
      });
      ({ sesMessageId } = await deps.transport.send({
        raw,
        from: bulkFromAddress(brand.domain),
        to: [seed],
        cc: [],
        configurationSet: deps.configurationSet,
        tags: { domain: brand.domain, domain_id: domainId, stream: 'placement', kind: 'placement' },
      }));
      sent++;
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
      failed++;
    }
    await db.insert(placementResults).values({
      testId: test!.id,
      seed,
      provider: providerOf(seed),
      sesMessageId,
      sendError,
      placement: sendError ? 'not_sent' : 'pending',
    });
  }
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: 'placement_test_send',
    targetType: 'mail_domain',
    targetId: domainId,
    detail: { token, seeds: seeds.length, sent, failed },
  });
  return { testId: test!.id, token, sent, failed };
}

/** The domain's latest newsletter or campaign, so the test measures the mail we really send. */
async function sampleContent(db: Db, domainId: string, siteName: string, townName: string) {
  const [latest] = await db
    .select({
      subject: emailCampaigns.subject,
      html: emailCampaigns.html,
      text: emailCampaigns.text,
    })
    .from(emailCampaigns)
    .where(
      and(
        eq(emailCampaigns.domainId, domainId),
        inArray(emailCampaigns.status, ['scheduled', 'sending', 'sent', 'paused']),
      ),
    )
    .orderBy(desc(emailCampaigns.createdAt))
    .limit(1);
  if (latest) return latest;
  const text =
    `Good morning, ${townName}.\n\n` +
    `This is ${siteName}'s morning email: the day's weather, new stories from city hall and ` +
    `public records, and what's coming up around town.`;
  return {
    subject: `${siteName}: your morning briefing`,
    html: `<p>Good morning, ${escape(townName)}.</p><p>This is ${escape(siteName)}’s morning email: the day’s weather, new stories from city hall and public records, and what’s coming up around town.</p>`,
    text,
  };
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Staff record where one seed's copy landed. */
export async function recordPlacement(
  db: Db,
  actor: Actor,
  resultId: string,
  placement: Placement,
  now = new Date(),
): Promise<void> {
  if (!RECORDABLE.includes(placement))
    throw new PlacementError('Pick inbox, promotions, spam or missing.');
  const [row] = await db
    .update(placementResults)
    .set({ placement, checkedBy: actor.id, checkedAt: now })
    .where(
      and(
        eq(placementResults.id, resultId),
        inArray(placementResults.placement, [...RECORDABLE, 'pending']),
      ),
    )
    .returning({ testId: placementResults.testId, seed: placementResults.seed });
  if (!row) throw new PlacementError('That copy wasn’t sent, so there is nothing to record.');
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: 'placement_record',
    targetType: 'placement_test',
    targetId: row.testId,
    detail: { seed: row.seed, placement },
  });
}

export type PlacementSummary = {
  testId: string;
  token: string;
  createdAt: Date;
  results: Array<typeof placementResults.$inferSelect>;
  sent: number;
  checked: number;
  /** Inbox and promotions both reached the reader's mailbox. */
  delivered: number;
  spam: number;
  missing: number;
  /** One line: "4 of 5 in the inbox, 1 in spam". */
  line: string;
};

export function summarize(
  test: { id: string; token: string; createdAt: Date },
  results: Array<typeof placementResults.$inferSelect>,
): PlacementSummary {
  const count = (...p: Placement[]) =>
    results.filter((r) => p.includes(r.placement as Placement)).length;
  const sent = results.length - count('not_sent');
  const checked = count('inbox', 'promotions', 'spam', 'missing');
  const delivered = count('inbox', 'promotions');
  const spam = count('spam');
  const missing = count('missing');
  const parts = [`${delivered} of ${sent} in the inbox`];
  if (count('promotions')) parts[0] += ` (${count('promotions')} under Promotions)`;
  if (spam) parts.push(`${spam} in spam`);
  if (missing) parts.push(`${missing} missing`);
  if (checked < sent) parts.push(`${sent - checked} not checked yet`);
  if (count('not_sent')) parts.push(`${count('not_sent')} not sent`);
  return {
    testId: test.id,
    token: test.token,
    createdAt: test.createdAt,
    results,
    sent,
    checked,
    delivered,
    spam,
    missing,
    line: parts.join(', '),
  };
}

/** The latest test per domain (for the domain page, Mail health and Launches). */
export async function latestPlacement(
  db: Db,
  domainIds: readonly string[],
): Promise<Map<string, PlacementSummary>> {
  const out = new Map<string, PlacementSummary>();
  if (domainIds.length === 0) return out;
  const tests = await db
    .selectDistinctOn([placementTests.domainId])
    .from(placementTests)
    .where(inArray(placementTests.domainId, [...domainIds]))
    .orderBy(placementTests.domainId, desc(placementTests.createdAt));
  if (tests.length === 0) return out;
  const results = await db
    .select()
    .from(placementResults)
    .where(
      inArray(
        placementResults.testId,
        tests.map((t) => t.id),
      ),
    )
    .orderBy(placementResults.provider, placementResults.seed);
  for (const t of tests)
    out.set(
      t.domainId,
      summarize(
        t,
        results.filter((r) => r.testId === t.id),
      ),
    );
  return out;
}
