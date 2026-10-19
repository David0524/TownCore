import {
  estimateCostUsd,
  providerModels,
  storyBudgetFor,
  taskRoutes,
  type AiTask,
  type LlmProviderName,
  type TownConfig,
} from '@towncore/config';
import { and, eq, gte, inArray, records, sql, storyCandidates, towns, type Db } from '@towncore/db';
import {
  classifyV2,
  discoverV1,
  entitiesV1,
  factcheckV1,
  guideV1,
  meetingSplitV1,
  themeReviewV1,
  themeV1,
  updateV1,
  writerV1,
} from '@towncore/prompts';
import { MEETING_RESULT_TYPES } from './meeting-split';
import { MIN_SOURCE_CHARS } from './scoring';

// `pnpm ai:plan <town>` (owner, 2026-10-17, model protocol §5): what one day of a town's work
// would ask of the models (tasks, models, calls, tokens and cost), with no API key. Volumes come
// from the town's last week of records and candidates; sizes from the real prompts and the
// town's own record text; output sizes are typical answers. It's an estimate to compare with the
// caps, not a bill: the real cost of every call is logged in ai_usage.

/** Story record types the finder sends to the classifier (finder.ts STORY_TYPES). */
const STORY_TYPES = ['release', 'minutes', 'meeting-actions'];
/** Expected characters a token (the 5.x tokenizer counts about 30% more than older ones). */
const CHARS_PER_TOKEN = 3.5;
/** A typical answer's output tokens per task (thinking off). */
const TYPICAL_OUTPUT: Record<AiTask, number> = {
  classify: 400,
  extract: 300,
  write: 1000,
  factcheck: 1500,
  revise: 1000,
  update: 500,
  guide: 1800,
  'guide-factcheck': 2000,
  'guide-revise': 1800,
  discover: 4000,
  identity: 1500,
  'theme-review': 1200,
  reviewer: 800,
  'meeting-split': 1500,
};
/** Share of written stories that need the one revise, until ai_usage has a week of history. */
const DEFAULT_REVISE_RATE = 0.3;
/** Share of classified candidates accepted for writing, without history. */
const DEFAULT_ACCEPT_RATE = 0.5;
/** Story-finder runs a day (every 30 minutes): at most one cache write per task per run. */
const RUNS_A_DAY = 48;
/** Guides are rewritten when their pages change, about every 90 days (§6a). */
const GUIDE_REFRESH_DAYS = 90;

export type PlanLine = {
  task: AiTask;
  model: string;
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number;
  batch: boolean;
};

export type DayPlan = {
  town: string;
  provider: LlmProviderName;
  budget: number;
  storyRecordsPerDay: number;
  lines: PlanLine[];
  usd: number;
  townCapUsd: number;
  /** Tasks whose estimated day passes their own network-wide cap at this one town. */
  overTaskCaps: AiTask[];
  /** A launch's one-off calls (discovery, identity, two screenshot reviews). */
  launch: PlanLine[];
  launchUsd: number;
};

const SYSTEMS: Record<AiTask, string> = {
  classify: classifyV2.system,
  extract: entitiesV1.system,
  write: writerV1.system,
  factcheck: factcheckV1.system,
  revise: writerV1.system,
  update: updateV1.system,
  guide: guideV1.system,
  'guide-factcheck': factcheckV1.system,
  'guide-revise': guideV1.system,
  discover: discoverV1.system,
  identity: themeV1.system,
  'theme-review': themeReviewV1.system,
  reviewer: factcheckV1.system,
  'meeting-split': meetingSplitV1.system,
};

