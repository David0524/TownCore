// Times for the weather tile and alert bar, in the town's timezone, AP-ish and short.
import { apDate } from '@towncore/pipeline';

/** "3p", "11a" */
export function shortHour(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: true,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return `${hour}${period.charAt(0).toLowerCase()}`;
}

/** "3:46 p.m." */
export function clockTime(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const period = get('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.';
  return `${get('hour')}:${get('minute')} ${period}`;
}

/** "until 8 p.m." today, "until Fri. 8 p.m." on another day. */
export function untilLabel(iso: string, timeZone: string, now = new Date()): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' }).format(d);
  const when = new Date(iso);
  const time = clockTime(when, timeZone).replace(':00', '');
  if (day(when) === day(now)) return `until ${time}`;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(when);
  return `until ${weekday}. ${time}`;
}

/** "3:46 p.m." today, "Oct. 18, 3:46 p.m." on another day. */
export function updatedLabel(iso: string, timeZone: string, now = new Date()): string {
  const when = new Date(iso);
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' }).format(d);
  if (day(when) === day(now)) return clockTime(when, timeZone);
  return `${apDate(when, timeZone)}, ${clockTime(when, timeZone)}`;
}

/**
 * True when an hourly period is at night: NWS's own flag when stored, else before 6 a.m. or from
 * 7 p.m. in the town (snapshots stored before the flag was kept).
 */
export function isNight(p: { startTime: string; isDaytime?: boolean }, timeZone: string): boolean {
  if (typeof p.isDaytime === 'boolean') return !p.isDaytime;
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
      new Date(p.startTime),
    ),
  );
  return hour < 6 || hour >= 19;
}

/** NWS writes "Chance Showers And Thunderstorms"; we write sentence case. */
export function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
