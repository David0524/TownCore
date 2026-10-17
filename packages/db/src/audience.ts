import {
  EXPERIMENTS,
  resolveVariant,
  type ExperimentKey,
  type ExperimentState,
  type ExperimentVariant,
  type ReferralSource,
} from '@towncore/config';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { experimentAssignments, experiments, referralStatsDaily } from './schema';

// Audience counters and experiment reads (owner, 2026-10-17). Aggregate only: no reader ids.

/** Adds one article view to a town's daily count for its referral class. */
export async function countReferral(
  db: Db,
  townId: string,
  day: string,
  source: ReferralSource,
): Promise<void> {
  await db
    .insert(referralStatsDaily)
    .values({ townId, day, source, views: 1 })
    .onConflictDoUpdate({
      target: [referralStatsDaily.townId, referralStatsDaily.day, referralStatsDaily.source],
      set: { views: sql`${referralStatsDaily.views} + 1` },
    });
}

/** Every experiment's recorded state, keyed by experiment (missing ones are off). */
export async function experimentStates(db: Db): Promise<Map<string, ExperimentState>> {
  const rows = await db.select().from(experiments);
  return new Map(
    rows.map((r) => [r.key, { status: r.status, unit: r.unit, winner: r.winner }] as const),
  );
}

/** The variant a town shows in one experiment (control when off, winner when decided). */
export async function townVariant<K extends ExperimentKey>(
  db: Db,
  key: K,
  town: { id: string; cohort: string | null },
): Promise<ExperimentVariant<K>> {
  const [state] = await db.select().from(experiments).where(eq(experiments.key, key));
  if (!state || state.status !== 'running') return resolveVariant(key, state ?? null, town);
  const [recorded] = await db
    .select({ variant: experimentAssignments.variant })
    .from(experimentAssignments)
    .where(
      and(eq(experimentAssignments.experimentKey, key), eq(experimentAssignments.townId, town.id)),
    );
  return resolveVariant(key, state, town, recorded?.variant ?? null);
}

export const experimentKeys = Object.keys(EXPERIMENTS) as ExperimentKey[];
