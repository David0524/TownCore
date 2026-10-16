import {
  beats,
  imageDefaults,
  roundupImageDefaults,
  type DailyCountsSpec,
  type ImageKind,
  type ImageSpec,
} from '@towncore/config';
import {
  articles,
  eq,
  images,
  inArray,
  records,
  storyCandidates,
  towns,
  type Db,
} from '@towncore/db';
import { apDate, isoLocalDate, localMidnight } from './time';

// The image router (CLAUDE.md §11c; docs/plans/M4.md §3). For each article it takes the first
// option on the beat's list that it can build and records the choice; it always ends at the
// typographic card, so every article has a visual. Generated visuals are drawn by us from the
// article's own text and records: no photos from other sites, no image model.

/** Options the router can build today. Maps arrive with M4 PR E, photos with M9. */
const BUILDABLE = new Set<ImageKind>(['data-graphic', 'typographic-card']);

/** What a roundup's main record type counts, singular and plural. */
export const recordCountLabels: Record<string, [string, string]> = {
  'new-filing': ['new business filing', 'new business filings'],
  license: ['new contractor license', 'new contractor licenses'],
  meeting: ['public meeting', 'public meetings'],
};

/** A data graphic needs at least this many records over at least two days; fewer read better
 * as the card's single figure. */
const MIN_RECORDS = 5;
const MAX_DAYS = 14;

export type ImageChoice = {
  kind: ImageKind;
  spec: ImageSpec;
  alt: string;
  license: string;
  attribution: string | null;
  sourceUrl: string | null;
};

type ArticleForImage = {
  headline: string;
  beat: string;
  kind: string;
  sourceRecordIds: string[];
};

/** The beat's list of options, roundups first trying a data graphic. */
export function imageOptions(article: Pick<ArticleForImage, 'beat' | 'kind'>): ImageKind[] {
  const list =
    article.kind === 'roundup'
      ? roundupImageDefaults
      : (imageDefaults[article.kind === 'guide' ? 'guide' : article.beat] ?? ['typographic-card']);
  return list.includes('typographic-card') ? [...list] : [...list, 'typographic-card'];
}

/**
 * Counts per local day of the article's own records of its main type, with empty days filled
 * in. Null when there's too little for a chart (fewer than 5 records, one day, or over 14 days).
 */
export function dailyCounts(
  rows: Array<{ type: string; occurredAt: Date | null }>,
  timeZone: string,
): DailyCountsSpec | null {
  const byType = new Map<string, Date[]>();
  for (const row of rows) {
    if (!row.occurredAt || !recordCountLabels[row.type]) continue;
    byType.set(row.type, [...(byType.get(row.type) ?? []), row.occurredAt]);
  }
  const [type, dates] = [...byType].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!type || !dates || dates.length < MIN_RECORDS) return null;
  const counts = new Map<string, number>();
  for (const d of dates) {
    const day = calendarDay(d, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort();
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const bars: DailyCountsSpec['bars'] = [];
  for (let day = first; day <= last; day = nextDay(day)) {
    bars.push({ date: day, count: counts.get(day) ?? 0 });
    if (bars.length > MAX_DAYS) return null;
  }
  if (bars.length < 2) return null;
  return { type: 'daily-counts', label: recordCountLabels[type]![1], bars, total: dates.length };
}

/**
 * The record's day. State filings and licenses carry a date, not a time, stored as midnight UTC;
 * read in the town's zone that would land on the day before, so they count by their UTC date.
 */
function calendarDay(d: Date, timeZone: string): string {
  const dateOnly =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return dateOnly ? d.toISOString().slice(0, 10) : isoLocalDate(d, timeZone);
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Oct. 5" for an ISO local date in the town's zone. */
function dayLabel(iso: string, timeZone: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return apDate(
    new Date(localMidnight({ y: y!, m: m!, d: d! }, timeZone).getTime() + 12 * 3_600_000),
    timeZone,
  );
}

/** Alt text written from the data the chart shows, every value included. */
export function dailyCountsAlt(spec: DailyCountsSpec, timeZone: string): string {
  const first = dayLabel(spec.bars[0]!.date, timeZone);
  const last = dayLabel(spec.bars[spec.bars.length - 1]!.date, timeZone);
  const values = spec.bars.map((b) => `${dayLabel(b.date, timeZone)}, ${b.count}`).join('; ');
  return `Bar chart of ${spec.label} by day, ${first} to ${last}: ${values}. Total ${spec.total}.`;
}

export function cardAlt(article: Pick<ArticleForImage, 'headline' | 'beat'>): string {
  const label = beats.find((b) => b.slug === article.beat)?.label ?? 'News';
  return `Title card with the headline “${article.headline}” and the ${label} section mark.`;
}

const OWN_WORK = 'own-work';

/** Picks the article's visual: the first option on its list that can be built. */
export async function chooseArticleImage(
  db: Db,
  article: ArticleForImage,
  timeZone: string,
): Promise<ImageChoice> {
  for (const option of imageOptions(article)) {
    if (!BUILDABLE.has(option)) continue;
    if (option === 'data-graphic' && article.sourceRecordIds.length >= MIN_RECORDS) {
      const rows = await db
        .select({ type: records.type, occurredAt: records.occurredAt })
        .from(records)
        .where(inArray(records.id, article.sourceRecordIds));
      const spec = dailyCounts(rows, timeZone);
      if (spec) {
        return {
          kind: 'data-graphic',
          spec,
          alt: dailyCountsAlt(spec, timeZone),
          license: OWN_WORK,
          attribution: null,
          sourceUrl: null,
        };
      }
    }
    if (option === 'typographic-card') break;
  }
  return {
    kind: 'typographic-card',
    spec: { type: 'card' },
    alt: cardAlt(article),
    license: OWN_WORK,
    attribution: null,
    sourceUrl: null,
  };
}

/** Chooses and records an article's visual (idempotent: re-running replaces the choice). */
export async function assignArticleImage(db: Db, articleId: string): Promise<ImageChoice> {
  const [row] = await db
    .select({ article: articles, timezone: towns.timezone, candidateKind: storyCandidates.kind })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .leftJoin(storyCandidates, eq(storyCandidates.id, articles.candidateId))
    .where(eq(articles.id, articleId));
  if (!row) throw new Error(`Unknown article ${articleId}`);
  // Articles written before `articles.kind` existed are roundups if their candidate was.
  const kind = row.candidateKind === 'roundup' ? 'roundup' : row.article.kind;
  const choice = await chooseArticleImage(db, { ...row.article, kind }, row.timezone);
  const values = { ...choice, articleId, aiGenerated: false, updatedAt: new Date() };
  await db
    .insert(images)
    .values(values)
    .onConflictDoUpdate({ target: images.articleId, set: values });
  return choice;
}
