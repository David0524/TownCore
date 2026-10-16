import {
  defaultScoreThreshold,
  publicSafetyShare,
  storyBudgetFor,
  type SourceKind,
  type TownConfig,
} from '@towncore/config';
import {
  and,
  articles,
  articleScores,
  eq,
  gte,
  inArray,
  lt,
  records,
  skippedCandidates,
  sources,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { classifyV1, type Classification } from '@towncore/prompts';
import {
  createChangedRecordUpdates,
  matchPublished,
  mentionsDroppedCharges,
  recentPublished,
} from './followups';
import { callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import { MIN_SOURCE_CHARS, scoreCandidate, titleSimilarity } from './scoring';
import { createGuideCandidates } from './guides';
import { isIssuedLicense, isNewsworthyAlert } from './templates';
import { cannotBeArticle, decideTier } from './tiers';
import { isoLocalDate, localDate, localWeekStart, startOfLocalDay } from './time';

// Story finder (CLAUDE.md §6 step 2, §6a). Runs every 30 minutes per town:
//   1. templated items: weekly roundups and weather alerts, built in code (no model);
//   2. story candidates: one per new source item, classified, tiered and scored;
//   3. the daily budget: write the best candidates above the threshold, skip the rest with a
//      logged reason.
// Accepted candidates are picked up by the writer job.

/**
 * Record types written up as individual stories: the town's releases, and meeting results
 * (minutes, or the clerk's recorded actions), which become recaps (§6a). Agendas and meeting
 * notices are not stories on their own; the weekly meetings roundup covers them (D-M3-6).
 */
const STORY_TYPES = ['release', 'minutes', 'meeting-actions'];
/** Record types that point elsewhere and carry no text of their own. */
const LINK_TYPES = ['release-link'];
/** How far back the finder looks for unprocessed records. */
const LOOKBACK_DAYS = 7;
/** Headlines this similar to recent coverage count as duplicates. */
const DUPLICATE_SIMILARITY = 0.6;

type SkipReason = (typeof skippedCandidates.$inferInsert)['reason'];

export type FinderReport = {
  roundups: string[];
  templates: number;
  /** Follow-up notes queued for published stories. */
  updates: number;
  candidates: number;
  accepted: number;
  skipped: Partial<Record<SkipReason, number>>;
  dropped: number;
  /** Candidates left pending (no model configured, or the town hit its daily AI cap). */
  pending: number;
  capReached: boolean;
  /** Guide candidates queued: new topics, or topics whose pages changed. */
  guides: number;
};

export async function runStoryFinder(
  db: Db,
  townId: string,
  opts: { llm?: Llm; now?: Date } = {},
): Promise<FinderReport> {
  const now = opts.now ?? new Date();
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);
  const config = town.config as TownConfig;
  const report: FinderReport = {
    roundups: [],
    templates: 0,
    updates: 0,
    candidates: 0,
    accepted: 0,
    skipped: {},
    dropped: 0,
    pending: 0,
    capReached: false,
    guides: 0,
  };

  await createRoundups(db, town, now, report);
  await createAlertItems(db, town, now, report);
  report.updates += await createChangedRecordUpdates(db, town.id, now);
  await createStoryCandidates(db, town, config, now, report, opts.llm);
  await applyBudget(db, town, config, now, report);
  // Evergreen guides are their own job, outside the story budget (§6 step 2).
  report.guides = await createGuideCandidates(db, town, now);
  return report;
}

type TownRow = typeof towns.$inferSelect;

async function insertCandidate(
  db: Db,
  values: typeof storyCandidates.$inferInsert,
): Promise<string | null> {
  const [row] = await db
    .insert(storyCandidates)
    .values(values)
    .onConflictDoNothing({ target: [storyCandidates.townId, storyCandidates.key] })
    .returning({ id: storyCandidates.id });
  return row?.id ?? null;
}

async function skip(
  db: Db,
  report: FinderReport,
  candidateId: string,
  reason: SkipReason,
  detail: string,
  status: 'skipped' | 'dropped' = 'skipped',
) {
  await db.update(storyCandidates).set({ status }).where(eq(storyCandidates.id, candidateId));
  await db
    .insert(skippedCandidates)
    .values({ candidateId, reason, detail })
    .onConflictDoNothing({ target: skippedCandidates.candidateId });
  if (status === 'dropped') report.dropped++;
  else report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Templated items

/** A UTC-midnight range covering the local calendar week, for date-only record fields. */
function dateOnlyWeek(weekStart: Date, timeZone: string): [Date, Date] {
  const [y, m, d] = isoLocalDate(weekStart, timeZone).split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d!));
  return [start, new Date(start.getTime() + 7 * 86_400_000)];
}

