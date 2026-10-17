import type { TownSourceConfig } from '@towncore/config';
import {
  agentRuns,
  and,
  desc,
  eq,
  logAdminAction,
  sourceKey,
  sourceProposals,
  sources,
  sql,
  towns,
  type Db,
} from '@towncore/db';

// Source proposals, the admin side (owner, 2026-10-17; docs/plans/agentic-ops.md). The weekly
// discovery agent (discovery-agent.ts) finds and verifies sources for towns below the Rule 7
// target; staff approve or reject each in one click. Approving adds the source to the town in the
// database, so ingest starts on the next tick, and leaves it marked for `pnpm sources:export`,
// which writes it into the town YAML for a pull request (config files stay the record).
// Imported by the web app: keep this module free of heavy dependencies.

export class ProposalRefused extends Error {}

type Staff = { id: string; role: 'admin' | 'reviewer' };

export type SourceProposal = typeof sourceProposals.$inferSelect & { siteName: string };

export async function listSourceProposals(
  db: Db,
  opts: { status?: SourceProposal['status']; limit?: number } = {},
): Promise<SourceProposal[]> {
  const rows = await db
    .select({ p: sourceProposals, siteName: towns.siteName })
    .from(sourceProposals)
    .innerJoin(towns, eq(towns.id, sourceProposals.townId))
    .where(opts.status ? eq(sourceProposals.status, opts.status) : undefined)
    .orderBy(desc(sourceProposals.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({ ...r.p, siteName: r.siteName }));
}

/** The source row a town's YAML entry becomes (the same shape `towns:sync` writes). */
export function sourceRow(townId: string, timezone: string, source: TownSourceConfig) {
  return {
    townId,
    key: sourceKey(source),
    kind: source.kind,
    platform: source.platform,
    adapter: source.platform,
    url: source.url ?? null,
    schedule: source.schedule ?? null,
    config: {
      timezone,
      ...(source.zone ? { zone: source.zone } : {}),
      ...(source.point ? { point: source.point } : {}),
      ...(source.options ?? {}),
    },
  };
}

/**
 * Approve: a `source` proposal joins the town's sources at once (ingest picks it up) and waits
 * for `pnpm sources:export`; an `adapter` proposal becomes a build request for a Claude Code
 * session. Reject keeps it on record so discovery never proposes it again. Audited.
 */
export async function decideSourceProposal(
  db: Db,
  input: { id: string; staff: Staff; decision: 'approve' | 'reject' },
  now = new Date(),
): Promise<SourceProposal> {
  const [row] = await db
    .select({ p: sourceProposals, siteName: towns.siteName, timezone: towns.timezone })
    .from(sourceProposals)
    .innerJoin(towns, eq(towns.id, sourceProposals.townId))
    .where(eq(sourceProposals.id, input.id));
  if (!row) throw new ProposalRefused('That proposal is unknown.');
  if (row.p.status !== 'proposed') throw new ProposalRefused(`It was already ${row.p.status}.`);
  let sourceId: string | null = null;
  if (input.decision === 'approve' && row.p.type === 'source') {
    const config = row.p.config as TownSourceConfig;
    const values = sourceRow(row.p.townId, row.timezone, config);
    await db.insert(sources).values(values).onConflictDoNothing();
    const [source] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.townId, row.p.townId), eq(sources.key, values.key)));
    sourceId = source?.id ?? null;
  }
  const [updated] = await db
    .update(sourceProposals)
    .set({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: input.staff.id,
      decidedAt: now,
      sourceId,
    })
    .where(and(eq(sourceProposals.id, input.id), eq(sourceProposals.status, 'proposed')))
    .returning();
  if (!updated) throw new ProposalRefused('It changed while deciding; reload.');
  await logAdminAction(db, {
    staffId: input.staff.id,
    action: `source_proposal.${input.decision}`,
    target: { type: 'source_proposal', id: updated.id },
    detail: { town: row.siteName, kind: updated.kind, url: updated.url, type: updated.type },
  });
  return { ...updated, siteName: row.siteName };
}

export type DiscoveryProgress = {
  lastRunAt: Date | null;
  proposed: number;
  approved: number;
  /** Estimated items a day from approved sources not yet showing in published stories. */
  approvedPerDay: number;
};

/** Per town: when discovery last ran and what it found, for Admin → Health. */
export async function discoveryProgress(db: Db): Promise<Map<string, DiscoveryProgress>> {
  const runs = await db
    .select({ townId: agentRuns.townId, last: sql<Date>`max(${agentRuns.startedAt})` })
    .from(agentRuns)
    .where(eq(agentRuns.agent, 'source-discovery'))
    .groupBy(agentRuns.townId);
  const counts = await db
    .select({
      townId: sourceProposals.townId,
      status: sourceProposals.status,
      n: sql<number>`count(*)::int`,
      perDay: sql<number>`coalesce(sum(${sourceProposals.estimatePerDay}), 0)::float`,
    })
    .from(sourceProposals)
    .groupBy(sourceProposals.townId, sourceProposals.status);
  const out = new Map<string, DiscoveryProgress>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { lastRunAt: null, proposed: 0, approved: 0, approvedPerDay: 0 });
    return out.get(id)!;
  };
  for (const r of runs) if (r.townId) get(r.townId).lastRunAt = new Date(r.last);
  for (const c of counts) {
    const p = get(c.townId);
    if (c.status === 'proposed') p.proposed = c.n;
    if (c.status === 'approved') {
      p.approved = c.n;
      p.approvedPerDay = Math.round(c.perDay * 10) / 10;
    }
  }
  return out;
}

/** "+0.6 items a day", or the reason there is no estimate. */
export function estimateLabel(p: { estimatePerDay: number | null; estimateBasis: string }) {
  return p.estimatePerDay === null
    ? p.estimateBasis
    : `+${p.estimatePerDay.toFixed(1)} items a day (${p.estimateBasis})`;
}
