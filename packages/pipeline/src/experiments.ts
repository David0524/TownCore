import {
  EXPERIMENTS,
  assignVariant,
  resolveVariant,
  type ExperimentKey,
  type ExperimentState,
} from '@towncore/config';
import {
  and,
  eq,
  experimentAssignments,
  experiments,
  logAdminAction,
  ne,
  towns,
  type Db,
  type StaffMember,
} from '@towncore/db';
import {
  addCounts,
  emptyCounts,
  funnelRates,
  type FunnelCounts,
  type TownAudience,
} from './audience';

// Experiments (owner, 2026-10-17; §11a-2 "layouts are experiments"): an admin starts one, every
// town (or cohort) gets a variant by a stable hash, recorded so it doesn't move as towns are
// added; Admin → Health compares the variants' numbers; the admin picks a winner, which then
// shows in every town. Never per reader. Every variant here changes copy, or swaps the first two
// homepage modules on phones only, so no winner can make neighbors share more than the neighbor
// rule allows (§11a-2): it never touches family, palette, header, grid, article template or the
// set of the first three modules.

export class ExperimentRefused extends Error {}

const isKey = (key: string): key is ExperimentKey => key in EXPERIMENTS;

function requireAdmin(staff: StaffMember) {
  if (staff.role !== 'admin') throw new ExperimentRefused('Only an admin can change experiments.');
}

/** Starts (or restarts) an experiment, recording each town's variant. */
export async function startExperiment(
  db: Db,
  input: { key: string; unit: 'town' | 'cohort'; staff: StaffMember },
  now = new Date(),
): Promise<{ assigned: number }> {
  requireAdmin(input.staff);
  if (!isKey(input.key)) throw new ExperimentRefused(`No experiment "${input.key}".`);
  const key = input.key;
  await db
    .insert(experiments)
    .values({
      key,
      status: 'running',
      unit: input.unit,
      winner: null,
      startedAt: now,
      endedAt: null,
      updatedBy: input.staff.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: experiments.key,
      set: {
        status: 'running',
        unit: input.unit,
        winner: null,
        startedAt: now,
        endedAt: null,
        updatedBy: input.staff.id,
        updatedAt: now,
      },
    });
  await db.delete(experimentAssignments).where(eq(experimentAssignments.experimentKey, key));
  const list = await db
    .select({ id: towns.id, cohort: towns.cohort })
    .from(towns)
    .where(ne(towns.status, 'paused'));
  if (list.length > 0)
    await db.insert(experimentAssignments).values(
      list.map((t) => ({
        experimentKey: key,
        townId: t.id,
        variant: assignVariant(
          key,
          input.unit === 'cohort' ? `cohort:${t.cohort ?? 'none'}` : t.id,
        ),
        assignedAt: now,
      })),
    );
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'experiment.start',
    target: { type: 'experiment', id: key },
    detail: { unit: input.unit, towns: list.length },
  });
  return { assigned: list.length };
}

/** Picks the winner: from now on every town shows it. */
export async function decideExperiment(
  db: Db,
  input: { key: string; winner: string; staff: StaffMember },
  now = new Date(),
) {
  requireAdmin(input.staff);
  if (!isKey(input.key)) throw new ExperimentRefused(`No experiment "${input.key}".`);
  if (!(EXPERIMENTS[input.key].variants as readonly string[]).includes(input.winner))
    throw new ExperimentRefused(`"${input.winner}" is not a variant of ${input.key}.`);
  const [row] = await db
    .update(experiments)
    .set({
      status: 'decided',
      winner: input.winner,
      endedAt: now,
      updatedBy: input.staff.id,
      updatedAt: now,
    })
    .where(and(eq(experiments.key, input.key), eq(experiments.status, 'running')))
    .returning();
  if (!row) throw new ExperimentRefused('Only a running experiment can be decided.');
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'experiment.decide',
    target: { type: 'experiment', id: input.key },
    detail: { winner: input.winner },
  });
  return row;
}

/** Stops an experiment: every town goes back to the control. */
export async function stopExperiment(
  db: Db,
  input: { key: string; staff: StaffMember },
  now = new Date(),
) {
  requireAdmin(input.staff);
  if (!isKey(input.key)) throw new ExperimentRefused(`No experiment "${input.key}".`);
  await db
    .update(experiments)
    .set({ status: 'off', winner: null, endedAt: now, updatedBy: input.staff.id, updatedAt: now })
    .where(eq(experiments.key, input.key));
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: 'experiment.stop',
    target: { type: 'experiment', id: input.key },
  });
}

export type ExperimentReport = {
  key: ExperimentKey;
  label: string;
  metric: string;
  state: ExperimentState & { startedAt: Date | null; endedAt: Date | null };
  variants: Array<{
    variant: string;
    towns: number;
    /** The experiment's own metric for this variant (see `variantMetric`). */
    value: number | null;
    counts: FunnelCounts;
  }>;
};

/** The number each experiment is judged on, from the variant's added-up counts. */
export function variantMetric(key: ExperimentKey, c: FunnelCounts): number | null {
  const perThousandViews = (n: number) => (c.views > 0 ? (n / c.views) * 1000 : null);
  switch (key) {
    case 'signup-prompt':
      return funnelRates(c).subscribersPer1k;
    case 'second-article-offer':
      return perThousandViews(c.signups['second-article'] + c.signups.article);
    case 'module-order':
      return perThousandViews(c.signups.home);
    case 'house-ad-copy':
      return c.towns > 0 ? c.trialStarts / c.towns : null;
    case 'proof-report-wording':
      return funnelRates(c).trialToPaid;
  }
}

/** Every experiment with its numbers per variant, from the towns' funnels. */
export async function experimentReports(
  db: Db,
  audience: readonly TownAudience[],
): Promise<ExperimentReport[]> {
  const rows = new Map((await db.select().from(experiments)).map((r) => [r.key, r]));
  const assigned = await db
    .select({
      key: experimentAssignments.experimentKey,
      townId: experimentAssignments.townId,
      variant: experimentAssignments.variant,
    })
    .from(experimentAssignments);
  const recorded = new Map(assigned.map((a) => [`${a.key}:${a.townId}`, a.variant]));
  return (Object.keys(EXPERIMENTS) as ExperimentKey[]).map((key) => {
    const row = rows.get(key);
    const state: ExperimentState = row
      ? { status: row.status, unit: row.unit, winner: row.winner }
      : { status: 'off', unit: 'town', winner: null };
    const byVariant = new Map<string, { towns: number; counts: FunnelCounts }>(
      EXPERIMENTS[key].variants.map((v) => [v, { towns: 0, counts: emptyCounts() }]),
    );
    if (state.status === 'running')
      for (const town of audience) {
        const variant = resolveVariant(key, state, town, recorded.get(`${key}:${town.id}`));
        const entry = byVariant.get(variant)!;
        entry.towns += 1;
        entry.counts = addCounts(entry.counts, town.counts);
      }
    return {
      key,
      label: EXPERIMENTS[key].label,
      metric: EXPERIMENTS[key].metric,
      state: { ...state, startedAt: row?.startedAt ?? null, endedAt: row?.endedAt ?? null },
      variants: [...byVariant].map(([variant, v]) => ({
        variant,
        towns: v.towns,
        value: state.status === 'running' ? variantMetric(key, v.counts) : null,
        counts: v.counts,
      })),
    };
  });
}