async function townRecords(
  db: Db,
  townId: string,
  type: string,
  from: Date,
  to: Date,
): Promise<(typeof records.$inferSelect)[]> {
  return db
    .select()
    .from(records)
    .where(
      and(
        eq(records.townId, townId),
        eq(records.type, type),
        gte(records.occurredAt, from),
        lt(records.occurredAt, to),
      ),
    );
}

async function createRoundups(db: Db, town: TownRow, now: Date, report: FinderReport) {
  const tz = town.timezone;
  const weekday = localDate(now, tz).weekday; // 0 = Sunday

  // Meetings this week (D-M3-6): on the weekend for the coming week; Monday to Wednesday for
  // the current week if it wasn't done yet (e.g. a town's first run).
  const meetingWeek =
    weekday === 0 || weekday === 6
      ? localWeekStart(now, tz, 1)
      : weekday <= 3
        ? localWeekStart(now, tz)
        : null;
  if (meetingWeek) {
    const weekEnd = new Date(meetingWeek.getTime() + 7 * 86_400_000);
    const from = now > meetingWeek ? now : meetingWeek;
    const meetings = await townRecords(db, town.id, 'meeting', from, weekEnd);
    await roundup(db, town, report, {
      key: `roundup:meetings:${isoLocalDate(meetingWeek, tz)}`,
      title: `Meetings, week of ${isoLocalDate(meetingWeek, tz)}`,
      beat: 'government',
      recordIds: meetings.map((r) => r.id),
      now,
    });
  }

  // Last week's new business filings and contractor licenses, from Tuesday on, so the state's
  // files for the whole week are in. Both use date-only fields stored as UTC midnight.
  if (weekday === 0 || weekday >= 2) {
    const lastWeek = localWeekStart(now, tz, -1);
    const [from, to] = dateOnlyWeek(lastWeek, tz);
    const week = isoLocalDate(lastWeek, tz);
    const filings = await townRecords(db, town.id, 'new-filing', from, to);
    await roundup(db, town, report, {
      key: `roundup:new-businesses:${week}`,
      title: `New businesses, week of ${week}`,
      beat: 'business',
      recordIds: filings.map((r) => r.id),
      now,
    });
    const licenses = (await townRecords(db, town.id, 'license', from, to)).filter((r) =>
      isIssuedLicense(r.raw),
    );
    await roundup(db, town, report, {
      key: `roundup:new-licenses:${week}`,
      title: `New contractor licenses, week of ${week}`,
      beat: 'business',
      recordIds: licenses.map((r) => r.id),
      now,
    });
  }
}

async function roundup(
  db: Db,
  town: TownRow,
  report: FinderReport,
  item: { key: string; title: string; beat: string; recordIds: string[]; now: Date },
) {
  if (item.recordIds.length === 0) return;
  const id = await insertCandidate(db, {
    townId: town.id,
    kind: 'roundup',
    key: item.key,
    title: item.title,
    beat: item.beat,
    recordIds: item.recordIds,
    proposedTier: 1,
    tierReasons: ['roundup built in code from public records'],
    status: 'accepted',
    acceptedAt: item.now,
  });
  if (id) report.roundups.push(item.key);
}

