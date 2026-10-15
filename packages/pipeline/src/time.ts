import { zonedTimeToUtc } from '@towncore/adapters';

// Local-calendar helpers: stories and budgets follow the town's own day and week.

export type LocalDate = { y: number; m: number; d: number; weekday: number };

/** The calendar date at `instant` in `timeZone`; weekday 0 = Sunday. */
export function localDate(instant: Date, timeZone: string): LocalDate {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!),
  };
}

/** Midnight in `timeZone` on the given local date (days may be out of range; they roll over). */
export function localMidnight(date: { y: number; m: number; d: number }, timeZone: string): Date {
  const rolled = new Date(Date.UTC(date.y, date.m - 1, date.d));
  return zonedTimeToUtc(
    rolled.getUTCFullYear(),
    rolled.getUTCMonth() + 1,
    rolled.getUTCDate(),
    0,
    0,
    0,
    timeZone,
  );
}

export function startOfLocalDay(instant: Date, timeZone: string): Date {
  return localMidnight(localDate(instant, timeZone), timeZone);
}

/** Monday 00:00 local of the week containing `instant`, shifted by `weeks`. */
export function localWeekStart(instant: Date, timeZone: string, weeks = 0): Date {
  const today = localDate(instant, timeZone);
  const sinceMonday = (today.weekday + 6) % 7;
  return localMidnight({ y: today.y, m: today.m, d: today.d - sinceMonday + 7 * weeks }, timeZone);
}

/** "2026-10-19" for the local date of `instant`. */
export function isoLocalDate(instant: Date, timeZone: string): string {
  const { y, m, d } = localDate(instant, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "Oct. 19" style (AP), in the town's timezone. */
export function apDate(instant: Date, timeZone: string): string {
  const month = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long' }).format(instant);
  const day = localDate(instant, timeZone).d;
  const short: Record<string, string> = {
    January: 'Jan.',
    February: 'Feb.',
    August: 'Aug.',
    September: 'Sept.',
    October: 'Oct.',
    November: 'Nov.',
    December: 'Dec.',
  };
  return `${short[month] ?? month} ${day}`;
}
