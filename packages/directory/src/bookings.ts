import { zonedTimeToUtc } from '@towncore/adapters';
import { directoryProducts, type BookingPeriod, type DirectoryProduct } from '@towncore/config';
import { and, eq, gt, inArray, isNotNull, ne, or, placements, type Db } from '@towncore/db';
import { PENDING_HOLD_MS } from './stripe/checkout';

// Dated bookings (owner, 2026-10-17): a week of the newsletter's top sponsor slot, or a month of
// a directory category's sponsorship, paid once through Checkout. One business per period (per
// category for a category sponsorship). Only periods that haven't started are sold, since a
// sponsor card needs staff approval before it shows (D-M6-7).

/** Weeks and months offered ahead. */
export const BOOKING_HORIZON: Record<BookingPeriod, number> = { week: 8, month: 4 };

export type BookingWindow = {
  /** The first local day, YYYY-MM-DD: the placement's `period`. */
  start: string;
  startsAt: Date;
  endsAt: Date;
  label: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function localToday(now: Date, timeZone: string): Date {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const midnight = (day: Date, timeZone: string) =>
  zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0, 0, timeZone);

const fmt = (day: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(day);

/** The window that starts on a local day (a Monday, or the 1st). */
export function bookingWindow(
  period: BookingPeriod,
  start: string,
  timeZone: string,
): BookingWindow {
  const first = new Date(`${start}T00:00:00Z`);
  const after =
    period === 'week'
      ? new Date(first.getTime() + 7 * 86_400_000)
      : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const last = new Date(after.getTime() - 86_400_000);
  return {
    start,
    startsAt: midnight(first, timeZone),
    endsAt: midnight(after, timeZone),
    label:
      period === 'week'
        ? `Week of ${fmt(first, { month: 'short', day: 'numeric' })}–${fmt(last, first.getUTCMonth() === last.getUTCMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`
        : fmt(first, { month: 'long', year: 'numeric' }),
  };
}

/** The next weeks (from next Monday) or months (from next month) in the town's time. */
export function upcomingWindows(
  period: BookingPeriod,
  now: Date,
  timeZone: string,
  count = BOOKING_HORIZON[period],
): BookingWindow[] {
  const today = localToday(now, timeZone);
  // Days from today to next Monday (a Monday counts the one after).
  const toMonday = (8 - today.getUTCDay()) % 7 || 7;
  const out: BookingWindow[] = [];
  for (let i = 1; i <= count; i++) {
    const first =
      period === 'week'
        ? new Date(today.getTime() + (toMonday + (i - 1) * 7) * 86_400_000)
        : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
    out.push(bookingWindow(period, ymd(first), timeZone));
  }
  return out;
}

/** Periods already sold (or held by a Checkout started in the last hour) for a product. */
export async function bookedPeriods(
  db: Db,
  townId: string,
  product: DirectoryProduct,
  category: string | null,
  now = new Date(),
  excludeId?: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ period: placements.period })
    .from(placements)
    .where(
      and(
        eq(placements.townId, townId),
        eq(placements.product, product),
        isNotNull(placements.period),
        category ? eq(placements.category, category) : undefined,
        excludeId ? ne(placements.id, excludeId) : undefined,
        or(
          inArray(placements.status, ['active', 'held']),
          and(
            eq(placements.status, 'pending'),
            gt(placements.createdAt, new Date(now.getTime() - PENDING_HOLD_MS)),
          ),
        ),
      ),
    );
  return new Set(rows.map((r) => r.period!));
}

/** Upcoming windows nobody has booked. */
export async function openWindows(
  db: Db,
  input: { townId: string; timezone: string; product: DirectoryProduct; category: string | null },
  now = new Date(),
): Promise<BookingWindow[]> {
  const period = directoryProducts[input.product].period;
  if (!period) return [];
  const taken = await bookedPeriods(db, input.townId, input.product, input.category, now);
  return upcomingWindows(period, now, input.timezone).filter((w) => !taken.has(w.start));
}

/** A business's own bookings that haven't ended, soonest first. */
export async function upcomingBookings(
  db: Db,
  businessId: string,
  product: DirectoryProduct,
  timeZone: string,
  now = new Date(),
) {
  const period = directoryProducts[product].period;
  if (!period) return [];
  const rows = await db
    .select({ id: placements.id, status: placements.status, period: placements.period })
    .from(placements)
    .where(
      and(
        eq(placements.businessId, businessId),
        eq(placements.product, product),
        inArray(placements.status, ['active', 'held']),
        isNotNull(placements.period),
        gt(placements.endsAt, now),
      ),
    )
    .orderBy(placements.period);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    window: bookingWindow(period, r.period!, timeZone),
  }));
}
