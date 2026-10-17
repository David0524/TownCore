import { findTbdFields } from '@towncore/config';
import {
  and,
  desc,
  eq,
  launches,
  launchStepRecords,
  logAdminAction,
  mailDomains,
  townCandidates,
  towns,
  type Db,
} from '@towncore/db';

// Admin → Launches → go live (CLAUDE.md §10 step 9; docs/plans/M7.md §7). Only an admin approves,
// and only a launch whose every automated check passed, whose domain we bought, and whose mail
// domain is live (Rule 10: buying the domain also approved its mail onboarding, step 2b, which
// started warm-up the moment we owned it).
// Approving sets the town live; schedules already run for drafts, so live changes indexing,
// sitemaps and publishing. Pause takes a live town back to paused. Every decision is audited.
// Imported by the web app: keep this module free of heavy dependencies.

export class GoLiveRefused extends Error {}

type Staff = { id: string; role: 'admin' | 'reviewer' };

export type LaunchRow = {
  id: string;
  name: string;
  state: string;
  slug: string;
  status: string;
  dryRun: boolean;
  stoppedReason: string | null;
  createdAt: Date;
  steps: Array<{ step: string; status: string; error: string | null }>;
  report: {
    passed: boolean;
    report: string;
    checks: Array<{ name: string; status: string; detail: string }>;
  } | null;
  town: { id: string; status: string; domain: string; siteName: string } | null;
  /** The mail domain as it stands now: onboarding, verification and warm-up (step 2b). */
  mail: {
    status: string;
    bulkStatus: string;
    warmupDay: number;
    bulkDailyCap: number;
    failureReason: string | null;
  } | null;
  /** What step 2b recorded (planned, waiting, live, not started, failed) and why. */
  mailStep: { state: string; detail: string; startBy: string | null } | null;
};

export async function listLaunches(db: Db, limit = 25): Promise<LaunchRow[]> {
  const rows = await db.select().from(launches).orderBy(desc(launches.createdAt)).limit(limit);
  const out: LaunchRow[] = [];
  for (const l of rows) {
    const steps = await db
      .select({
        step: launchStepRecords.step,
        status: launchStepRecords.status,
        error: launchStepRecords.error,
        detail: launchStepRecords.detail,
      })
      .from(launchStepRecords)
      .where(eq(launchStepRecords.launchId, l.id));
    const [town] = await db
      .select({
        id: towns.id,
        status: towns.status,
        domain: towns.domain,
        siteName: towns.siteName,
      })
      .from(towns)
      .where(eq(towns.slug, l.slug));
    const report = steps.find((s) => s.step === 'report' && s.status === 'done')
      ?.detail as LaunchRow['report'];
    const mailStep = steps.find((s) => s.step === 'mail')?.detail as
      { state: string; detail: string; startBy: string | null; domain: string } | undefined;
    const domain = town?.domain ?? mailStep?.domain;
    const [mail] = domain
      ? await db
          .select({
            status: mailDomains.status,
            bulkStatus: mailDomains.bulkStatus,
            warmupDay: mailDomains.warmupDay,
            bulkDailyCap: mailDomains.bulkDailyCap,
            failureReason: mailDomains.failureReason,
          })
          .from(mailDomains)
          .where(eq(mailDomains.name, domain.toLowerCase()))
      : [];
    out.push({
      id: l.id,
      name: l.name,
      state: l.state,
      slug: l.slug,
      status: l.status,
      dryRun: l.dryRun,
      stoppedReason: l.stoppedReason,
      createdAt: l.createdAt,
      steps: steps.map(({ step, status, error }) => ({ step, status, error })),
      report: report ?? null,
      town: town ?? null,
      mail: mail ?? null,
      mailStep: mailStep?.state
        ? { state: mailStep.state, detail: mailStep.detail, startBy: mailStep.startBy }
        : null,
    });
  }
  return out;
}

