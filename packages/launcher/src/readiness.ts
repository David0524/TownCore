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
//   - each city, police or fire release with enough text is one story; with a model configured it
//     must also be classified about this town and not Tier 4 (count-only: nothing is written);
//   - meetings, events and each business-filing source make one weekly roundup per week they
//     have items (the finder's templated roundups, D-M3-6);
//   - weather and evergreen guides don't count.
// A town below 3 a day (10 for `large`) stops the launch.

/** Same bar as the story finder's thin-source check (pipeline/scoring.ts MIN_SOURCE_CHARS). */
const MIN_STORY_CHARS = 400;
/** Most releases classified per launch, to bound model cost. */
const MAX_CLASSIFIED = 60;
const STORY_KINDS: SourceKind[] = ['city_news', 'police', 'fire', 'schools'];
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

export class ReadinessFailed extends Error {}

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
    let items = 0;
    let how: string;
    if (STORY_KINDS.includes(kind)) {
      const stories = recent.filter(
        (r) => r.type === 'release' && (r.text ?? '').length >= MIN_STORY_CHARS,
      );
      if (!input.llm) {
        items = stories.length;
        how = `${stories.length} of ${recent.length} releases have enough text (not classified)`;
      } else {
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
        // Releases past the classification limit count at the rate of the ones checked.
        const rate = checked ? kept / checked : 0;
        items = Math.round(kept + rate * (stories.length - checked));
        how = `${kept} of ${checked} classified releases are about this town${stories.length > checked ? `, ${stories.length - checked} more counted at that rate` : ''}`;
      }
    } else if (ROUNDUP_KINDS.includes(kind)) {
      const weeks = new Set(recent.map((r) => weekKey(r.occurredAt!)));
      items = weeks.size;
      how = `${recent.length} records in ${weeks.size} weeks: one weekly roundup a week`;
    } else {
      how = `${kind} sources don't count toward readiness`;
    }
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
