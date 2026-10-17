import {
  and,
  asc,
  desc,
  eq,
  inArray,
  launchCohorts,
  launchCohortTowns,
  launches,
  launchStepRecords,
  logAdminAction,
  ne,
  townCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { approveLaunch, GoLiveRefused } from './golive';

// Launch cohorts, the admin side (owner, 2026-10-17, "Connected systems and agentic workflows";
// docs/plans/agentic-ops.md). An admin picks approved towns into a cohort; the orchestrator
// (cohort-run.ts) proposes names and prices; the admin approves the whole cohort's domains in ONE
// approval, typing the stated total back (Rule 10); the chain then runs by itself up to draft
// review; one more admin click takes the ready towns live. Imported by the web app: keep this
// module free of heavy dependencies.

export class CohortRefused extends Error {}

type Staff = { id: string; role: 'admin' | 'reviewer' };

export type Cohort = typeof launchCohorts.$inferSelect;
export type CohortTown = typeof launchCohortTowns.$inferSelect;

/** The clear name proposals the launch's step 2 found, in the order an admin picks from. */
export type NameChoice = {
  siteName: string;
  domain: string;
  price: number;
  renewalPrice: number;
  premium: boolean;
  review: string[];
};

export type PurchaseApproval = {
  staffId: string;
  approvedAt: string;
  dryRun: boolean;
  totalUsd: number;
  domains: Array<{
    cohortTownId: string;
    name: string;
    siteName: string;
    domain: string;
    price: number;
    pick: number;
  }>;
};

export type CohortTownRow = CohortTown & {
  name: string;
  /** The town's US state ("FL"); `state` is where the town is in the chain. */
  usState: string;
  choices: NameChoice[];
  launch: { status: string; stoppedReason: string | null } | null;
  town: { id: string; status: string; siteName: string; domain: string } | null;
};

export type CohortRow = Cohort & { towns: CohortTownRow[]; totalUsd: number };

export const cohortStageLabels: Record<CohortTown['stage'], string> = {
  names: 'Names and prices',
  purchase: 'Domain purchase',
  mail: 'Mail onboarding',
  dns: 'DNS verification and warm-up',
  provision: 'Site provisioning',
  review: 'Draft review',
  live: 'Live',
};

const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => `$${n.toFixed(2)}`;

/** Reads "$1,234.50", "1234.5" or "1234" as cents; null when it isn't an amount. */
export function parseAmount(typed: string): number | null {
  const clean = typed.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Clear proposals from a launch's names step (blocked ones can't be picked). */
export function nameChoices(detail: unknown): NameChoice[] {
  const proposals =
    (
      detail as {
        proposals?: Array<{
          siteName: string;
          domain: string;
          blocked: string[];
          review: string[];
          quote: { available: boolean; price?: number; renewalPrice?: number; premium?: boolean };
        }>;
      } | null
    )?.proposals ?? [];
  return proposals
    .filter((p) => p.blocked.length === 0 && p.quote.available)
    .map((p) => ({
      siteName: p.siteName,
      domain: p.domain,
      price: p.quote.price ?? 0,
      renewalPrice: p.quote.renewalPrice ?? 0,
      premium: p.quote.premium ?? false,
      review: p.review,
    }));
}

function requireAdmin(staff: Staff, what: string) {
  if (staff.role !== 'admin') throw new CohortRefused(`Only an admin can ${what}.`);
}

/** Every cohort, newest first, with its towns and what each is waiting on. */
export async function listCohorts(db: Db, limit = 12): Promise<CohortRow[]> {
  const cohorts = await db
    .select()
    .from(launchCohorts)
    .orderBy(desc(launchCohorts.createdAt))
    .limit(limit);
  const out: CohortRow[] = [];
  for (const cohort of cohorts) {
    const rows = await db
      .select({ row: launchCohortTowns, name: townCandidates.name, usState: townCandidates.state })
      .from(launchCohortTowns)
      .innerJoin(townCandidates, eq(townCandidates.id, launchCohortTowns.candidateId))
      .where(eq(launchCohortTowns.cohortId, cohort.id))
      .orderBy(asc(townCandidates.state), asc(townCandidates.rank));
    const townsOut: CohortTownRow[] = [];
    for (const { row, name, usState } of rows) {
      let choices: NameChoice[] = [];
      let launch: CohortTownRow['launch'] = null;
      let town: CohortTownRow['town'] = null;
      if (row.launchId) {
        const [l] = await db.select().from(launches).where(eq(launches.id, row.launchId));
        const [names] = await db
          .select({ detail: launchStepRecords.detail })
          .from(launchStepRecords)
          .where(
            and(eq(launchStepRecords.launchId, row.launchId), eq(launchStepRecords.step, 'names')),
          );
        choices = nameChoices(names?.detail);
        if (l) {
          launch = { status: l.status, stoppedReason: l.stoppedReason };
          const [t] = await db
            .select({
              id: towns.id,
              status: towns.status,
              siteName: towns.siteName,
              domain: towns.domain,
            })
            .from(towns)
            .where(eq(towns.slug, l.slug));
          town = t ?? null;
        }
      }
      townsOut.push({ ...row, name, usState, choices, launch, town });
    }
    const totalUsd =
      cents(
        townsOut
          .filter((t) => t.stage === 'names' && t.state === 'done')
          .reduce((n, t) => n + (t.choices[t.pick - 1]?.price ?? 0), 0),
      ) / 100;
    out.push({ ...cohort, towns: townsOut, totalUsd });
  }
  return out;
}

/** Approved towns not yet in a cohort (or only in cancelled ones), best ranked first. */
export async function cohortCandidates(db: Db, limit = 100) {
  const taken = db
    .select({ id: launchCohortTowns.candidateId })
    .from(launchCohortTowns)
    .innerJoin(launchCohorts, eq(launchCohorts.id, launchCohortTowns.cohortId))
    .where(ne(launchCohorts.status, 'cancelled'));
  const rows = await db
    .select()
    .from(townCandidates)
    .where(eq(townCandidates.status, 'approved'))
    .orderBy(asc(townCandidates.state), asc(townCandidates.rank))
    .limit(limit * 2);
  const busy = new Set((await taken).map((r) => r.id));
  return rows.filter((r) => !busy.has(r.id)).slice(0, limit);
}

/** Starts a cohort from approved towns. Dry run unless `dryRun: false` (admin only; audited). */
export async function createCohort(
  db: Db,
  input: { name: string; candidateIds: string[]; staff: Staff; dryRun: boolean },
): Promise<Cohort> {
  requireAdmin(input.staff, 'start a launch cohort');
  const name = input.name.trim();
  if (!/^[\w .:-]{2,40}$/.test(name))
    throw new CohortRefused('Name the cohort in a few plain characters, e.g. 2026-11.');
  const ids = [...new Set(input.candidateIds)];
  if (!ids.length) throw new CohortRefused('Pick at least one approved town.');
  const available = new Set((await cohortCandidates(db, 10_000)).map((c) => c.id));
  const notReady = ids.filter((id) => !available.has(id));
  if (notReady.length)
    throw new CohortRefused(
      'Every town must be approved in the ranked list and not already in a cohort (CLAUDE.md §10a).',
    );
  const [existing] = await db.select().from(launchCohorts).where(eq(launchCohorts.name, name));
  if (existing) throw new CohortRefused(`There is already a cohort named ${name}.`);
  const [cohort] = await db
    .insert(launchCohorts)
    .values({ name, dryRun: input.dryRun, createdBy: input.staff.id })
    .returning();
  await db
    .insert(launchCohortTowns)
    .values(ids.map((candidateId) => ({ cohortId: cohort!.id, candidateId })));
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'cohort.create',
    target: { type: 'launch_cohort', id: cohort!.id },
    detail: { name, towns: ids.length, dryRun: input.dryRun },
  });
  return cohort!;
}