function line(
  provider: LlmProviderName,
  task: AiTask,
  calls: number,
  perCallChars: { cached: number; fresh: number },
): PlanLine {
  const route = taskRoutes[task];
  const model = providerModels[provider][route.tier];
  const cachedPerCall = Math.ceil(perCallChars.cached / CHARS_PER_TOKEN);
  const freshPerCall = Math.ceil(perCallChars.fresh / CHARS_PER_TOKEN);
  const batch = Boolean(route.batch);
  // One cache write a run per task; the other calls read the system prompt and town prefix.
  const writes = batch ? calls : Math.min(calls, RUNS_A_DAY);
  const reads = batch ? 0 : Math.max(0, calls - writes);
  const outputTokens = Math.round(calls * TYPICAL_OUTPUT[task]);
  const usage = {
    inputTokens: Math.round(calls * freshPerCall + (batch ? calls * cachedPerCall : 0)),
    cacheReadTokens: Math.round(reads * cachedPerCall),
    cacheWriteTokens: batch ? 0 : Math.round(writes * cachedPerCall),
    outputTokens,
  };
  const searches = (route.webSearch?.maxUses ?? 0) * calls;
  return {
    task,
    model,
    calls: Math.round(calls * 10) / 10,
    inputTokens: usage.inputTokens + usage.cacheWriteTokens,
    cachedTokens: usage.cacheReadTokens,
    outputTokens,
    usd: estimateCostUsd(model, usage, { batch }) + searches * 0.01,
    batch,
  };
}

export async function planDay(
  db: Db,
  slug: string,
  opts: { now?: Date; provider?: LlmProviderName; days?: number } = {},
): Promise<DayPlan> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 7;
  const provider = opts.provider ?? 'anthropic';
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  if (!town) throw new Error(`No town ${slug}; run pnpm towns:sync first.`);
  const config = town.config as TownConfig;
  const since = new Date(now.getTime() - days * 86_400_000);

  // Records the classifier would see: story types with enough text (code rejects the rest).
  const [story] = await db
    .select({
      n: sql<number>`count(*)::int`,
      chars: sql<number>`coalesce(avg(least(length(${records.text}), 6000)), 0)::int`,
    })
    .from(records)
    .where(
      and(
        eq(records.townId, town.id),
        inArray(records.type, STORY_TYPES),
        sql`length(coalesce(${records.text}, '')) >= ${MIN_SOURCE_CHARS}`,
        gte(records.createdAt, since),
      ),
    );
  const storyPerDay = (story?.n ?? 0) / days;
  const recordChars = story?.chars || 2000;

  // Accept rate from the town's own history, when it has some.
  const [hist] = await db
    .select({
      classified: sql<number>`count(*) filter (where ${storyCandidates.classification} is not null)::int`,
      accepted: sql<number>`count(*) filter (where ${storyCandidates.status} in ('accepted', 'writing', 'written'))::int`,
    })
    .from(storyCandidates)
    .where(
      and(
        eq(storyCandidates.townId, town.id),
        eq(storyCandidates.kind, 'story'),
        gte(storyCandidates.createdAt, since),
      ),
    );
  const acceptRate =
    hist && hist.classified >= 10 ? hist.accepted / hist.classified : DEFAULT_ACCEPT_RATE;
  const budget = storyBudgetFor(config);
  const writes = Math.min(budget, storyPerDay * acceptRate);

  const [pages] = await db
    .select({ chars: sql<number>`coalesce(avg(least(length(${records.text}), 8000)), 0)::int` })
    .from(records)
    .where(and(eq(records.townId, town.id), eq(records.type, 'page')));
  const guideTopics = config.guides?.length ?? 0;
  const guidesPerDay = guideTopics / GUIDE_REFRESH_DAYS;
  const guideChars = (pages?.chars || 3000) * 2;

  // Meetings the splitter would read, once its route is switched on (meeting-split.ts).
  const [meetings] = taskRoutes['meeting-split'].disabled
    ? [{ n: 0 }]
    : await db
        .select({ n: sql<number>`count(*)::int` })
        .from(records)
        .where(
          and(
            eq(records.townId, town.id),
            inArray(records.type, MEETING_RESULT_TYPES),
            sql`length(coalesce(${records.text}, '')) >= ${MIN_SOURCE_CHARS}`,
            gte(records.createdAt, since),
          ),
        );
  const meetingsPerDay = (meetings?.n ?? 0) / days;

  const prefix = 200; // the town's name, county, timezone and agencies
  const sys = (t: AiTask) => SYSTEMS[t].length + prefix;
  const draftChars = 3000;
  const lines = [
    line(provider, 'classify', storyPerDay, { cached: sys('classify'), fresh: recordChars }),
    line(provider, 'write', writes, { cached: sys('write'), fresh: recordChars }),
    line(provider, 'factcheck', writes * (1 + DEFAULT_REVISE_RATE), {
      cached: sys('factcheck'),
      fresh: recordChars + draftChars,
    }),
    line(provider, 'revise', writes * DEFAULT_REVISE_RATE, {
      cached: sys('revise'),
      fresh: recordChars + 300,
    }),
    line(provider, 'extract', writes, { cached: sys('extract'), fresh: draftChars }),
    line(provider, 'guide', guidesPerDay, { cached: sys('guide'), fresh: guideChars }),
    line(provider, 'guide-factcheck', guidesPerDay * (1 + DEFAULT_REVISE_RATE), {
      cached: sys('guide-factcheck'),
      fresh: guideChars + 4000,
    }),
    line(provider, 'guide-revise', guidesPerDay * DEFAULT_REVISE_RATE, {
      cached: sys('guide-revise'),
      fresh: guideChars + 300,
    }),
    // One call a part of minutes, with the transcript's outline (a few thousand characters).
    line(provider, 'meeting-split', meetingsPerDay, {
      cached: sys('meeting-split'),
      fresh: recordChars + 3000,
    }),
  ].filter((l) => l.calls > 0);
  const usd = lines.reduce((n, l) => n + l.usd, 0);
  const launch = [
    // Search results the model reads: about 3,000 tokens a search, every allowed search used.
    line(provider, 'discover', 1, {
      cached: sys('discover'),
      fresh: 400 + (taskRoutes.discover.webSearch?.maxUses ?? 0) * 3000 * CHARS_PER_TOKEN,
    }),
    line(provider, 'identity', 1, { cached: sys('identity'), fresh: 1500 }),
    line(provider, 'theme-review', 2, { cached: sys('theme-review'), fresh: 20_000 }),
  ];
  return {
    town: town.siteName,
    provider,
    budget,
    storyRecordsPerDay: Math.round(storyPerDay * 10) / 10,
    lines,
    usd,
    townCapUsd: config.ai_daily_cap_usd ?? 5,
    overTaskCaps: lines.filter((l) => l.usd > taskRoutes[l.task].dailyCapUsd).map((l) => l.task),
    launch,
    launchUsd: launch.reduce((n, l) => n + l.usd, 0),
  };
}

