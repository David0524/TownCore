import { createHash } from 'node:crypto';
import { parseTownConfig } from '@towncore/config';
import {
  agentRuns,
  and,
  eq,
  identityArt,
  inArray,
  isNull,
  launchCohorts,
  launchCohortTowns,
  launches,
  launchStepRecords,
  lt,
  mailDomains,
  or,
  townCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { readFileSync } from 'node:fs';
import { nameChoices, type CohortTown, type PurchaseApproval } from './cohorts';
import type { Purchase } from './domains';
import { goLiveBlockers } from './golive';
import type { LaunchOptions, LaunchResult } from './launch';
import type { NamesDetail } from './names-step';
import { DEFAULT_FRICTION_LOG, logFriction } from './report-step';

// The cohort orchestrator (owner, 2026-10-17, "Connected systems and agentic workflows";
// docs/plans/agentic-ops.md). Each town moves through a chain of stages, and each finished stage
// starts the next in the same pass:
//
//   names → (the cohort's one purchase approval) → purchase → mail → dns → provision → review
//   → (the cohort's go-live approval) → live
//
// Every stage records its state before and after it runs, so a crashed run resumes where it
// stopped; every stage is idempotent (launches resume, mail onboarding is a resumable state
// machine), and a purchase is never sent twice. People are needed at exactly two points, both one
// click for the whole cohort: the purchase (Rule 10) and go-live. Anything else manual becomes a
// to-do, batched across the cohort and logged in docs/launch-friction.md.

export type OnboardOutcome = {
  outcome: 'live' | 'waiting' | 'failed' | 'planned' | 'busy';
  error: string | null;
  conflicts: Array<{ reason: string }>;
};

export type CohortDeps = {
  db: Db;
  /**
   * Runs or resumes one town's launch (runLaunch with the worker's deps). `confirm` answers the
   * names step's purchase question in place of a person at a terminal: it is true only for the
   * domain and price the admin approved.
   */
  launch: (
    opts: LaunchOptions,
    purchase?: {
      confirm: (q: { domain: string; price: number; renewalPrice: number }) => Promise<boolean>;
    },
  ) => Promise<LaunchResult>;
  /** Starts or resumes mail onboarding for a bought domain (SES identities + DNS records). */
  onboard: (
    spec: { name: string; displayName: string; townId: string | null },
    opts: { execute: boolean },
  ) => Promise<OnboardOutcome>;
  /** The registrar's current state of a placed order (pending orders settle on a later pass). */
  orderStatus?: (orderId: string) => Promise<Purchase>;
  frictionLog?: string;
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

const LEASE_MS = 30 * 60_000;
type Step = 'advanced' | 'stop';
type Row = CohortTown & { name: string };

const todoKey = (kind: string, text: string) =>
  `${kind}:${createHash('sha256').update(text).digest('hex').slice(0, 10)}`;

/** Advances every cohort that has work to do. Returns how many it touched. */
export async function advanceCohorts(deps: CohortDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const open = await deps.db
    .select({ id: launchCohorts.id })
    .from(launchCohorts)
    .where(inArray(launchCohorts.status, ['preparing', 'running', 'awaiting_go_live']));
  let n = 0;
  for (const c of open) {
    const ran = await advanceCohort(deps, c.id).catch((error: unknown) => {
      deps.log?.('cohort run failed', { cohortId: c.id, err: String(error) });
      return false;
    });
    if (ran) n++;
  }
  if (open.length)
    await deps.db.insert(agentRuns).values({
      agent: 'cohorts',
      status: 'ok',
      summary: { cohorts: open.length, advanced: n },
      startedAt: now,
      finishedAt: deps.now?.() ?? new Date(),
    });
  return n;
}

/** One pass over a cohort: every town as far as it can go. False when another run holds it. */
export async function advanceCohort(deps: CohortDeps, cohortId: string): Promise<boolean> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const [cohort] = await db
    .update(launchCohorts)
    .set({ leaseUntil: new Date(now().getTime() + LEASE_MS) })
    .where(
      and(
        eq(launchCohorts.id, cohortId),
        or(isNull(launchCohorts.leaseUntil), lt(launchCohorts.leaseUntil, now())),
      ),
    )
    .returning();
  if (!cohort) return false;
  try {
    const rows = await db
      .select({ row: launchCohortTowns, name: townCandidates.name, state: townCandidates.state })
      .from(launchCohortTowns)
      .innerJoin(townCandidates, eq(townCandidates.id, launchCohortTowns.candidateId))
      .where(eq(launchCohortTowns.cohortId, cohortId));
    for (const { row, name, state } of rows) {
      let current: Row = { ...row, name: `${name}, ${state}` };
      // Each finished stage starts the next, until one waits (for a person, SES, the registrar).
      for (let guard = 0; guard < 10; guard++) {
        if (current.state === 'failed' || current.stage === 'live') break;
        let result: Step;
        try {
          result = await runStage(deps, cohort, current);
        } catch (error) {
          // One town's error never stops the others. The stage runs again on the next pass
          // (every stage is idempotent); a purchase keeps its "attempted" mark, so the next pass
          // stops it for a person instead of ordering again.
          const message = error instanceof Error ? error.message : String(error);
          deps.log?.('cohort stage failed', { town: current.name, stage: current.stage, message });
          await update(db, current.id, {
            error: message.slice(0, 1000),
            ...(current.stage === 'purchase' ? {} : { state: 'pending' as const }),
          });
          break;
        }
        const [fresh] = await db
          .select()
          .from(launchCohortTowns)
          .where(eq(launchCohortTowns.id, current.id));
        current = { ...fresh!, name: current.name };
        if (result === 'stop') break;
      }
    }
    await settleCohort(db, cohortId, now());
    return true;
  } finally {
    await db.update(launchCohorts).set({ leaseUntil: null }).where(eq(launchCohorts.id, cohortId));
  }
}

/** The cohort's own status follows its towns. */
async function settleCohort(db: Db, cohortId: string, now: Date) {
  const [cohort] = await db.select().from(launchCohorts).where(eq(launchCohorts.id, cohortId));
  const rows = await db
    .select()
    .from(launchCohortTowns)
    .where(eq(launchCohortTowns.cohortId, cohortId));
  const active = rows.filter((r) => r.state !== 'failed');
  let status = cohort!.status;
  if (
    status === 'preparing' &&
    rows.every((r) => r.stage !== 'names' || r.state === 'done' || r.state === 'failed') &&
    rows.some((r) => r.state === 'done')
  )
    status = 'awaiting_purchase';
  if (
    status === 'running' &&
    active.length &&
    active.every((r) => (r.stage === 'review' && r.state === 'waiting') || r.stage === 'live')
  )
    status = active.every((r) => r.stage === 'live') ? 'live' : 'awaiting_go_live';
  if (status !== cohort!.status)
    await db
      .update(launchCohorts)
      .set({ status, updatedAt: now })
      .where(eq(launchCohorts.id, cohortId));
}

async function update(db: Db, id: string, patch: Partial<typeof launchCohortTowns.$inferInsert>) {
  await db.update(launchCohortTowns).set(patch).where(eq(launchCohortTowns.id, id));
}

async function fail(db: Db, row: Row, error: string, todo?: { kind: string; text: string }) {
  const todos = todo
    ? [
        ...row.todos.filter((t) => t.key !== todoKey(todo.kind, todo.text)),
        { key: todoKey(todo.kind, todo.text), text: todo.text, done: false },
      ]
    : row.todos;
  await update(db, row.id, { state: 'failed', error, todos });
  return 'stop' as const;
}

async function namesDetail(db: Db, launchId: string): Promise<NamesDetail | undefined> {
  const [rec] = await db
    .select({ detail: launchStepRecords.detail })
    .from(launchStepRecords)
    .where(and(eq(launchStepRecords.launchId, launchId), eq(launchStepRecords.step, 'names')));
  return (rec?.detail ?? undefined) as NamesDetail | undefined;
}

async function runStage(
  deps: CohortDeps,
  cohort: typeof launchCohorts.$inferSelect,
  row: Row,
): Promise<Step> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const approval = cohort.purchaseApproval as PurchaseApproval | null;
  const mine = approval?.domains.find((d) => d.cohortTownId === row.id);
  const execute = !cohort.dryRun && Boolean(approval && !approval.dryRun);

  switch (row.stage) {
    case 'names': {
      if (row.state === 'done') return 'stop'; // waits for the cohort's purchase approval
      await update(db, row.id, { state: 'running', attempts: row.attempts + 1 });
      const res = await deps.launch({ town: row.name, resume: true, until: 'names' });
      await update(db, row.id, { launchId: res.launch.id });
      const choices = nameChoices(await namesDetail(db, res.launch.id));
      if (choices.length)
        return update(db, row.id, { state: 'done', error: null }).then(() => 'stop' as const);
      return fail(
        db,
        row,
        res.launch.stoppedReason ?? 'No clear name was found.',
        res.launch.status === 'failed'
          ? undefined
          : {
              kind: 'report',
              text: `${row.name}: no clear name. Run pnpm launch "${row.name}" --resume with --short-name or --nickname, then Retry.`,
            },
      );
    }

    case 'purchase': {
      if (!mine) return 'stop';
      const before = await namesDetail(db, row.launchId!);
      const placed = before?.purchase && 'orderId' in before.purchase ? before.purchase : null;
      if (placed) {
        // Already ordered (a pending order on an earlier pass): never order again, only settle.
        const purchase =
          placed.status === 'completed' || !deps.orderStatus
            ? placed
            : await deps.orderStatus(placed.orderId);
        if (purchase !== placed) await savePurchase(db, row.launchId!, purchase);
        const settled = purchase.status === 'completed';
        await update(db, row.id, {
          stage: settled ? 'mail' : 'purchase',
          state: settled ? 'pending' : 'waiting',
          detail: { ...row.detail, purchaseAttemptedAt: null, purchase },
        });
        return settled ? 'advanced' : 'stop';
      }
      if (execute && row.detail.purchaseAttemptedAt)
        // A pass stopped between sending the order and recording it: never send it again.
        return fail(db, row, 'A purchase was started but its result was not recorded.', {
          kind: 'purchase',
          text: `${row.name}: check the order for ${mine.domain} in Vercel by hand, record it, then press Retry (a purchase is never sent twice).`,
        });
      await update(db, row.id, {
        state: 'running',
        attempts: row.attempts + 1,
        detail: { ...row.detail, purchaseAttemptedAt: execute ? now.toISOString() : null },
      });
      let mismatch: string | null = null;
      const res = await deps.launch(
        { town: row.name, resume: true, pick: mine.pick, approveSpend: execute, until: 'names' },
        {
          // The admin approved this domain at this price; anything else is not bought.
          confirm: async (q) => {
            if (q.domain !== mine.domain)
              mismatch = `the domain is ${q.domain}, not ${mine.domain}`;
            else if (Math.round(q.price * 100) !== Math.round(mine.price * 100))
              mismatch = `${mine.domain} now costs $${q.price}, not the approved $${mine.price}`;
            return mismatch === null;
          },
        },
      );
      // The launch finished its purchase question one way or the other: nothing is in flight.
      const detail = { ...row.detail, purchaseAttemptedAt: null };
      await update(db, row.id, { detail });
      const after = { ...row, detail };
      const names = await namesDetail(db, res.launch.id);
      const purchase = names?.purchase;
      if (mismatch)
        return fail(db, after, `Nothing bought: ${mismatch}.`, {
          kind: 'purchase',
          text: `${row.name}: ${mismatch}. Nothing was bought; start a new cohort for it to approve the new price.`,
        });
      if (res.launch.status === 'failed' || !names?.picked)
        return fail(db, after, res.launch.stoppedReason ?? 'The names step did not finish.');
      if (!execute) {
        await update(db, row.id, {
          stage: 'mail',
          state: 'pending',
          detail: { ...detail, purchase: 'dry run: nothing bought' },
        });
        return 'advanced';
      }
      if (purchase && 'orderId' in purchase) {
        const settled = purchase.status === 'completed';
        await update(db, row.id, {
          stage: settled ? 'mail' : 'purchase',
          state: settled ? 'pending' : 'waiting',
          detail: { ...detail, purchase },
        });
        return settled ? 'advanced' : 'stop';
      }
      return fail(
        db,
        after,
        `Not bought: ${purchase && 'reason' in purchase ? purchase.reason : 'unknown'}.`,
      );
    }

    case 'mail': {
      const names = await namesDetail(db, row.launchId!);
      if (!names?.picked) return fail(db, row, 'The launch has no picked name.');
      await update(db, row.id, { state: 'running', attempts: row.attempts + 1 });
      const [town] = await db
        .select({ id: towns.id })
        .from(towns)
        .where(eq(towns.domain, names.picked.domain));
      // The batch approval covers this step: SES identities and DNS records for the bought domain.
      const report = await deps.onboard(
        { name: names.picked.domain, displayName: names.picked.siteName, townId: town?.id ?? null },
        { execute },
      );
      if (report.outcome === 'busy') {
        await update(db, row.id, { state: 'waiting' });
        return 'stop';
      }
      if (report.outcome === 'failed')
        return fail(
          db,
          row,
          report.error ?? 'Mail onboarding failed.',
          report.conflicts.length
            ? {
                kind: 'dns',
                text: `${names.picked.domain}: DNS conflict (${report.conflicts.map((c) => c.reason).join('; ')}). Nothing was overwritten: fix the records in Vercel, then press Retry.`,
              }
            : undefined,
        );
      await update(db, row.id, {
        stage: 'dns',
        state: 'pending',
        error: null,
        detail: { ...row.detail, mail: report.outcome },
      });
      return 'advanced';
    }

    case 'dns': {
      if (!execute) {
        await update(db, row.id, {
          stage: 'provision',
          state: 'pending',
          detail: { ...row.detail, dns: 'dry run' },
        });
        return 'advanced';
      }
      const names = await namesDetail(db, row.launchId!);
      const [domain] = await db
        .select({ status: mailDomains.status, reason: mailDomains.failureReason })
        .from(mailDomains)
        .where(eq(mailDomains.name, names!.picked!.domain));
      // The worker's 5-minute mail check verifies SES and starts the warm-up (Mail-1, Mail-5).
      if (domain?.status === 'live') {
        await update(db, row.id, { stage: 'provision', state: 'pending', error: null });
        return 'advanced';
      }
      if (domain?.status === 'failed')
        return fail(db, row, domain.reason ?? 'SES verification failed.');
      await update(db, row.id, { state: 'waiting' });
      return 'stop';
    }

    case 'provision': {
      await update(db, row.id, { state: 'running', attempts: row.attempts + 1 });
      // Sources, adapters, readiness, seeding, theme and logo prompts, the provisioning plan and
      // the launch report, through the same launch run.
      const res = await deps.launch({ town: row.name, resume: true, approveSpend: execute });
      if (res.launch.status !== 'ready')
        return fail(db, row, res.launch.stoppedReason ?? `The launch is ${res.launch.status}.`);
      await update(db, row.id, { stage: 'review', state: 'pending', error: null });
      return 'advanced';
    }

    case 'review': {
      const todos = await reviewTodos(db, row);
      const blockers = await goLiveBlockers(db, row.launchId!);
      if (!row.detail.frictionLogged) {
        logFriction(
          deps.frictionLog ?? DEFAULT_FRICTION_LOG,
          `${row.name} (cohort ${cohort.name})`,
          now.toISOString().slice(0, 10),
          todos.map((t) => t.text),
        );
      }
      await update(db, row.id, {
        state: 'waiting',
        todos,
        detail: { ...row.detail, blockers, frictionLogged: true },
      });
      return 'stop';
    }
  }
  return 'stop';
}

