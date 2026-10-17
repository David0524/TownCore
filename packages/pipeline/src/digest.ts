import { networkAiCapUsd } from '@towncore/config';
import {
  adapterFixRequests,
  and,
  articles,
  desc,
  domainHealthDaily,
  eq,
  gte,
  inArray,
  launchCohorts,
  launchCohortTowns,
  mailDomains,
  ne,
  opsDigests,
  proposals,
  sourceProposals,
  sql,
  type Db,
} from '@towncore/db';
import { cohortGates } from './cohort-gates';
import { networkSpendSince } from './llm';
import { networkSpendToday, opsConditions } from './ops';

// The ops agent's daily digest (owner, 2026-10-17; docs/plans/agentic-ops.md). Built in code, no
// model: one summary before the US Eastern morning with every item a suggested action and an admin
// link. Stored for Admin → Digest and emailed to staff only (the alert path, towncore.net only).

export type DigestItem = {
  section: string;
  severity: 'info' | 'warning' | 'critical';
  text: string;
  action: string;
  /** An admin path, e.g. /admin/health. */
  link: string;
};

export type Digest = { date: string; items: DigestItem[]; text: string };

const DAY = 86_400_000;
const usd = (n: number) => `$${n.toFixed(2)}`;

export const DIGEST_SECTIONS = [
  'Cohorts and Google',
  'Launches',
  'AI cost',
  'Sources',
  'Review queue',
  'Mail',
  'Proposals',
] as const;

