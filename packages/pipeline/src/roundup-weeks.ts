import { and, eq, gte, inArray, lt, records, sql, type Db } from '@towncore/db';
import { isIssuedLicense, roundupUnits, type RoundupKind } from './templates';
import { isoLocalDate } from './time';

// Which records a weekly roundup covers, in one place: the story finder uses it to build this
// week's roundup, and the writer uses it to count the same kind of thing in the town's own past
// weeks ("17 sales, up from 12 the week before"), so the comparison counts exactly what the
// roundup counts.

const DAY = 86_400_000;

/** A UTC-midnight range covering the local calendar week, for date-only record fields. */
export function dateOnlyWeek(weekStart: Date, timeZone: string): [Date, Date] {
  const [y, m, d] = isoLocalDate(weekStart, timeZone).split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d!));
  return [start, new Date(start.getTime() + 7 * DAY)];
}

export async function townRecords(
  db: Db,
  townId: string,
  types: string | string[],
  from: Date,
  to: Date,
  by: 'occurredAt' | 'createdAt' = 'occurredAt',
): Promise<(typeof records.$inferSelect)[]> {
  return db
    .select()
    .from(records)
    .where(
      and(
        eq(records.townId, townId),
        Array.isArray(types) ? inArray(records.type, types) : eq(records.type, types),
        gte(records[by], from),
        lt(records[by], to),
      ),
    );
}

/**
 * Record types each roundup reads, and whether their dates are date-only (UTC midnight). `by:
 * 'createdAt'` rounds up what was first read that week instead: for data published months after
 * the fact (CMS's monthly nursing-home release), where last week's dates are never in yet.
 */
const SPEC: Record<
  RoundupKind,
  { types: string[]; dateOnly: boolean; by?: 'occurredAt' | 'createdAt' }
> = {
  meetings: { types: ['meeting'], dateOnly: false },
  'new-businesses': { types: ['new-filing'], dateOnly: true },
  'new-licenses': { types: ['license'], dateOnly: true },
  'new-places': { types: ['new_food_license', 'liquor_license'], dateOnly: true },
  permits: { types: ['permit'], dateOnly: false },
  sales: { types: ['sale'], dateOnly: true },
  inspections: { types: ['inspection'], dateOnly: true },
  roads: { types: ['road-work'], dateOnly: false },
  federal: { types: ['federal-award'], dateOnly: true },
  'nursing-homes': {
    types: ['nursing-home-inspection', 'nursing-home-penalty'],
    dateOnly: false,
    by: 'createdAt',
  },
};

/** The records a roundup of this kind covers for the local week starting `weekStart`. */
export async function roundupWeekRecords(
  db: Db,
  town: { id: string; timezone: string },
  kind: RoundupKind,
  weekStart: Date,
  opts: { from?: Date } = {},
) {
  const spec = SPEC[kind];
  const [from, to] = spec.dateOnly
    ? dateOnlyWeek(weekStart, town.timezone)
    : [
        opts.from && opts.from > weekStart ? opts.from : weekStart,
        new Date(weekStart.getTime() + 7 * DAY),
      ];
  const rows = await townRecords(db, town.id, spec.types, from, to, spec.by);
  return kind === 'new-licenses' ? rows.filter((r) => isIssuedLicense(r.raw)) : rows;
}

/** How many past weeks a roundup compares itself with. */
export const PAST_WEEKS = 4;

/**
 * The roundup's count (in its own units) for each of the town's past weeks, the week before
 * first. Weeks that start before the town's first record of these types aren't counted: a week
 * we have no data for isn't a week with none.
 */
export async function pastWeekCounts(
  db: Db,
  town: { id: string; timezone: string },
  kind: RoundupKind,
  weekStart: Date,
  weeks = PAST_WEEKS,
): Promise<number[]> {
  const [first] = await db
    .select({ at: sql<Date | string | null>`min(${records[SPEC[kind].by ?? 'occurredAt']})` })
    .from(records)
    .where(and(eq(records.townId, town.id), inArray(records.type, SPEC[kind].types)));
  const since = first?.at ? new Date(first.at) : null;
  const counts: number[] = [];
  for (let k = 1; k <= weeks; k++) {
    const start = new Date(weekStart.getTime() - k * 7 * DAY);
    const [covered] = SPEC[kind].dateOnly ? dateOnlyWeek(start, town.timezone) : [start];
    if (!since || covered < since) break;
    counts.push(roundupUnits(kind, await roundupWeekRecords(db, town, kind, start)));
  }
  return counts;
}