/** Why a launch can't go live yet; empty when it can. */
export async function goLiveBlockers(db: Db, launchId: string): Promise<string[]> {
  const [launch] = await db.select().from(launches).where(eq(launches.id, launchId));
  if (!launch) return ['That launch is unknown.'];
  const blockers: string[] = [];
  if (launch.status !== 'ready')
    blockers.push(`The launch is ${launch.status}, not ready: every step must finish.`);
  const steps = await db
    .select()
    .from(launchStepRecords)
    .where(eq(launchStepRecords.launchId, launchId));
  const report = steps.find((s) => s.step === 'report' && s.status === 'done')?.detail as
    { passed?: boolean } | undefined;
  if (!report?.passed) blockers.push('The launch report has checks that are not passing.');
  const names = steps.find((s) => s.step === 'names')?.detail as
    { purchase?: { status?: string; orderId?: string } } | undefined;
  if (!(names?.purchase?.orderId && names.purchase.status === 'completed'))
    blockers.push('The domain has not been bought (run the launch with --approve-spend; Rule 10).');
  const [town] = await db.select().from(towns).where(eq(towns.slug, launch.slug));
  if (!town) return [...blockers, 'The draft town is not in the database.'];
  if (town.status !== 'draft') blockers.push(`The town is already ${town.status}.`);
  const tbd = findTbdFields(town.config);
  if (tbd.length) blockers.push(`The town config still has TBD fields: ${tbd.join(', ')}.`);
  // Rule 7 is a target (owner, 2026-10-17): readiness must have been measured, not met.
  if (town.readinessScore === null) blockers.push('Readiness has not been measured.');
  const [mail] = await db.select().from(mailDomains).where(eq(mailDomains.name, town.domain));
  if (mail?.status !== 'live')
    blockers.push(
      `The mail domain ${town.domain} is ${mail?.status ?? 'not onboarded'}, not live (step 2b onboards it after the purchase; catch up with pnpm mail:onboard bought --execute).`,
    );
  return blockers;
}

export async function approveLaunch(
  db: Db,
  input: { launchId: string; staff: Staff },
  now = new Date(),
) {
  if (input.staff.role !== 'admin') throw new GoLiveRefused('Only an admin can approve a launch.');
  const blockers = await goLiveBlockers(db, input.launchId);
  if (blockers.length) throw new GoLiveRefused(blockers.join(' '));
  const [launch] = await db.select().from(launches).where(eq(launches.id, input.launchId));
  const [town] = await db
    .update(towns)
    // The cohort is the month it goes live (for cohort rollout and the search kill switch).
    .set({ status: 'live', cohort: now.toISOString().slice(0, 7), updatedAt: now })
    .where(and(eq(towns.slug, launch!.slug), eq(towns.status, 'draft')))
    .returning();
  if (!town) throw new GoLiveRefused('The town changed while approving; reload and try again.');
  await db
    .update(launches)
    .set({ status: 'approved', updatedAt: now })
    .where(eq(launches.id, launch!.id));
  if (launch!.candidateId)
    await db
      .update(townCandidates)
      .set({ status: 'live' })
      .where(eq(townCandidates.id, launch!.candidateId));
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'launch.approve',
    target: { type: 'town', id: town.id },
    detail: { launchId: launch!.id, slug: town.slug, domain: town.domain },
  });
  return town;
}

export async function setTownPaused(
  db: Db,
  input: { townId: string; staff: Staff; paused: boolean },
  now = new Date(),
) {
  if (input.staff.role !== 'admin')
    throw new GoLiveRefused('Only an admin can pause or resume a town.');
  const [town] = await db
    .update(towns)
    .set({ status: input.paused ? 'paused' : 'live', updatedAt: now })
    .where(and(eq(towns.id, input.townId), eq(towns.status, input.paused ? 'live' : 'paused')))
    .returning();
  if (!town)
    throw new GoLiveRefused(
      input.paused ? 'Only a live town can be paused.' : 'Only a paused town can be resumed.',
    );
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: input.paused ? 'town.pause' : 'town.resume',
    target: { type: 'town', id: town.id },
    detail: { slug: town.slug },
  });
  return town;
}

/**
 * The search kill switch (owner, 2026-10-17): hide one town, or every town in a launch cohort,
 * from search engines, or show it again. Readers still reach the sites; hidden towns are noindex
 * on every page and list nothing in their sitemaps. Admin only; audited per town with the reason.
 */
export async function setSearchHidden(
  db: Db,
  input: { staff: Staff; hidden: boolean; reason: string } & (
    { townId: string; cohort?: undefined } | { cohort: string; townId?: undefined }
  ),
  now = new Date(),
) {
  if (input.staff.role !== 'admin')
    throw new GoLiveRefused('Only an admin can hide a town from search or show it again.');
  if (!input.reason.trim()) throw new GoLiveRefused('Say why, for the audit log.');
  const changed = await db
    .update(towns)
    .set({ searchHidden: input.hidden, updatedAt: now })
    .where(
      and(
        input.townId ? eq(towns.id, input.townId) : eq(towns.cohort, input.cohort!),
        eq(towns.searchHidden, !input.hidden),
      ),
    )
    .returning();
  if (!changed.length)
    throw new GoLiveRefused(
      input.townId
        ? `That town is already ${input.hidden ? 'hidden from' : 'shown in'} search.`
        : `No town in cohort ${input.cohort} is ${input.hidden ? 'shown in' : 'hidden from'} search.`,
    );
  for (const town of changed)
    await logAdminAction(db, {
      staffId: input.staff.id,
      action: input.hidden ? 'town.search_hide' : 'town.search_show',
      target: { type: 'town', id: town.id },
      detail: { slug: town.slug, cohort: town.cohort, reason: input.reason.trim() },
    });
  return changed;
}
