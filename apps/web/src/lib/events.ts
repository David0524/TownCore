// Events from the town's official calendars (CivicPlus calendars of community events, nature
// centers, museums and theaters; the `events` source kind). Every event links to the city's own
// page for it.

/**
 * "Children's Science Explorium - 300 South Military Trail BOCA RATON FL 33486" → the venue and
 * its street. The town, state and ZIP are dropped: every event is in town. A location with no
 * " - " is the venue alone (or a bare street, shown as is).
 */
export function splitLocation(
  location: string | null | undefined,
  townName: string,
): {
  venue: string | null;
  street: string | null;
} {
  const text = location
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { venue: null, street: null };
  const at = text.indexOf(' - ');
  const venue = at > 0 ? text.slice(0, at).trim() : text;
  const rest = at > 0 ? text.slice(at + 3).trim() : '';
  const town = townName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const street = rest
    .replace(new RegExp(`,?\\s+${town},?\\s+[A-Z]{2},?\\s+\\d{5}(-\\d{4})?$`, 'i'), '')
    .trim();
  // Some locations repeat the street ("1801 North Ocean Blvd 1801 N Ocean Blvd"): keep the first.
  const first = street.split(/\s+(?=\d+\s)/)[0]!.trim();
  return { venue: venue || null, street: first || null };
}

/**
 * Two calendars often list the same event; keep one per title and start. With `oncePerTitle`,
 * a recurring class or program shows only at its next date (events must be soonest first).
 */
export function dedupeEvents<T extends { title: string; when: Date }>(
  events: T[],
  { oncePerTitle = false }: { oncePerTitle?: boolean } = {},
): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const title = e.title.trim().toLowerCase();
    const key = oncePerTitle ? title : `${title}|${e.when.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Event detail pages (/events/<slug>) and their "Add to calendar" file (/events/<slug>/ics).

const slugWords = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'event';

/** "2026-10-20": the local date in the town. */
export function localIsoDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * An event's address on our site, stable for the life of its record:
 * "sample-nature-walk-2026-10-20-1a2b3c4d". The title and local date are for readers; the last
 * part is the start of the record's id, which is what the page looks the event up by, so a
 * calendar that edits a title changes only the words (the old address redirects).
 */
export function eventSlug(event: { id: string; title: string; when: Date }, timeZone: string) {
  return `${slugWords(event.title)}-${localIsoDate(event.when, timeZone)}-${event.id.slice(0, 8).toLowerCase()}`;
}

/** The record-id prefix at the end of an event slug, or null when the slug isn't one of ours. */
export function eventIdPrefix(slug: string): string | null {
  return /-\d{4}-\d{2}-\d{2}-([0-9a-f]{8})$/.exec(slug.toLowerCase())?.[1] ?? null;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': '’',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&ndash;': '–',
  '&mdash;': '—',
  '&lt;': '<',
  '&gt;': '>',
};

/**
 * The official calendar's description as plain paragraphs: tags and entities dropped, and a
 * line that is only a link left out (the page links the calendar's own page for the event).
 */
export function eventDescription(text: string | null | undefined): string[] {
  if (!text) return [];
  const plain = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\r\n?/g, '\n');
  return plain
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line) => line && !/^([a-z ]{0,30}:\s*)?https?:\/\/\S+$/i.test(line))
        .join(' '),
    )
    .filter(Boolean);
}

/** A description at least this long makes an event page worth listing in search. */
export const EVENT_INDEX_MIN_CHARS = 200;

function clock(instant: Date, timeZone: string): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const pm = get('dayPeriod').toLowerCase().startsWith('p');
  if (get('hour') === '12' && get('minute') === '00')
    return { time: pm ? 'noon' : 'midnight', period: '' };
  return {
    time: get('minute') === '00' ? get('hour') : `${get('hour')}:${get('minute')}`,
    period: pm ? 'p.m.' : 'a.m.',
  };
}

/** "6 p.m.", "6:30 p.m.", "noon" (AP style), in the town's timezone. */
export function apTime(instant: Date, timeZone: string): string {
  const c = clock(instant, timeZone);
  return c.period ? `${c.time} ${c.period}` : c.time;
}

/**
 * An event's hours in AP style: "6 to 7:30 p.m.", "10 a.m. to 2 p.m.", "noon to 1 p.m.", "All
 * day". An end on another local day, or none, shows the start alone.
 */
export function apTimeRange(
  event: { when: Date; end: Date | null; allDay: boolean },
  timeZone: string,
): string {
  if (event.allDay) return 'All day';
  const end =
    event.end &&
    event.end.getTime() > event.when.getTime() &&
    localIsoDate(event.end, timeZone) === localIsoDate(event.when, timeZone)
      ? event.end
      : null;
  if (!end) return apTime(event.when, timeZone);
  const a = clock(event.when, timeZone);
  const b = clock(end, timeZone);
  const from = a.period && a.period === b.period ? a.time : apTime(event.when, timeZone);
  return `${from} to ${apTime(end, timeZone)}`;
}

/**
 * Whose calendar it is, for "From the City of Boca Raton calendar": on a CivicPlus site (the
 * city's own website) the town's first city, town or village government; any other calendar is
 * named by its host.
 */
export function calendarPublisher(
  agencies: readonly string[] | undefined,
  source: { platform: string | null; url: string | null } | null,
): string | null {
  const government =
    agencies?.find((a) => /^(city|town|village|borough|township) of /i.test(a)) ?? null;
  if (source?.platform === 'civicplus' && government) return government;
  try {
    if (source?.url) return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    // Not a URL: fall through.
  }
  return government;
}
