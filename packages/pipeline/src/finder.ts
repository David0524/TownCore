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
  records,
  skippedCandidates,
  sources,
  sql,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { classifyPrompt, type Classification } from '@towncore/prompts';
import {
  createChangedRecordUpdates,
  matchPublished,
  mentionsDroppedCharges,
  recentPublished,
} from './followups';
import { callModel, LlmOutputError, SpendCapReached, type Llm } from './llm';
import {
  chooseSplit,
  itemSourceText,
  MEETING_RESULT_TYPES,
  MEETING_SPLIT_VERSION,
  meetingSplitEnabled,
  splitMeeting,
  type MeetingItem,
} from './meeting-split';
import { MIN_SOURCE_CHARS, scoreCandidate, titleSimilarity } from './scoring';
import { createGuideCandidates } from './guides';
import { roundupWeekRecords, townRecords } from './roundup-weeks';
import {
  inspectionSpotlights,
  nursingHomeSpotlights,
  permitSpotlights,
  type Spotlight,
} from './spotlights';
import { developmentMoves, hasInspectionFailures, isNewsworthyAlert } from './templates';
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
/** A title this close to a story already covered is skipped before any model call. */
const COVERED_SIMILARITY = 0.85;

type SkipReason = (typeof skippedCandidates.$inferInsert)['reason'];

export type FinderReport = {
  roundups: string[];
  /** Single-place stories from standout records (spotlights.ts). */
  spotlights: string[];
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
  /** Decision stories split from meetings (meeting-split.ts; off until its route is on). */
  meetingItems: number;
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
    spotlights: [],
    templates: 0,
    updates: 0,
    candidates: 0,
    accepted: 0,
    skipped: {},
    dropped: 0,
    pending: 0,
    capReached: false,
    guides: 0,
    meetingItems: 0,
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

/** Record types that are written up with a meeting's results, never on their own. */
const COMPANION_TYPES = ['transcript'];

/**
 * A meeting's machine transcript, from the same source, goes to the writer alongside its
 * minutes or recorded actions (`minutes:<id>` or `actions:<id>` → `transcript:<id>`): detail for
 * the recap, never its only source. A story citing one goes to review (write.ts).
 */
async function companionRecords(db: Db, record: typeof records.$inferSelect): Promise<string[]> {
  if (record.type !== 'minutes' && record.type !== 'meeting-actions') return [];
  const meeting = record.externalId.split(':').slice(1).join(':');
  if (!meeting) return [];
  const rows = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.sourceId, record.sourceId),
        inArray(records.type, COMPANION_TYPES),
        // The platform's transcript, or captions staff uploaded (captions.ts).
        inArray(records.externalId, [`transcript:${meeting}`, `transcript-upload:${meeting}`]),
      ),
    );
  return rows.map((r) => r.id);
}

