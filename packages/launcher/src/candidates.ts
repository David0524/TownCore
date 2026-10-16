import { and, asc, eq, logAdminAction, sql, townCandidates, type Db } from '@towncore/db';

// Admin → Launches → Candidates (CLAUDE.md §10a: "Never launch a town without a human approving
// it from the ranked list"). Only admins decide; every decision is audited.

export type Candidate = typeof townCandidates.$inferSelect;

export async function listCandidates(
  db: Db,
  opts: { state?: string; status?: Candidate['status']; limit?: number } = {},
): Promise<Candidate[]> {
  return db
    .select()
    .from(townCandidates)
    .where(
      and(
        opts.state ? eq(townCandidates.state, opts.state.toUpperCase()) : undefined,
        opts.status ? eq(townCandidates.status, opts.status) : undefined,
      ),
    )
    .orderBy(asc(townCandidates.state), asc(townCandidates.rank))
    .limit(opts.limit ?? 50);
}

export async function candidateStates(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ state: townCandidates.state })
    .from(townCandidates)
    .orderBy(asc(townCandidates.state));
  return rows.map((r) => r.state);
}

export class CandidateDecisionError extends Error {}

export async function decideCandidate(
  db: Db,
  input: {
    candidateId: string;
    staff: { id: string; role: 'admin' | 'reviewer' };
    decision: 'approve' | 'reject' | 'reopen';
    note?: string;
  },
  now = new Date(),
): Promise<Candidate> {
  if (input.staff.role !== 'admin')
    throw new CandidateDecisionError('Only an admin can approve or reject a town.');
  const status =
    input.decision === 'approve'
      ? 'approved'
      : input.decision === 'reject'
        ? 'rejected'
        : 'proposed';
  const note = input.note?.trim().slice(0, 500) || null;
  // A town that is already live keeps that status; decisions only move between the other three.
  const [row] = await db
    .update(townCandidates)
    .set({
      status,
      decidedBy: input.decision === 'reopen' ? null : input.staff.id,
      decidedAt: input.decision === 'reopen' ? null : now,
      note,
    })
    .where(and(eq(townCandidates.id, input.candidateId), sql`${townCandidates.status} <> 'live'`))
    .returning();
  if (!row) throw new CandidateDecisionError('That town is unknown or already live.');
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: `launch.candidate.${input.decision}`,
    target: { type: 'town_candidate', id: row.id },
    detail: { geoid: row.geoid, name: row.name, state: row.state, note },
  });
  return row;
}