async function createAlertItems(db: Db, town: TownRow, now: Date, report: FinderReport) {
  const since = new Date(now.getTime() - 2 * 86_400_000);
  const alerts = await townRecords(db, town.id, 'alert', since, new Date(now.getTime() + 1));
  for (const alert of alerts) {
    if (!isNewsworthyAlert(alert.raw)) continue;
    const id = await insertCandidate(db, {
      townId: town.id,
      kind: 'template',
      key: `alert:${alert.id}`,
      title: alert.title,
      beat: 'community',
      recordIds: [alert.id],
      proposedTier: 1,
      tierReasons: ['National Weather Service alert, quoted verbatim'],
      status: 'accepted',
      acceptedAt: now,
    });
    if (id) report.templates++;
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Story candidates

async function createStoryCandidates(
  db: Db,
  town: TownRow,
  config: TownConfig,
  now: Date,
  report: FinderReport,
  llm?: Llm,
) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  // Records of story types with no candidate yet.
  const fresh = await db
    .select({
      record: records,
      sourceKind: sources.kind,
      sourceHealth: sources.health,
    })
    .from(records)
    .innerJoin(sources, eq(records.sourceId, sources.id))
    .where(
      and(
        eq(records.townId, town.id),
        inArray(records.type, [...STORY_TYPES, ...LINK_TYPES]),
        gte(records.createdAt, since),
        // Not already a candidate, and not already cited by an article.
        sql`not exists (select 1 from ${storyCandidates} c where c.town_id = ${town.id} and ${records.id} = any(c.record_ids))`,
        sql`not exists (select 1 from ${articles} a where a.town_id = ${town.id} and ${records.id} = any(a.source_record_ids))`,
      ),
    )
    .orderBy(records.occurredAt);

  const published = await recentPublished(db, town.id, now);
  for (const { record, sourceKind } of fresh) {
    const recordText = `${record.title ?? ''}\n${record.text ?? ''}`;
    const dropped = mentionsDroppedCharges(recordText);
    // A new record about a published story becomes a dated update to it (§6a).
    const followed = STORY_TYPES.includes(record.type) ? matchPublished(record, published) : null;
    if (followed) {
      const id = await insertCandidate(db, {
        townId: town.id,
        kind: 'update',
        key: `update:${followed.id}:${record.id}:${record.contentHash}`,
        title: `Update: ${followed.headline}`,
        beat: followed.beat,
        recordIds: [record.id],
        proposedTier: followed.tier,
        targetArticleId: followed.id,
        mustWrite: dropped,
        tierReasons: ['follows up a published story'],
        status: 'accepted',
        acceptedAt: now,
      });
      if (id) report.updates++;
      continue;
    }
    const id = await insertCandidate(db, {
      townId: town.id,
      kind: 'story',
      key: `record:${record.id}`,
      title: record.title,
      beat: sourceKind === 'police' || sourceKind === 'fire' ? 'public-safety' : 'government',
      recordIds: [record.id],
      proposedTier: 2,
      // Charges dropped must always be covered, whatever the score or budget (§6a).
      mustWrite: dropped,
    });
    if (!id) continue;
    report.candidates++;
    if (cannotBeArticle([sourceKind])) {
      await skip(db, report, id, 'other_outlet', 'Other outlets appear only as links (Rule 3).');
    } else if (LINK_TYPES.includes(record.type)) {
      await skip(db, report, id, 'thin_source', 'A link to another page, with no text of its own.');
    } else if ((record.text ?? '').length < MIN_SOURCE_CHARS && !dropped) {
      await skip(
        db,
        report,
        id,
        'thin_source',
        `${(record.text ?? '').length} characters of source text.`,
      );
    }
  }

  // Classify, tier and score every pending candidate that hasn't been classified yet.
  const pending = await db
    .select()
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, town.id),
        eq(storyCandidates.kind, 'story'),
        eq(storyCandidates.status, 'pending'),
        sql`${storyCandidates.classification} is null`,
      ),
    )
    .orderBy(storyCandidates.createdAt);
  if (pending.length === 0) return;
  if (!llm) {
    report.pending += pending.length;
    return;
  }

  const recent = await recentHeadlines(db, town.id, now);
  for (let i = 0; i < pending.length; i++) {
    const candidate = pending[i]!;
    const rows = await db
      .select({ record: records, sourceKind: sources.kind, sourceHealth: sources.health })
      .from(records)
      .innerJoin(sources, eq(records.sourceId, sources.id))
      .where(inArray(records.id, candidate.recordIds));
    const text = rows.map((r) => `${r.record.title ?? ''}\n${r.record.text ?? ''}`).join('\n\n');

    let classification: Classification;
    try {
      ({ value: classification } = await callModel(llm, {
        job: 'story-finder.classify',
        town: llmTown(town, config),
        prompt: classifyV1,
        input: classifyInput(town, config, rows),
      }));
    } catch (error) {
      if (error instanceof SpendCapReached) {
        report.capReached = true;
        report.pending += pending.length - i;
        return;
      }
      if (error instanceof LlmOutputError) {
        await skip(db, report, candidate.id, 'model_error', error.message);
        continue;
      }
      throw error;
    }

    const kinds = rows.map((r) => r.sourceKind as SourceKind);
    const tier = decideTier({
      sourceKinds: kinds,
      beat: classification.beat,
      classification,
      text,
    });
    await db
      .update(storyCandidates)
      .set({
        beat: classification.beat,
        proposedTier: tier.tier,
        classification,
        tierReasons: tier.reasons,
      })
      .where(eq(storyCandidates.id, candidate.id));

    if (!classification.about_this_town) {
      await skip(db, report, candidate.id, 'wrong_town', classification.town_evidence);
      continue;
    }
    if (tier.tier === 4) {
      // Never written: log and drop (Rule 5). A minor-only flag can be overridden in review.
      await skip(db, report, candidate.id, 'tier4', tier.reasons.join('; '), 'dropped');
      continue;
    }

    const title = candidate.title ?? '';
    const duplicate = recent.find(
      (h) =>
        h.candidateId !== candidate.id && titleSimilarity(h.title, title) >= DUPLICATE_SIMILARITY,
    );
    const occurredAt = rows
      .map((r) => r.record.occurredAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const { score, components } = scoreCandidate({
      classification,
      occurredAt: occurredAt ?? null,
      sourceChars: rows.reduce((n, r) => n + (r.record.text ?? '').length, 0),
      duplicate: Boolean(duplicate),
      degradedSource: rows.some((r) => r.sourceHealth !== 'ok'),
      now,
    });
    await db
      .update(storyCandidates)
      .set({ newsworthiness: score })
      .where(eq(storyCandidates.id, candidate.id));
    await db.insert(articleScores).values({
      candidateId: candidate.id,
      newsworthiness: score,
      components: { ...components, duplicateOf: duplicate?.title ?? null },
      computedAt: now,
    });
    recent.push({ candidateId: candidate.id, title });
  }
}