export async function buildDigest(db: Db, now = new Date()): Promise<Digest> {
  const items: DigestItem[] = [];
  const add = (section: (typeof DIGEST_SECTIONS)[number], item: Omit<DigestItem, 'section'>) =>
    items.push({ section, ...item });
  const conditions = await opsConditions(db, now);

  // Cohort health and Google signals.
  const gates = await cohortGates(db, now);
  for (const g of gates) {
    const failed = g.gates.filter((x) => x.status === 'fail');
    add('Cohorts and Google', {
      severity: failed.length ? 'warning' : 'info',
      text: `Cohort ${g.cohort} (${g.towns} towns): ${failed.length ? `fails ${failed.map((x) => x.gate.toLowerCase()).join(', ')}` : 'no gate failed'}.`,
      action: failed.length
        ? 'Hold the next cohort; consider the search kill switch.'
        : 'Decide the next cohort in Proposals.',
      link: '/admin/proposals',
    });
  }
  add('Cohorts and Google', {
    severity: 'info',
    text: 'Google signals: Search Console is not connected yet (no Google credential), so indexing, impressions and manual actions are not in this digest.',
    action: 'Check Search Console by hand for each live cohort.',
    link: '/admin/health',
  });

  // Launch cohorts in progress and what they wait on.
  const cohorts = await db
    .select()
    .from(launchCohorts)
    .where(
      inArray(launchCohorts.status, [
        'preparing',
        'awaiting_purchase',
        'running',
        'awaiting_go_live',
      ]),
    );
  for (const c of cohorts) {
    const rows = await db
      .select({
        stage: launchCohortTowns.stage,
        state: launchCohortTowns.state,
        todos: launchCohortTowns.todos,
      })
      .from(launchCohortTowns)
      .where(eq(launchCohortTowns.cohortId, c.id));
    const failed = rows.filter((r) => r.state === 'failed').length;
    const todos = rows.reduce((n, r) => n + r.todos.filter((t) => !t.done).length, 0);
    const waitingOn =
      c.status === 'awaiting_purchase'
        ? 'an admin to approve the domains at the stated total'
        : c.status === 'awaiting_go_live'
          ? 'an admin to take it live'
          : 'the chain (purchases, mail, DNS, provisioning)';
    add('Launches', {
      severity: failed ? 'warning' : 'info',
      text: `Cohort ${c.name}${c.dryRun ? ' (dry run)' : ''}: ${rows.length} towns, waiting on ${waitingOn}${failed ? `; ${failed} failed` : ''}${todos ? `; ${todos} manual to-dos` : ''}.`,
      action: failed ? 'Fix the failed towns and press Retry.' : 'Open the cohort.',
      link: '/admin/launches',
    });
  }

  // AI spend against the caps, and the week-over-week rise.
  const today = await networkSpendToday(db, now);
  const yesterdayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY,
  );
  const yesterday = (await networkSpendSince(db, yesterdayStart)) - today;
  const cap = networkAiCapUsd();
  add('AI cost', {
    severity: yesterday >= cap * 0.8 ? 'warning' : 'info',
    text: `AI spend yesterday ${usd(yesterday)} of the ${usd(cap)} network cap; ${usd(today)} so far today.`,
    action:
      yesterday >= cap * 0.8
        ? 'Look at spend by task before it stops the pipeline.'
        : 'Nothing to do.',
    link: '/admin/health',
  });
  for (const c of conditions.filter((x) =>
    /^(town_cap|task_cap|cost_per_story|network_cap):/.test(`${x.key}:`),
  ))
    add('AI cost', {
      severity: c.severity,
      text: c.message,
      action: c.key.startsWith('cost_per_story')
        ? 'Find which task grew (AI spend by task); a +50% week is an alert (CLAUDE.md §8).'
        : 'Check what used the cap; it resets at midnight.',
      link: '/admin/health',
    });

  // Failing sources and their fix requests.
  const broken = conditions.filter((c) => c.key.startsWith('source_broken:'));
  const fixes = await db
    .select({ scope: adapterFixRequests.scope, n: sql<number>`count(*)::int` })
    .from(adapterFixRequests)
    .where(inArray(adapterFixRequests.status, ['open', 'in_progress']))
    .groupBy(adapterFixRequests.scope);
  const fixCount = (s: string) => fixes.find((f) => f.scope === s)?.n ?? 0;
  add('Sources', {
    severity: broken.some((b) => b.severity === 'critical')
      ? 'critical'
      : broken.length
        ? 'warning'
        : 'info',
    text: `${broken.length} broken source(s); ${fixCount('source')} open fix request(s), ${fixCount('platform')} platform pattern(s).`,
    action:
      broken.length || fixCount('source')
        ? 'Fix requests are picked up by a Claude Code session (docs/ops/adapter-fix-routine.md); platform patterns first.'
        : 'Nothing to do.',
    link: '/admin/fixes',
  });
  const [newSources] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sourceProposals)
    .where(eq(sourceProposals.status, 'proposed'));
  if (newSources?.n)
    add('Sources', {
      severity: 'info',
      text: `${newSources.n} new source(s) found by discovery wait for a decision.`,
      action: 'Approve or reject each in one click.',
      link: '/admin/proposals',
    });

  // The review queue and its age.
  const [review] = await db
    .select({
      n: sql<number>`count(*)::int`,
      oldest: sql<string | null>`min(${articles.updatedAt})`,
    })
    .from(articles)
    .where(eq(articles.status, 'in_review'));
  const hours = review?.oldest
    ? Math.round((now.getTime() - new Date(review.oldest).getTime()) / 3_600_000)
    : null;
  add('Review queue', {
    severity: hours !== null && hours > 24 ? 'warning' : 'info',
    text: review?.n
      ? `${review.n} stor${review.n === 1 ? 'y waits' : 'ies wait'} in review; the oldest for ${hours} hours.`
      : 'The review queue is empty.',
    action: review?.n ? 'Tier 3 needs a person: clear the oldest first.' : 'Nothing to do.',
    link: '/admin/review',
  });

  // Mail: warm-up, pauses, bounces.
  const domains = await db
    .select({
      name: mailDomains.name,
      status: mailDomains.status,
      bulk: mailDomains.bulkStatus,
      day: mailDomains.warmupDay,
      cap: mailDomains.bulkDailyCap,
      reason: mailDomains.pausedReason,
    })
    .from(mailDomains)
    .where(ne(mailDomains.status, 'removed'));
  const warming = domains.filter((d) => d.bulk === 'warming');
  const paused = domains.filter((d) => d.bulk === 'paused');
  const failing = domains.filter((d) => d.status === 'failed');
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const [sent] = await db
    .select({
      sent: sql<number>`coalesce(sum(${domainHealthDaily.sent}), 0)::int`,
      bounced: sql<number>`coalesce(sum(${domainHealthDaily.bounced}), 0)::int`,
      complained: sql<number>`coalesce(sum(${domainHealthDaily.complained}), 0)::int`,
    })
    .from(domainHealthDaily)
    .where(gte(domainHealthDaily.date, since));
  add('Mail', {
    severity: paused.length ? 'critical' : failing.length ? 'warning' : 'info',
    text: `${domains.length} mail domain(s): ${warming.length} warming${warming.length ? ` (day ${Math.min(...warming.map((d) => d.day))}–${Math.max(...warming.map((d) => d.day))})` : ''}, ${paused.length} paused, ${failing.length} failed onboarding. Last 7 days: ${sent?.sent ?? 0} sent, ${sent?.bounced ?? 0} bounced, ${sent?.complained ?? 0} complaints.`,
    action: paused.length
      ? `Read why ${paused.map((d) => d.name).join(', ')} paused before unpausing (runbook).`
      : failing.length
        ? 'Retry failed onboarding once the DNS is fixed.'
        : 'Nothing to do.',
    link: '/admin/mail/health',
  });

  // Decisions the learning loops prepared.
  const open = await db
    .select({ kind: proposals.kind, n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(eq(proposals.status, 'open'))
    .groupBy(proposals.kind);
  const total = open.reduce((n, o) => n + o.n, 0);
  add('Proposals', {
    severity: 'info',
    text: total
      ? `${total} proposal(s) wait: ${open.map((o) => `${o.n} ${o.kind.replace('_', ' ')}`).join(', ')}.`
      : 'No proposals wait.',
    action: total ? 'Approve or reject each in one click.' : 'Nothing to do.',
    link: '/admin/proposals',
  });

  const date = now.toISOString().slice(0, 10);
  return { date, items, text: digestText(date, items) };
}

export function digestText(date: string, items: DigestItem[], baseUrl = ''): string {
  const lines = [`TownCore daily digest, ${date}`, ''];
  for (const section of DIGEST_SECTIONS) {
    const list = items.filter((i) => i.section === section);
    if (!list.length) continue;
    lines.push(section.toUpperCase());
    for (const i of list)
      lines.push(
        `${i.severity === 'info' ? '-' : i.severity === 'critical' ? '! CRITICAL:' : '! '} ${i.text}`,
        `  Next: ${i.action} ${baseUrl}${i.link}`,
      );
    lines.push('');
  }
  lines.push('Built in code from the database; every decision stays in Admin.');
  return lines.join('\n');
}

/** Builds today's digest once; a second run the same day returns the stored one. */
export async function storeDigest(
  db: Db,
  now = new Date(),
): Promise<{ digest: typeof opsDigests.$inferSelect; created: boolean }> {
  const date = now.toISOString().slice(0, 10);
  const [existing] = await db.select().from(opsDigests).where(eq(opsDigests.date, date));
  if (existing) return { digest: existing, created: false };
  const built = await buildDigest(db, now);
  const [row] = await db
    .insert(opsDigests)
    .values({ date, items: built.items, text: built.text })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [again] = await db.select().from(opsDigests).where(eq(opsDigests.date, date));
    return { digest: again!, created: false };
  }
  return { digest: row, created: true };
}

export async function listDigests(db: Db, limit = 14) {
  return db.select().from(opsDigests).orderBy(desc(opsDigests.date)).limit(limit);
}

export async function markDigestEmailed(db: Db, id: string, now = new Date()) {
  await db
    .update(opsDigests)
    .set({ emailedAt: now })
    .where(and(eq(opsDigests.id, id), sql`${opsDigests.emailedAt} is null`));
}