/** Changes which clear name a town gets before the purchase is approved (admin only). */
export async function setCohortPicks(
  db: Db,
  input: { cohortId: string; staff: Staff; picks: Record<string, number> },
) {
  requireAdmin(input.staff, 'pick names');
  const [cohort] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.id, input.cohortId));
  if (!cohort || cohort.purchaseApproval)
    throw new CohortRefused('Names can change only before the purchase is approved.');
  for (const [cohortTownId, pick] of Object.entries(input.picks)) {
    if (!Number.isInteger(pick) || pick < 1 || pick > 3) throw new CohortRefused('Pick 1, 2 or 3.');
    await db
      .update(launchCohortTowns)
      .set({ pick })
      .where(
        and(
          eq(launchCohortTowns.id, cohortTownId),
          eq(launchCohortTowns.cohortId, cohort.id),
          eq(launchCohortTowns.stage, 'names'),
        ),
      );
  }
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'cohort.picks',
    target: { type: 'launch_cohort', id: cohort.id },
    detail: { picks: input.picks },
  });
}

/**
 * The one Rule 10 approval for a cohort's domains: each town's picked domain at its stated
 * price, and the total typed back exactly. It covers the purchases and the mail onboarding (SES
 * identities and DNS records) that follow; nothing is bought for a dry-run cohort. Admin only.
 */