export function llmTown(town: TownRow, config: TownConfig) {
  return {
    id: town.id,
    timezone: town.timezone,
    aiDailyCapUsd: config.ai_daily_cap_usd ?? 5,
    aiDailyCallCap: config.ai_daily_call_cap ?? 400,
  };
}

function classifyInput(
  town: TownRow,
  config: TownConfig,
  rows: { record: typeof records.$inferSelect; sourceKind: string }[],
): string {
  return [
    `Town: ${town.name}, ${town.state} (${town.county} County)`,
    `Agencies: ${config.agencies.join('; ')}`,
    config.same_name_elsewhere.length
      ? `Other places with a similar name: ${config.same_name_elsewhere.join('; ')}`
      : null,
    '',
    ...rows.map(({ record, sourceKind }) =>
      [
        `--- Record ${record.id} (source: ${sourceKind}${record.occurredAt ? `, dated ${record.occurredAt.toISOString()}` : ''})`,
        `Title: ${record.title ?? ''}`,
        record.text ?? '',
      ].join('\n'),
    ),
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Headlines and candidate titles from the last 14 days, for duplicate checks. */
async function recentHeadlines(
  db: Db,
  townId: string,
  now: Date,
): Promise<{ candidateId: string | null; title: string }[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const arts = await db
    .select({ headline: articles.headline })
    .from(articles)
    .where(and(eq(articles.townId, townId), gte(articles.createdAt, since)));
  const cands = await db
    .select({ id: storyCandidates.id, title: storyCandidates.title })
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, townId),
        eq(storyCandidates.kind, 'story'),
        inArray(storyCandidates.status, ['accepted', 'writing', 'written']),
        gte(storyCandidates.createdAt, since),
      ),
    );
  return [
    ...arts.map((a) => ({ candidateId: null, title: a.headline })),
    ...cands.map((c) => ({ candidateId: c.id, title: c.title ?? '' })),
  ];
}

// ---------------------------------------------------------------------------------------------
// 3. Daily budget

async function applyBudget(
  db: Db,
  town: TownRow,
  config: TownConfig,
  now: Date,
  report: FinderReport,
) {
  const budget = storyBudgetFor(config);
  const threshold = config.score_threshold ?? defaultScoreThreshold;
  const publicSafetyCap = Math.floor(budget * publicSafetyShare);
  const dayStart = startOfLocalDay(now, town.timezone);

  const acceptedToday = await db
    .select({ beat: storyCandidates.beat })
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, town.id),
        eq(storyCandidates.kind, 'story'),
        gte(storyCandidates.acceptedAt, dayStart),
      ),
    );
  let remaining = budget - acceptedToday.length;
  let publicSafety = acceptedToday.filter((c) => c.beat === 'public-safety').length;

  const scored = await db
    .select()
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, town.id),
        eq(storyCandidates.kind, 'story'),
        eq(storyCandidates.status, 'pending'),
        sql`${storyCandidates.newsworthiness} is not null`,
      ),
    )
    .orderBy(sql`${storyCandidates.mustWrite} desc, ${storyCandidates.newsworthiness} desc`);

  for (const candidate of scored) {
    const score = candidate.newsworthiness ?? 0;
    if (candidate.mustWrite) {
      await db
        .update(storyCandidates)
        .set({ status: 'accepted', acceptedAt: now })
        .where(eq(storyCandidates.id, candidate.id));
      remaining--;
      if (candidate.beat === 'public-safety') publicSafety++;
      report.accepted++;
    } else if (score < threshold) {
      await skip(db, report, candidate.id, 'below_threshold', `Score ${score} < ${threshold}.`);
    } else if (remaining <= 0) {
      await skip(db, report, candidate.id, 'budget_full', `Daily budget of ${budget} used.`);
    } else if (candidate.beat === 'public-safety' && publicSafety >= publicSafetyCap) {
      await skip(
        db,
        report,
        candidate.id,
        'public_safety_cap',
        `Public safety capped at ${publicSafetyCap} of ${budget} items a day.`,
      );
    } else {
      await db
        .update(storyCandidates)
        .set({ status: 'accepted', acceptedAt: now })
        .where(eq(storyCandidates.id, candidate.id));
      remaining--;
      if (candidate.beat === 'public-safety') publicSafety++;
      report.accepted++;
    }
  }
}
