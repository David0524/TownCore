import { adminActions, and, eq, mailDomains, sql, staff, subscribers, type Db } from '@towncore/db';
import { parseAddress } from '../address';
import type { Actor } from '../outbound/send';
import { CampaignError } from './campaigns';
import { setNetworkBulkPause } from './health';

// Staff controls for bulk mail (brief §7.2, Phase 5): lifting an auto-pause, and importing a
// list with documented consent. Each is audited.

async function requireAdmin(db: Db, actor: Actor) {
  const [who] = await db.select().from(staff).where(eq(staff.id, actor.id));
  if (who?.role !== 'admin' || !who.active) throw new CampaignError('Only an admin can do this.');
  return who;
}

/** Lifts a domain's bulk pause: back to warming, or active if the ramp had finished. */
export async function unpauseDomainBulk(db: Db, actor: Actor, domainId: string): Promise<void> {
  await requireAdmin(db, actor);
  const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
  if (!d || d.bulkStatus !== 'paused')
    throw new CampaignError('Bulk mail isn’t paused for this domain.');
  const status = d.bulkDailyCap >= d.bulkTargetCap ? 'active' : 'warming';
  await db
    .update(mailDomains)
    .set({ bulkStatus: status, pausedReason: null, warmupBreaches: 0 })
    .where(eq(mailDomains.id, domainId));
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: 'bulk_unpause',
    targetType: 'mail_domain',
    targetId: domainId,
    detail: { was: d.pausedReason, now: status },
  });
}

export async function resumeNetworkBulk(db: Db, actor: Actor): Promise<void> {
  await requireAdmin(db, actor);
  await setNetworkBulkPause(db, null);
  await db.insert(adminActions).values({ staffId: actor.id, action: 'bulk_network_resume' });
}

export type ImportPlan = {
  add: string[];
  existing: string[];
  invalid: string[];
};

/** Reads one address per line (or a CSV whose first column, or "email" column, holds it). */
export function parseImportList(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0]!
    .toLowerCase()
    .split(',')
    .map((h) => h.trim().replace(/^"|"$/g, ''));
  const col = header.includes('email') ? header.indexOf('email') : -1;
  const rows = col >= 0 ? lines.slice(1) : lines;
  return rows.map((l) => (l.split(',')[Math.max(col, 0)] ?? '').trim().replace(/^"|"$/g, ''));
}

export async function planImport(db: Db, townId: string, raw: string[]): Promise<ImportPlan> {
  const plan: ImportPlan = { add: [], existing: [], invalid: [] };
  const seen = new Set<string>();
  for (const r of raw) {
    const parsed = parseAddress(r);
    if (!parsed) {
      plan.invalid.push(r);
      continue;
    }
    if (seen.has(parsed.address)) continue;
    seen.add(parsed.address);
    const [hit] = await db
      .select({ id: subscribers.id })
      .from(subscribers)
      .where(
        and(eq(subscribers.townId, townId), sql`lower(${subscribers.email}) = ${parsed.address}`),
      );
    (hit ? plan.existing : plan.add).push(parsed.address);
  }
  return plan;
}

/**
 * Imports with documented consent (brief §7.3: the owner approves every import). Only an
 * active admin can approve; existing subscribers are never changed.
 */
export async function applyImport(
  db: Db,
  input: { townId: string; plan: ImportPlan; consentSource: string; approvedByEmail: string },
): Promise<number> {
  if (input.consentSource.trim().length < 10)
    throw new CampaignError(
      'Describe the consent: where and how these people asked for the newsletter.',
    );
  const [who] = await db
    .select()
    .from(staff)
    .where(sql`lower(${staff.email}) = ${input.approvedByEmail.toLowerCase()}`);
  if (who?.role !== 'admin' || !who.active)
    throw new CampaignError(
      `${input.approvedByEmail} isn’t an active admin, so it can’t approve an import.`,
    );
  const now = new Date();
  let added = 0;
  for (const email of input.plan.add) {
    const rows = await db
      .insert(subscribers)
      .values({
        townId: input.townId,
        email,
        status: 'active',
        source: 'import',
        consentSource: input.consentSource.trim(),
        consentAt: now,
        confirmedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: subscribers.id });
    added += rows.length;
  }
  await db.insert(adminActions).values({
    staffId: who.id,
    action: 'subscriber_import',
    targetType: 'town',
    targetId: input.townId,
    detail: {
      added,
      consentSource: input.consentSource.trim(),
      skipped: input.plan.existing.length,
    },
  });
  return added;
}