/** A new-places roundup needs this many licenses in the week. */
export const NEW_PLACES_MIN = 3;

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
    const meetings = await roundupWeekRecords(db, town, 'meetings', meetingWeek, { from: now });
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
    const week = isoLocalDate(lastWeek, tz);
    const filings = await roundupWeekRecords(db, town, 'new-businesses', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:new-businesses:${week}`,
      title: `New businesses, week of ${week}`,
      beat: 'business',
      recordIds: filings.map((r) => r.id),
      now,
    });
    const licenses = await roundupWeekRecords(db, town, 'new-licenses', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:new-licenses:${week}`,
      title: `New contractor licenses, week of ${week}`,
      beat: 'business',
      recordIds: licenses.map((r) => r.id),
      now,
    });
    // New places to eat and drink: new food service establishments and new liquor licenses.
    const newPlaces = await roundupWeekRecords(db, town, 'new-places', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:new-places:${week}`,
      title: `New places to eat and drink, week of ${week}`,
      beat: 'business',
      recordIds: newPlaces.map((r) => r.id),
      // A week with one or two is too thin for a story (never pad, Rule 7); the homepage's new
      // places module still shows them.
      min: NEW_PLACES_MIN,
      now,
    });
    // Permits from a city or county open-data source (§7: permit roundups are Tier 1). Their
    // dates are real timestamps, so the local week is used rather than the date-only range.
    const permits = await roundupWeekRecords(db, town, 'permits', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:permits:${week}`,
      title: `Building permits, week of ${week}`,
      beat: 'development',
      recordIds: permits.map((r) => r.id),
      now,
    });
    await spotlights(db, town, report, week, permitSpotlights(permits), now);
    // Projects new or moved on a city's development map (proposed, approved, under construction,
    // completed). Development is civic news (§7 Tier 2), so a share goes to review first.
    const development = await roundupWeekRecords(db, town, 'development', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:development:${week}`,
      title: `Development projects, week of ${week}`,
      beat: 'development',
      recordIds: developmentMoves(development).length ? development.map((r) => r.id) : [],
      tier: 2,
      tierReason: 'development projects are civic news (§7 Tier 2)',
      now,
    });
    // Road work (owner, 2026-10-17): a county's weekly list, issued for the coming days, so this
    // rounds up the list issued this week as soon as it's ingested.
    const roadsWeek = localWeekStart(now, tz);
    const roads = await roundupWeekRecords(db, town, 'roads', roadsWeek);
    await roundup(db, town, report, {
      key: `roundup:roads:${isoLocalDate(roadsWeek, tz)}`,
      title: `Road work, week of ${isoLocalDate(roadsWeek, tz)}`,
      beat: 'development',
      recordIds: roads.map((r) => r.id),
      now,
    });
    // Property sales (owner, 2026-10-17): deeds are recorded about two weeks after a sale, so
    // this rounds up the week before last. Sale dates are date-only, like the filings.
    const salesWeek = localWeekStart(now, tz, -2);
    const sales = await roundupWeekRecords(db, town, 'sales', salesWeek);
    await roundup(db, town, report, {
      key: `roundup:sales:${isoLocalDate(salesWeek, tz)}`,
      title: `Property sales, week of ${isoLocalDate(salesWeek, tz)}`,
      beat: 'development',
      recordIds: sales.map((r) => r.id),
      now,
    });
    // New federal contracts and grants to town recipients (USASpending, every town). One award
    // is too thin for a story (Rule 7); the second makes a week worth telling.
    const federal = await roundupWeekRecords(db, town, 'federal', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:federal:${week}`,
      title: `Federal awards, week of ${week}`,
      beat: 'business',
      recordIds: federal.map((r) => r.id),
      min: 2,
      now,
    });
    // Restaurant inspections: a week that names a closure or complaint needs a person (§7).
    const inspections = await roundupWeekRecords(db, town, 'inspections', lastWeek);
    const failures = hasInspectionFailures(inspections.map((r) => r.raw));
    await roundup(db, town, report, {
      key: `roundup:inspections:${week}`,
      title: `Restaurant inspections, week of ${week}`,
      beat: 'business',
      recordIds: inspections.map((r) => r.id),
      now,
      ...(failures
        ? { tier: 3, tierReason: 'names businesses with failed inspections (§7 Tier 3)' }
        : {}),
    });
    await spotlights(db, town, report, week, inspectionSpotlights(inspections), now);
    // Nursing-home inspections and penalties (CMS, every town): CMS publishes them monthly, months
    // after the visit, so this rounds up what was first read last week. Always Tier 3 (§7).
    const nursingHomes = await roundupWeekRecords(db, town, 'nursing-homes', lastWeek);
    await roundup(db, town, report, {
      key: `roundup:nursing-homes:${week}`,
      title: `Nursing home inspections, week of ${week}`,
      beat: 'business',
      recordIds: nursingHomes.map((r) => r.id),
      now,
      tier: 3,
      tierReason: 'health inspection findings at named nursing homes (§7 Tier 3)',
    });
    await spotlights(db, town, report, week, nursingHomeSpotlights(nursingHomes), now);
  }
}

async function roundup(
  db: Db,
  town: TownRow,
  report: FinderReport,
  item: {
    key: string;
    title: string;
    beat: string;
    recordIds: string[];
    now: Date;
    tier?: 1 | 2 | 3;
    tierReason?: string;
    /** Fewest records worth a story (default 1). */
    min?: number;
  },
) {
  if (item.recordIds.length < (item.min ?? 1)) return;
  const id = await insertCandidate(db, {
    townId: town.id,
    kind: 'roundup',
    key: item.key,
    title: item.title,
    beat: item.beat,
    recordIds: item.recordIds,
    proposedTier: item.tier ?? 1,
    tierReasons: [
      'roundup built in code from public records',
      ...(item.tierReason ? [item.tierReason] : []),
    ],
    status: 'accepted',
    acceptedAt: item.now,
  });
  if (id) report.roundups.push(item.key);
}

/**
 * Single-place stories from the week's standout records (spotlights.ts), each its own templated
 * item keyed `spotlight:<kind>:<week>:<id>`, so a re-run never doubles one.
 */
