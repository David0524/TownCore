import { findTbdFields, readinessMinimum } from '@towncore/config';
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
// domain is live (Rule 10: the purchase and the mail onboarding were approved separately).
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
  if ((town.readinessScore ?? 0) < readinessMinimum[town.tier])
    blockers.push(
      `Readiness ${town.readinessScore ?? 0} a day is below ${readinessMinimum[town.tier]} (Rule 7).`,
    );
  const [mail] = await db.select().from(mailDomains).where(eq(mailDomains.name, town.domain));
  if (mail?.status !== 'live')
    blockers.push(
      `The mail domain ${town.domain} is ${mail?.status ?? 'not onboarded'}, not live (pnpm mail:onboard; Rule 10).`,
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
    .set({ status: 'live', updatedAt: now })
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
