import {
  READINESS_DAYS,
  readinessMinimum,
  type SourceKind,
  type TownConfig,
} from '@towncore/config';
import { getAdapter, ingestSource, type Fetcher } from '@towncore/adapters';
import { and, eq, gte, lte, records, sources, towns, type Db } from '@towncore/db';
import {
  callModel,
  classifyInput,
  decideTier,
  llmTown,
  LlmOutputError,
  SpendCapReached,
  type Llm,
} from '@towncore/pipeline';
import { classifyV1 } from '@towncore/prompts';

// Launch step 5 (CLAUDE.md §10, Rule 7): ingest the last 30 days of every source into the draft
// town, then count the real items a day the pipeline would make from them, without writing any:
//   - each release, and each meeting's minutes or recorded actions (a recap), with enough text is
//     one story; with a model configured it must also be classified about this town and not
//     Tier 4 (count-only: nothing is written);
//   - meetings, events and each business-filing source make one weekly roundup per week they
//     have items (the finder's templated roundups, D-M3-6);
//   - weather and evergreen guides don't count.
// The target is 3 a day (10 for `large`): a town short of it still launches, and the report
// shows the gap (Rule 7, owner 2026-10-17).

/** Same bar as the story finder's thin-source check (pipeline/scoring.ts MIN_SOURCE_CHARS). */
const MIN_STORY_CHARS = 400;
/** Most releases classified per launch, to bound model cost. */
const MAX_CLASSIFIED = 60;
/** Record types written up as individual stories (the story finder's STORY_TYPES). */
const STORY_TYPES = ['release', 'minutes', 'meeting-actions'];
const ROUNDUP_KINDS: SourceKind[] = [
  'agenda',
  'events',
  'business_filings',
  'permits',
  'property_sales',
  'inspections',
];

export type SourceReadiness = {
  sourceId: string;
  kind: SourceKind;
  platform: string;
  ingest: { status: 'ok' | 'failed'; items: number; error?: string };
  /** Records dated within the window. */
  recent: number;
  /** Items the pipeline would make from them in the window. */
  items: number;
  how: string;
};

export type ReadinessDetail = {
  days: number;
  itemsPerDay: number;
  minimum: number;
  passed: boolean;
  /** `classified`: releases checked by the model; `estimate`: no model, an upper bound. */
  mode: 'classified' | 'estimate';
  bySource: SourceReadiness[];
};

const weekKey = (d: Date) => {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};

export async function measureReadiness(input: {
  db: Db;
  townId: string;
  fetcher: Fetcher;
  llm?: Llm;
  now?: Date;
}): Promise<ReadinessDetail> {
  const { db, townId, fetcher } = input;
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - READINESS_DAYS * 86_400_000);
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);
  const config = town.config as TownConfig;
  const rows = (await db.select().from(sources).where(eq(sources.townId, townId))).filter(
    (s) => s.kind !== 'weather' && s.kind !== 'reference',
  );

  const bySource: SourceReadiness[] = [];
  let classified = 0;
  let mode: ReadinessDetail['mode'] = input.llm ? 'classified' : 'estimate';
  for (const source of rows) {
    const adapter = getAdapter(source.platform);
    const result = adapter
      ? await ingestSource(db, source, adapter, fetcher, now)
      : { status: 'failed' as const, items: 0, error: `no adapter for ${source.platform}` };
    const recent = await db
      .select()
      .from(records)
      .where(
        and(
          eq(records.sourceId, source.id),
          gte(records.occurredAt, from),
          lte(records.occurredAt, now),
        ),
      );
    const kind = source.kind as SourceKind;
    // Stories: the record types the finder writes up one by one (releases, and meeting minutes
    // or recorded actions as recaps). Everything else on a roundup source is one roundup a week.
    const stories = recent.filter(
      (r) => STORY_TYPES.includes(r.type) && (r.text ?? '').length >= MIN_STORY_CHARS,
    );
    const rest = recent.filter((r) => !STORY_TYPES.includes(r.type));
    const parts: string[] = [];
    let items = 0;
    if (stories.length && !input.llm) {
      items += stories.length;
      parts.push(`${stories.length} stories with enough text (not classified)`);
    } else if (stories.length && input.llm) {
      let kept = 0;
      let checked = 0;
      for (const record of stories) {
        if (classified >= MAX_CLASSIFIED) break;
        classified++;
        checked++;
        try {
          const { value } = await callModel(input.llm, {
            job: 'launch.readiness',
            town: llmTown(town, config),
            prompt: classifyV1,
            input: classifyInput(town, config, [{ record, sourceKind: kind }]),
          });
          const tier = decideTier({
            sourceKinds: [kind],
            beat: value.beat,
            classification: value,
            text: `${record.title ?? ''}\n${record.text ?? ''}`,
          });
          if (value.about_this_town && tier.tier < 4) kept++;
        } catch (error) {
          if (error instanceof SpendCapReached) {
            mode = 'estimate';
            break;
          }
          if (error instanceof LlmOutputError) continue;
          throw error;
        }
      }
      // Stories past the classification limit count at the rate of the ones checked.
      const rate = checked ? kept / checked : 0;
      items += Math.round(kept + rate * (stories.length - checked));
      parts.push(
        `${kept} of ${checked} classified stories are about this town${stories.length > checked ? `, ${stories.length - checked} more counted at that rate` : ''}`,
      );
    }
    if (ROUNDUP_KINDS.includes(kind) && rest.length) {
      const weeks = new Set(rest.map((r) => weekKey(r.occurredAt!)));
      items += weeks.size;
      parts.push(`${rest.length} records in ${weeks.size} weeks: one weekly roundup a week`);
    }
    const how = parts.join('; ') || `${recent.length} records, none that count`;
    bySource.push({
      sourceId: source.id,
      kind,
      platform: source.platform,
      ingest: {
        status: result.status,
        items: result.items,
        ...(result.error ? { error: result.error } : {}),
      },
      recent: recent.length,
      items,
      how,
    });
  }

  const itemsPerDay =
    Math.round((bySource.reduce((n, s) => n + s.items, 0) / READINESS_DAYS) * 100) / 100;
  const minimum = readinessMinimum[town.tier];
  await db.update(towns).set({ readinessScore: itemsPerDay }).where(eq(towns.id, townId));
  return {
    days: READINESS_DAYS,
    itemsPerDay,
    minimum,
    passed: itemsPerDay >= minimum,
    mode,
    bySource,
  };
}