async function savePurchase(db: Db, launchId: string, purchase: Purchase) {
  const names = await namesDetail(db, launchId);
  if (!names) return;
  await db
    .update(launchStepRecords)
    .set({ detail: { ...names, purchase } })
    .where(and(eq(launchStepRecords.launchId, launchId), eq(launchStepRecords.step, 'names')));
}

/**
 * The town's manual to-dos for the cohort's one review pass: the launch report's, plus the ones
 * the system checks for itself (logo art imported, Facebook page set). Search Console stays a
 * to-do until a Google credential exists. Ticked boxes stay ticked.
 */
async function reviewTodos(db: Db, row: Row): Promise<CohortTown['todos']> {
  const [launch] = await db.select().from(launches).where(eq(launches.id, row.launchId!));
  const [report] = await db
    .select({ detail: launchStepRecords.detail })
    .from(launchStepRecords)
    .where(
      and(eq(launchStepRecords.launchId, row.launchId!), eq(launchStepRecords.step, 'report')),
    );
  const manual = ((report?.detail as { manual?: string[] } | null)?.manual ?? []).filter(
    // These three are tracked below, by checking the town itself.
    (t) => !/^Logo art|^Facebook page|Search Console/.test(t),
  );
  const [town] = await db.select().from(towns).where(eq(towns.slug, launch!.slug));
  const names = await namesDetail(db, row.launchId!);
  let facebook = false;
  let townFileOk = true;
  try {
    facebook = Boolean(
      names?.picked && parseTownConfig(readFileSync(names.picked.townFile, 'utf8')).facebook,
    );
  } catch {
    townFileOk = false;
  }
  const [art] = town
    ? await db
        .select({ id: identityArt.id })
        .from(identityArt)
        .where(eq(identityArt.townId, town.id))
    : [];
  const domain = town?.domain ?? names?.picked?.domain ?? '';
  const kindOf = (t: string) =>
    /^Trademark/.test(t)
      ? 'trademark'
      : /^Social handles/.test(t)
        ? 'social'
        : /guides/i.test(t)
          ? 'guides'
          : /masthead/i.test(t)
            ? 'masthead'
            : 'report';
  const previous = new Map(row.todos.map((t) => [t.key, t.done]));
  const list = [
    ...manual.map((text) => ({
      key: todoKey(kindOf(text), text),
      text,
      auto: null as boolean | null,
    })),
    {
      key: todoKey('logo', domain),
      text: `Logo art for ${domain}: make it in ChatGPT from logo-prompt.md, then pnpm identity import.`,
      auto: Boolean(art),
    },
    {
      key: todoKey('facebook', domain),
      text: `Facebook page for ${domain}, then facebook: in the town YAML${townFileOk ? '' : ' (the town file is not on this machine)'}.`,
      auto: facebook,
    },
    {
      key: todoKey('search-console', domain),
      text: `Search Console: verify ${domain} and submit its sitemap. Manual until a Google credential exists.`,
      auto: null,
    },
  ];
  return list.map(({ key, text, auto }) => ({
    key,
    text,
    done: auto ?? previous.get(key) ?? false,
  }));
}
