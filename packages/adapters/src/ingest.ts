import { createHash } from 'node:crypto';
import type { SourceKind } from '@towncore/config';
import { and, desc, eq, inArray, records, sourceRuns, sources, sql, type Db } from '@towncore/db';
import { FetchPolicyError, NotModified, type Fetcher } from './http/fetcher';
import { BROKEN_AFTER_FAILURES } from './schedule';
import type { RawRecord, SourceAdapter, SourceConfig } from './types';

// Ingest (CLAUDE.md §6 step 1): fetch new items, upsert records deduped by
// (source_id, external_id) + content hash, log the run, update source health.

export { BROKEN_AFTER_FAILURES };

type SourceRow = typeof sources.$inferSelect;
export type IngestResult = {
  status: 'ok' | 'failed';
  items: number;
  newItems: number;
  changedItems: number;
  error?: string;
};

export function contentHash(record: RawRecord): string {
  const canonical = JSON.stringify([
    record.type,
    record.title ?? null,
    record.text ?? null,
    record.url ?? null,
    record.occurredAt?.toISOString() ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export function toSourceConfig(row: SourceRow): SourceConfig {
  return {
    id: row.id,
    townId: row.townId,
    kind: row.kind as SourceKind,
    platform: row.platform,
    url: row.url,
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

export async function ingestSource(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
  fetcher: Fetcher,
  now: Date = new Date(),
): Promise<IngestResult> {
  const [run] = await db
    .insert(sourceRuns)
    .values({ sourceId: source.id, townId: source.townId, startedAt: now })
    .returning();

  try {
    let fetched: RawRecord[];
    let notModified = false;
    try {
      fetched = await adapter.fetch(toSourceConfig(source), source.lastOkAt, { fetcher, now });
    } catch (error) {
      if (!(error instanceof NotModified)) throw error;
      fetched = [];
      notModified = true;
    }
    const { newItems, changedItems } = await upsertRecords(db, source, fetched, now);
    const zeroWhenUsuallyFull =
      !notModified && fetched.length === 0 && (await usuallyHasItems(db, source.id));

    await db
      .update(sourceRuns)
      .set({ status: 'ok', finishedAt: new Date(), items: fetched.length, newItems, changedItems })
      .where(eq(sourceRuns.id, run!.id));
    await db
      .update(sources)
      .set({
        lastRunAt: now,
        lastOkAt: now,
        consecutiveFailures: 0,
        lastError: zeroWhenUsuallyFull ? 'Returned no items, though it usually has some' : null,
        health: zeroWhenUsuallyFull ? 'degraded' : 'ok',
      })
      .where(eq(sources.id, source.id));
    return { status: 'ok', items: fetched.length, newItems, changedItems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failures = source.consecutiveFailures + 1;
    // A robots.txt or never-scrape refusal won't fix itself: mark it broken right away. Broken
    // sources back off (schedule.ts `retryIntervalMs`): 6-24 h, or weekly for a refusal.
    const broken = error instanceof FetchPolicyError || failures >= BROKEN_AFTER_FAILURES;
    await db
      .update(sourceRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(sourceRuns.id, run!.id));
    await db
      .update(sources)
      .set({
        lastRunAt: now,
        consecutiveFailures: failures,
        lastError: message,
        health: broken ? 'broken' : 'degraded',
      })
      .where(eq(sources.id, source.id));
    return { status: 'failed', items: 0, newItems: 0, changedItems: 0, error: message };
  }
}

async function upsertRecords(db: Db, source: SourceRow, fetched: RawRecord[], now: Date) {
  // Duplicates within one fetch: keep the last occurrence of each external ID.
  const byId = new Map(fetched.map((r) => [r.externalId, r]));
  const items = [...byId.values()];
  if (items.length === 0) return { newItems: 0, changedItems: 0 };

  const existing = new Map<string, string>();
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((r) => r.externalId);
    const rows = await db
      .select({ externalId: records.externalId, contentHash: records.contentHash })
      .from(records)
      .where(and(eq(records.sourceId, source.id), inArray(records.externalId, chunk)));
    for (const row of rows) existing.set(row.externalId, row.contentHash);
  }

  let newItems = 0;
  let changedItems = 0;
  // An undated item is dated when first seen, except on the source's first run (the baseline).
  const firstSeen = source.lastOkAt ? now : null;
  await db.transaction(async (tx) => {
    for (const item of items) {
      const hash = contentHash(item);
      const previous = existing.get(item.externalId);
      if (previous === hash) continue;
      const values = {
        type: item.type,
        title: item.title ?? null,
        text: item.text ?? null,
        url: item.url ?? null,
        raw: item.raw as object,
        contentHash: hash,
      };
      if (previous === undefined) {
        await tx.insert(records).values({
          sourceId: source.id,
          townId: source.townId,
          externalId: item.externalId,
          ...values,
          occurredAt: item.datedOnSight ? firstSeen : (item.occurredAt ?? null),
        });
        newItems++;
      } else {
        await tx
          .update(records)
          .set({
            ...values,
            ...(item.datedOnSight ? {} : { occurredAt: item.occurredAt ?? null }),
            changedAt: now,
          })
          .where(and(eq(records.sourceId, source.id), eq(records.externalId, item.externalId)));
        changedItems++;
      }
    }
  });
  return { newItems, changedItems };
}

/** True when most of the last 5 successful runs returned items. */
async function usuallyHasItems(db: Db, sourceId: string): Promise<boolean> {
  const recent = await db
    .select({ items: sourceRuns.items })
    .from(sourceRuns)
    .where(and(eq(sourceRuns.sourceId, sourceId), eq(sourceRuns.status, 'ok')))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(5);
  return recent.length >= 3 && recent.filter((r) => r.items > 0).length >= 3;
}

/** Sources due for ingest, for towns that aren't paused. */
export async function listIngestableSources(db: Db): Promise<SourceRow[]> {
  return db
    .select()
    .from(sources)
    .where(sql`${sources.townId} in (select id from towns where status <> 'paused')`);
}