async function spotlights(
  db: Db,
  town: TownRow,
  report: FinderReport,
  week: string,
  items: Spotlight[],
  now: Date,
) {
  for (const item of items) {
    const key = `spotlight:${item.kind}:${week}:${item.id}`;
    const id = await insertCandidate(db, {
      townId: town.id,
      kind: 'template',
      key,
      title: item.title,
      beat: item.kind === 'permit' ? 'development' : 'business',
      recordIds: item.recordIds,
      proposedTier: item.tier,
      tierReasons: [
        'spotlight built in code from public records',
        ...(item.tier === 3
          ? [
              item.kind === 'nursing-home'
                ? 'names a nursing home with health findings (§7 Tier 3)'
                : 'names a business with inspection problems (§7 Tier 3)',
            ]
          : []),
      ],
      status: 'accepted',
      acceptedAt: now,
    });
    if (id) report.spotlights.push(key);
  }
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
      recordIds: [record.id, ...(await companionRecords(db, record))],
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
    // A companion transcript is detail for the writer; the candidate is judged on its minutes.
    const rows = (
      await db
        .select({ record: records, sourceKind: sources.kind, sourceHealth: sources.health })
        .from(records)
        .innerJoin(sources, eq(records.sourceId, sources.id))
        .where(inArray(records.id, candidate.recordIds))
    ).filter((r) => !COMPANION_TYPES.includes(r.record.type));
    const text = rows.map((r) => `${r.record.title ?? ''}\n${r.record.text ?? ''}`).join('\n\n');

    // Code before models (owner, 2026-10-17): what code can reject costs no model call.
    const covered = recent.find(
      (h) =>
        h.candidateId !== candidate.id &&
        titleSimilarity(h.title, candidate.title ?? '') >= COVERED_SIMILARITY,
    );
    if (covered) {
      await skip(db, report, candidate.id, 'duplicate', `Already covered: ${covered.title}`);
      continue;
    }
    const elsewhere = otherPlaceOnly(text, town.name, config.same_name_elsewhere);
    if (elsewhere) {
      await skip(db, report, candidate.id, 'wrong_town', `Names ${elsewhere}, never ${town.name}.`);
      continue;
    }

    let classification: Classification;
    try {
      ({ value: classification } = await callModel(llm, {
        job: 'story-finder.classify',
        town: llmTown(town, config),
        prompt: classifyPrompt,
        ...classifyParts(town, config, rows),
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

    // A meeting with several newsworthy decisions becomes one story per decision (switched off
    // until the splitter is recorded). Asked before anything is saved, so a spend cap leaves
    // the candidate to classify again next run (the classify answer is reused at no cost).
    let split: Awaited<ReturnType<typeof trySplit>> = null;
    if (
      classification.about_this_town &&
      tier.tier !== 4 &&
      !candidate.mustWrite &&
      meetingSplitEnabled(llm) &&
      rows.some((r) => MEETING_RESULT_TYPES.includes(r.record.type))
    ) {
      try {
        split = await trySplit(db, llm, town, config, candidate.recordIds, rows);
      } catch (error) {
        if (error instanceof SpendCapReached) {
          report.capReached = true;
          report.pending += pending.length - i;
          return;
        }
        // Output that fails its schema keeps the meeting as one recap.
        if (!(error instanceof LlmOutputError)) throw error;
      }
    }

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

    if (split) {
      report.meetingItems += await createDecisionCandidates(db, {
        town,
        parent: candidate,
        classification,
        tier,
        rows,
        split,
        recent,
        now,
      });
      const topics = split.split.map((item) => item.topic).join('; ');
      const left = split.left.map((item) => item.topic).join('; ');
      await skip(
        db,
        report,
        candidate.id,
        'duplicate',
        `Split into ${split.split.length} decision stories (${MEETING_SPLIT_VERSION}): ${topics}.` +
          (left ? ` Not written on their own: ${left}.` : ''),
      );
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

type FinderRow = {
  record: typeof records.$inferSelect;
  sourceKind: string;
  sourceHealth: string;
};

/**
 * Splits a meeting's minutes or actions into its decisions (meeting-split.ts), with the
 * meeting's transcript to locate each one. Null keeps it as one recap.
 */
async function trySplit(
  db: Db,
  llm: Llm,
  town: TownRow,
  config: TownConfig,
  recordIds: string[],
  rows: FinderRow[],
) {
  const minutes = rows.map((r) => r.record).filter((r) => MEETING_RESULT_TYPES.includes(r.type));
  const [transcript] = await db
    .select()
    .from(records)
    .where(and(inArray(records.id, recordIds), inArray(records.type, COMPANION_TYPES)))
    .orderBy(records.createdAt);
  const result = await splitMeeting(llm, {
    town: llmTown(town, config),
    townLines: classifyParts(town, config, []).inputPrefix,
    minutes,
    transcript: transcript ?? null,
  });
  const chosen = chooseSplit(result.items);
  return chosen ? { ...chosen, minutes, transcript: transcript ?? null } : null;
}

/**
 * One pending story candidate per chosen decision, classified and scored from the meeting's
 * answer with the decision's own impact, novelty and proximity. The daily budget then decides
 * which are written, like any story.
 */
async function createDecisionCandidates(
  db: Db,
  a: {
    town: TownRow;
    parent: typeof storyCandidates.$inferSelect;
    classification: Classification;
    tier: { tier: number; reasons: string[] };
    rows: FinderRow[];
    split: NonNullable<Awaited<ReturnType<typeof trySplit>>>;
    recent: { candidateId: string | null; title: string }[];
    now: Date;
  },
): Promise<number> {
  const { split, now } = a;
  const occurredAt =
    a.rows
      .map((r) => r.record.occurredAt)
      .filter((d): d is Date => d !== null)
      .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const degraded = a.rows.some((r) => r.sourceHealth !== 'ok');
  const siblings: { candidateId: string | null; title: string }[] = [];
  let made = 0;
  for (const item of split.split) {
    const minutes = split.minutes.find((m) => m.id === item.recordId)!;
    const itemClassification: Classification & { meeting_item: MeetingItem } = {
      ...a.classification,
      impact: item.impact,
      novelty: item.novelty,
      proximity: item.proximity,
      meeting_item: item,
    };
    const duplicate = a.recent.find(
      (h) => titleSimilarity(h.title, item.topic) >= DUPLICATE_SIMILARITY,
    );
    const { score, components } = scoreCandidate({
      classification: itemClassification,
      occurredAt,
      sourceChars: itemSourceText(minutes, item).length,
      duplicate: Boolean(duplicate),
      degradedSource: degraded,
      now,
    });
    const [row] = await db
      .insert(storyCandidates)
      .values({
        townId: a.town.id,
        kind: 'story',
        key: `meeting-item:${item.recordId}:${item.index}`,
        title: item.topic,
        beat: a.classification.beat,
        recordIds: [item.recordId, ...(item.transcript ? [item.transcript.recordId] : [])],
        proposedTier: a.tier.tier,
        classification: itemClassification,
        tierReasons: [
          ...a.tier.reasons,
          `one of ${split.split.length} decisions from a meeting (${MEETING_SPLIT_VERSION})`,
        ],
        newsworthiness: score,
      })
      .onConflictDoNothing({ target: [storyCandidates.townId, storyCandidates.key] })
      .returning({ id: storyCandidates.id });
    if (!row) continue;
    made++;
    await db.insert(articleScores).values({
      candidateId: row.id,
      newsworthiness: score,
      components: {
        ...components,
        duplicateOf: duplicate?.title ?? null,
        splitFrom: a.parent.id,
        meetingItem: item.index,
      },
      computedAt: now,
    });
    siblings.push({ candidateId: row.id, title: item.topic });
  }
  // Sibling decisions share words ("Council approves…"): they're compared with earlier
  // coverage only, then join it for whatever this run looks at next.
  a.recent.push(...siblings);
  return made;
}

export function llmTown(town: TownRow, config: TownConfig) {
  return {
    id: town.id,
    timezone: town.timezone,
    aiDailyCapUsd: config.ai_daily_cap_usd ?? 5,
    aiDailyCallCap: config.ai_daily_call_cap ?? 400,
  };
}

export function classifyInput(
  town: TownRow,
  config: TownConfig,
  rows: { record: typeof records.$inferSelect; sourceKind: string }[],
): string {
  const parts = classifyParts(town, config, rows);
  return `${parts.inputPrefix}\n${parts.input}`;
}

/** The classify input in two parts: the town (cached across calls) and the records. */
export function classifyParts(
  town: TownRow,
  config: TownConfig,
  rows: { record: typeof records.$inferSelect; sourceKind: string }[],
): { inputPrefix: string; input: string } {
  const inputPrefix = [
    `Town: ${town.name}, ${town.state} (${town.county} County)`,
    `Agencies: ${config.agencies.join('; ')}`,
    config.same_name_elsewhere.length
      ? `Other places with a similar name: ${config.same_name_elsewhere.join('; ')}`
      : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const input = [
    '',
    ...rows.map(({ record, sourceKind }) =>
      [
        `--- Record ${record.id} (source: ${sourceKind}${record.occurredAt ? `, dated ${record.occurredAt.toISOString()}` : ''})`,
        `Title: ${record.title ?? ''}`,
        record.text ?? '',
      ].join('\n'),
    ),
  ].join('\n');
  return { inputPrefix, input };
}

/**
 * A same-name place the records name while never naming this town ("Lake Worth Beach, FL" in
 * Lake Worth's feed): out of town without asking a model. Null when the town is named.
 */
export function otherPlaceOnly(text: string, townName: string, elsewhere: string[]): string | null {
  const lower = text.toLowerCase();
  const named = (place: string) => lower.includes(place.toLowerCase());
  if (named(townName)) return null;
  return elsewhere.find((place) => named(place.split(',')[0]!.trim())) ?? null;
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
