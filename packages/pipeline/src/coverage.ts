import { readinessMinimum, type SourceKind } from '@towncore/config';
import {
  and,
  articles,
  eq,
  gte,
  inArray,
  ne,
  records,
  skippedCandidates,
  sources,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';

// Stories against the Rule 7 target (owner, 2026-10-17): per town, the real items published a
// day by the kind of source they came from, what the finder skipped and why, the gap to the
// target, and the source kinds the town doesn't have yet, in the order to build them.

export const COVERAGE_DAYS = 30;

/**
 * Source kinds that make stories, in the order the owner set for finding more (permits first).
 * Weather, reference pages and other outlets don't count toward the target.
 */
export const STORY_SOURCE_ORDER: SourceKind[] = [
  'permits',
  'police',
  'fire',
  'property_sales',
  'agenda',
  'schools',
  'sports',
  'business_filings',
  'inspections',
  'city_news',
  'events',
];

export type TownCoverage = {
  id: string;
  siteName: string;
  status: string;
  target: number;
  /** Real items published a day over the window (guides don't count). */
  perDay: number;
  gap: number;
  /** Items a day by the kind of each story's first source, most first. */
  bySource: Array<{ kind: string; perDay: number }>;
  /** Candidates the finder skipped in the window, by reason, most first. */
  skipped: Array<{ reason: string; count: number }>;
  /** The latest launch readiness measure, when one ran. */
  readiness: number | null;
  /** Story source kinds the town has no source for, in build order. */
  missing: SourceKind[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Every town that isn't paused, furthest behind its target first. */
export async function storyCoverage(db: Db, now = new Date()): Promise<TownCoverage[]> {
  const since = new Date(now.getTime() - COVERAGE_DAYS * 86_400_000);
  const out: TownCoverage[] = [];
  for (const town of await db.select().from(towns).where(ne(towns.status, 'paused'))) {
    const published = await db
      .select({ kind: sources.kind, n: sql<number>`count(distinct ${articles.id})::int` })
      .from(articles)
      .innerJoin(records, eq(records.id, sql`${articles.sourceRecordIds}[1]`))
      .innerJoin(sources, eq(sources.id, records.sourceId))
      .where(
        and(
          eq(articles.townId, town.id),
          inArray(articles.status, ['published', 'corrected']),
          ne(articles.kind, 'guide'),
          gte(articles.publishedAt, since),
        ),
      )
      .groupBy(sources.kind);
    const skipped = await db
      .select({ reason: skippedCandidates.reason, n: sql<number>`count(*)::int` })
      .from(skippedCandidates)
      .innerJoin(storyCandidates, eq(storyCandidates.id, skippedCandidates.candidateId))
      .where(and(eq(storyCandidates.townId, town.id), gte(skippedCandidates.createdAt, since)))
      .groupBy(skippedCandidates.reason);
    const have = new Set(
      (
        await db.select({ kind: sources.kind }).from(sources).where(eq(sources.townId, town.id))
      ).map((s) => s.kind),
    );
    const total = published.reduce((n, p) => n + p.n, 0);
    const perDay = round(total / COVERAGE_DAYS);
    const target = readinessMinimum[town.tier];
    out.push({
      id: town.id,
      siteName: town.siteName,
      status: town.status,
      target,
      perDay,
      gap: round(Math.max(0, target - perDay)),
      bySource: published
        .map((p) => ({ kind: p.kind, perDay: round(p.n / COVERAGE_DAYS) }))
        .sort((a, b) => b.perDay - a.perDay || a.kind.localeCompare(b.kind)),
      skipped: skipped
        .map((s) => ({ reason: s.reason, count: s.n }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      readiness: town.readinessScore,
      missing: STORY_SOURCE_ORDER.filter((k) => !have.has(k)),
    });
  }
  return out.sort((a, b) => b.gap - a.gap || a.siteName.localeCompare(b.siteName));
}