/** The plan as a plain-text table for the terminal. */
export function formatPlan(plan: DayPlan): string {
  const money = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const row = (l: PlanLine) =>
    [
      l.task.padEnd(16),
      l.model.padEnd(20),
      String(l.calls).padStart(6),
      k(l.inputTokens).padStart(8),
      k(l.cachedTokens).padStart(8),
      k(l.outputTokens).padStart(8),
      money(l.usd).padStart(9),
      l.batch ? '  batch' : '',
    ].join(' ');
  const head = [
    'task'.padEnd(16),
    'model'.padEnd(20),
    'calls'.padStart(6),
    'input'.padStart(8),
    'cached'.padStart(8),
    'output'.padStart(8),
    'cost'.padStart(9),
  ].join(' ');
  return [
    `${plan.town}: one day on ${plan.provider} (estimate; no model is called)`,
    `${plan.storyRecordsPerDay} story records a day reach the classifier; budget ${plan.budget} stories.`,
    '',
    head,
    ...plan.lines.map(row),
    '',
    `Total ${money(plan.usd)} a day against the town cap of ${money(plan.townCapUsd)}${plan.usd > plan.townCapUsd ? ' (OVER the cap: work stops when it is reached)' : ''}.`,
    plan.overTaskCaps.length
      ? `Over a task's own daily cap: ${plan.overTaskCaps.join(', ')}.`
      : 'Every task is under its own daily cap.',
    '',
    'A launch, once (inside the $25 launch cap):',
    head,
    ...plan.launch.map(row),
    `Launch total ${money(plan.launchUsd)}.`,
  ].join('\n');
}