export async function approveCohortPurchase(
  db: Db,
  input: { cohortId: string; staff: Staff; typedTotal: string },
  now = new Date(),
): Promise<PurchaseApproval> {
  requireAdmin(input.staff, 'approve a cohort’s domains');
  const [cohort] = (await listCohorts(db, 200)).filter((c) => c.id === input.cohortId);
  if (!cohort) throw new CohortRefused('That cohort is unknown.');
  if (cohort.status !== 'awaiting_purchase' || cohort.purchaseApproval)
    throw new CohortRefused(`The cohort is ${cohort.status.replace(/_/g, ' ')}, not waiting.`);
  const ready = cohort.towns.filter((t) => t.stage === 'names' && t.state === 'done');
  if (!ready.length) throw new CohortRefused('No town in the cohort has names to approve.');
  const domains: PurchaseApproval['domains'] = [];
  for (const t of ready) {
    const choice = t.choices[t.pick - 1];
    if (!choice) throw new CohortRefused(`${t.name} has no clear name ${t.pick}.`);
    domains.push({
      cohortTownId: t.id,
      name: `${t.name}, ${t.usState}`,
      siteName: choice.siteName,
      domain: choice.domain,
      price: choice.price,
      pick: t.pick,
    });
  }
  const total = domains.reduce((n, d) => n + cents(d.price), 0);
  if (!cohort.dryRun && parseAmount(input.typedTotal) !== total)
    throw new CohortRefused(
      `Type the total exactly as shown (${money(total / 100)}) to approve buying ${domains.length} domain(s).`,
    );
  const approval: PurchaseApproval = {
    staffId: input.staff.id,
    approvedAt: now.toISOString(),
    dryRun: cohort.dryRun,
    totalUsd: total / 100,
    domains,
  };
  const [updated] = await db
    .update(launchCohorts)
    .set({ purchaseApproval: approval, status: 'running', updatedAt: now })
    .where(and(eq(launchCohorts.id, cohort.id), eq(launchCohorts.status, 'awaiting_purchase')))
    .returning();
  if (!updated) throw new CohortRefused('The cohort changed while approving; reload.');
  await db
    .update(launchCohortTowns)
    .set({ stage: 'purchase', state: 'pending', error: null })
    .where(
      inArray(
        launchCohortTowns.id,
        domains.map((d) => d.cohortTownId),
      ),
    );
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: cohort.dryRun ? 'cohort.purchase.approve_dry_run' : 'cohort.purchase.approve',
    target: { type: 'launch_cohort', id: cohort.id },
    detail: approval,
  });
  return approval;
}

/**
 * Takes the cohort's reviewed towns live (§10 step 9), one click for all. Each town still passes
 * every go-live check (domain bought, mail live, readiness measured); one that doesn't stays in
 * review with its reasons. Schedules start; the newsletter keeps its own off → test → live path.
 */
