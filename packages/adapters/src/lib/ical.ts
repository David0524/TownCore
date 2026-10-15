// Minimal iCalendar (RFC 5545) reader: enough for municipal calendar exports (VEVENTs with
// SUMMARY, DTSTART/DTEND, LOCATION, DESCRIPTION, UID, URL). No dependency needed.

export type IcalEvent = {
  uid: string;
  summary: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string | null;
  lastModified: Date | null;
};

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseLine(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [head, ...paramParts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const [k, v] = part.split('=');
    if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: head!.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** Converts a wall-clock time in an IANA zone to the UTC instant. */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
      +parts.second!,
    );
    return asUtc - instant;
  };
  // Two passes handle DST transitions.
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return new Date(instant);
}

function parseDate(
  prop: Prop | undefined,
  defaultZone: string,
): { date: Date | null; allDay: boolean } {
  if (!prop) return { date: null, allDay: false };
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value.trim());
  if (!m) return { date: null, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined)
    return {
      date: zonedTimeToUtc(+y!, +mo!, +d!, 0, 0, 0, prop.params.TZID ?? defaultZone),
      allDay: true,
    };
  if (z) return { date: new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!, +s!)), allDay: false };
  return {
    date: zonedTimeToUtc(+y!, +mo!, +d!, +h, +mi!, +s!, prop.params.TZID ?? defaultZone),
    allDay: false,
  };
}

/** Parses VEVENTs. Floating times (no TZID) are read in `defaultZone` (the town's timezone). */
export function parseIcal(text: string, defaultZone: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let current: Map<string, Prop> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') current = new Map();
    else if (line === 'END:VEVENT' && current) {
      const get = (name: string) => current!.get(name);
      const start = parseDate(get('DTSTART'), defaultZone);
      const uid = get('UID')?.value.trim();
      if (uid) {
        events.push({
          uid,
          summary: unescapeText(get('SUMMARY')?.value ?? ''),
          start: start.date,
          end: parseDate(get('DTEND'), defaultZone).date,
          allDay: start.allDay,
          location: get('LOCATION')
            ? unescapeText(get('LOCATION')!.value).replace(/\s{2,}/g, ' ')
            : null,
          description: get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value) : null,
          url: get('URL')?.value.trim() ?? null,
          lastModified: parseDate(get('LAST-MODIFIED'), defaultZone).date,
        });
      }
      current = null;
    } else if (current) {
      const prop = parseLine(line);
      if (prop && !current.has(prop.name)) current.set(prop.name, prop);
    }
  }
  return events;
}
