import { describeSource, sourceHost } from '@towncore/config';
import type { RecordSource, SourceRecord } from '@towncore/db';

// The Sources box (Rule 4; owner, 2026-10-17: "sources that don't swamp the page"): a story's
// records grouped by the source and kind of record they came from, one line each with its date
// range and count, and the "About this data" note for that kind. A group of one record links to
// the record itself, as before; the full list of records stays in the page under "Show all".

export type SourceGroup = {
  key: string;
  /** "Florida Division of Corporations, daily filings". */
  name: string;
  /** The dataset or file the records came from. */
  href: string | null;
  from: Date | null;
  to: Date | null;
  records: SourceRecord[];
  about: string | null;
};

const isHttp = (url: string | null | undefined): url is string => !!url && /^https?:\/\//.test(url);

export function groupSources(
  records: SourceRecord[],
  sources: Pick<RecordSource, 'id' | 'platform' | 'url'>[],
): SourceGroup[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const groups = new Map<string, SourceGroup>();
  for (const record of records) {
    const key = `${record.sourceId}:${record.type}`;
    let group = groups.get(key);
    if (!group) {
      const source = byId.get(record.sourceId);
      const description = describeSource(source?.platform ?? null, record.type);
      const publisher =
        description.publisher ?? sourceHost(source?.url) ?? sourceHost(record.url) ?? null;
      group = {
        key,
        name: publisher ? `${publisher}, ${description.dataset}` : description.dataset,
        href: null,
        from: null,
        to: null,
        records: [],
        about: description.about ?? null,
      };
      groups.set(key, group);
    }
    group.records.push(record);
    const at = record.occurredAt;
    if (at && (!group.from || at < group.from)) group.from = at;
    if (at && (!group.to || at > group.to)) group.to = at;
  }
  for (const group of groups.values()) {
    const urls = [...new Set(group.records.map((r) => r.url).filter(isHttp))];
    const source = byId.get(group.records[0]!.sourceId);
    // One file for every record links to it; otherwise the source's own page, else the first.
    group.href =
      urls.length === 1 ? urls[0]! : isHttp(source?.url) ? source.url : (urls[0] ?? null);
  }
  return [...groups.values()];
}

const AP_MONTHS = [
  'Jan.',
  'Feb.',
  'March',
  'April',
  'May',
  'June',
  'July',
  'Aug.',
  'Sept.',
  'Oct.',
  'Nov.',
  'Dec.',
];

/** "Oct. 5, 2026" for one record, read like formatRange (date-only records in UTC). */
export function formatDay(d: Date, timeZone: string): string {
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: dateOnly ? 'UTC' : timeZone,
    year: 'numeric',
  }).format(d);
  return `${formatRange(d, d, timeZone)}, ${year}`;
}

/**
 * "Oct. 5–11" for a group's dates. Date-only records (filings, licenses, sales) are stored at
 * UTC midnight, so a range of those is read in UTC; anything else in the town's time zone.
 */
export function formatRange(from: Date | null, to: Date | null, timeZone: string): string | null {
  if (!from || !to) return null;
  const dateOnly = [from, to].every(
    (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0,
  );
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: dateOnly ? 'UTC' : timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return { y: get('year'), m: get('month'), d: get('day') };
  };
  const a = parts(from);
  const b = parts(to);
  const day = (x: typeof a) => `${AP_MONTHS[x.m - 1]} ${x.d}`;
  const year = a.y !== b.y ? `, ${a.y}` : '';
  if (a.y === b.y && a.m === b.m && a.d === b.d) return day(a);
  if (a.y === b.y && a.m === b.m) return `${day(a)}–${b.d}`;
  return `${day(a)}${year}–${day(b)}${year ? `, ${b.y}` : ''}`;
}