export async function approveCohortGoLive(
  db: Db,
  input: { cohortId: string; staff: Staff },
  now = new Date(),
): Promise<{ live: string[]; held: Array<{ name: string; reason: string }> }> {
  requireAdmin(input.staff, 'take a cohort live');
  const [cohort] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.id, input.cohortId));
  if (!cohort) throw new CohortRefused('That cohort is unknown.');
  if (cohort.status !== 'awaiting_go_live' && cohort.status !== 'running')
    throw new CohortRefused(`The cohort is ${cohort.status.replace(/_/g, ' ')}.`);
  const rows = await db
    .select({ row: launchCohortTowns, name: townCandidates.name })
    .from(launchCohortTowns)
    .innerJoin(townCandidates, eq(townCandidates.id, launchCohortTowns.candidateId))
    .where(
      and(
        eq(launchCohortTowns.cohortId, cohort.id),
        eq(launchCohortTowns.stage, 'review'),
        eq(launchCohortTowns.state, 'waiting'),
      ),
    );
  if (!rows.length) throw new CohortRefused('No town in the cohort is waiting for go-live.');
  const live: string[] = [];
  const held: Array<{ name: string; reason: string }> = [];
  for (const { row, name } of rows) {
    try {
      const town = await approveLaunch(db, { launchId: row.launchId!, staff: input.staff }, now);
      await db
        .update(launchCohortTowns)
        .set({ stage: 'live', state: 'done', error: null })
        .where(eq(launchCohortTowns.id, row.id));
      live.push(town.siteName);
    } catch (error) {
      if (!(error instanceof GoLiveRefused)) throw error;
      held.push({ name, reason: error.message });
    }
  }
  const left = await db
    .select({ id: launchCohortTowns.id })
    .from(launchCohortTowns)
    .where(and(eq(launchCohortTowns.cohortId, cohort.id), ne(launchCohortTowns.stage, 'live')));
  await db
    .update(launchCohorts)
    .set({
      goLiveApproval: { staffId: input.staff.id, approvedAt: now.toISOString(), live, held },
      ...(left.length === 0 ? { status: 'live' as const } : {}),
      updatedAt: now,
    })
    .where(eq(launchCohorts.id, cohort.id));
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'cohort.go_live',
    target: { type: 'launch_cohort', id: cohort.id },
    detail: { live, held },
  });
  return { live, held };
}

/** Puts a failed town back in line at its stage, after a person fixed the cause (admin only). */
export async function retryCohortTown(db: Db, input: { cohortTownId: string; staff: Staff }) {
  requireAdmin(input.staff, 'retry a launch step');
  const [row] = await db
    .update(launchCohortTowns)
    .set({ state: 'pending', error: null })
    .where(and(eq(launchCohortTowns.id, input.cohortTownId), eq(launchCohortTowns.state, 'failed')))
    .returning();
  if (!row) throw new CohortRefused('Only a failed step can be retried.');
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'cohort.retry',
    target: { type: 'launch_cohort_town', id: row.id },
    detail: { stage: row.stage },
  });
  return row;
}

/** Ticks a manual to-do off (or back on) for one town; the batch view counts what's left. */
export async function setCohortTodo(
  db: Db,
  input: { cohortTownId: string; key: string; done: boolean; staff: Staff },
) {
  const [row] = await db
    .select()
    .from(launchCohortTowns)
    .where(eq(launchCohortTowns.id, input.cohortTownId));
  if (!row) throw new CohortRefused('That town is unknown.');
  const todos = row.todos.map((t) => (t.key === input.key ? { ...t, done: input.done } : t));
  await db.update(launchCohortTowns).set({ todos }).where(eq(launchCohortTowns.id, row.id));
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: input.done ? 'cohort.todo.done' : 'cohort.todo.reopen',
    target: { type: 'launch_cohort_town', id: row.id },
    detail: { key: input.key },
  });
}

/** To-dos across a cohort, grouped by kind, for one pass (logo picks, Facebook pages …). */
export function batchedTodos(cohort: CohortRow): Array<{ text: string; towns: string[] }> {
  const groups = new Map<string, string[]>();
  for (const t of cohort.towns)
    for (const todo of t.todos) {
      if (todo.done) continue;
      const kind = todo.key.split(':')[0]!;
      groups.set(kind, [...(groups.get(kind) ?? []), t.name]);
    }
  return [...groups].map(([kind, list]) => ({
    text: TODO_KINDS[kind] ?? kind,
    towns: list,
  }));
}

/** Labels for the batched view; a town's own to-do keeps its full text. */
export const TODO_KINDS: Record<string, string> = {
  logo: 'Logo art: make it in ChatGPT from each town’s logo-prompt.md and run pnpm identity import',
  facebook: 'Facebook pages: create them, then add facebook: to each town YAML',
  'search-console':
    'Search Console: verify each domain and submit its sitemap (manual until a Google credential exists)',
  'publisher-center': 'Google News Publisher Center for each domain',
  trademark: 'Trademark search for each picked name',
  social: 'Social handles on Facebook, Instagram and X',
  guides: 'Review the first batch of guides',
  masthead: 'Pick the masthead option',
  report: 'Launch report to-dos',
  dns: 'DNS conflicts to fix by hand (nothing was overwritten)',
  purchase: 'Domain purchases to check',
};
