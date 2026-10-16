import { loadEnv } from '@towncore/config';
import { zonedTimeToUtc } from '../lib/ical';
import { cell, fieldMap, fillTemplate, rowText, rowType, type Row } from '../lib/rows';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// Socrata / Tyler Data & Insights open data portals (CLAUDE.md §9: one adapter for every city,
// county and state portal on the platform), through the documented SODA API:
//   GET https://{domain}/resource/{dataset}.json?$where=…&$order=…&$limit=…
// robots.txt on these portals (verified on Chicago, Orlando, NYC and San Francisco, 2026-10-16)
// leaves /resource/ open and asks Crawl-delay: 1, which the Fetcher honors. One source per
// dataset, with a field map, since every portal names its columns differently.
//
// Source: url = the dataset's API address (https://data.city.gov/resource/abcd-1234.json).
// Config:
//   dateField: 'issue_date'            — required: what "new" means, and the record's date
//   idField: 'permit_number'           — default: the row's Socrata :id
//   title: '{permit_type} at {address}'— default: the first text column
//   fields: { col: 'Label', … }        — what goes in the record text (default: every column)
//   where: "city = 'ORLANDO'"          — extra SoQL filter, ANDed
//   linkField: 'url'                   — a column holding the row's own page, if any
//   type: 'permit'                     — default from the source kind
//   timezone: 'America/New_York'       — for the portal's floating timestamps
//   days: 30                           — how far back the first run looks

type Options = {
  domain: string;
  dataset: string;
  dateField: string;
  idField: string | null;
  title: string | null;
  fields: Record<string, string> | null;
  where: string | null;
  linkField: string | null;
  type: unknown;
  timezone: string;
  days: number;
};

/** Most rows read in one run; a busy dataset is read again next run from the newest date. */
const LIMIT = 1000;
const SOCRATA_FIELD = /^[:@]?[A-Za-z_][\w]*$/;

export function parseDatasetUrl(url: string): { domain: string; dataset: string } | null {
  const m =
    /^https:\/\/([^/]+)\/(?:resource|api\/views|d)\/([a-z0-9]{4}-[a-z0-9]{4})(?:\.json)?/i.exec(
      url,
    );
  return m ? { domain: m[1]!.toLowerCase(), dataset: m[2]!.toLowerCase() } : null;
}

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  const parsed = source.url ? parseDatasetUrl(source.url) : null;
  if (!parsed) {
    throw new Error(
      `socrata source ${source.id} needs url https://{domain}/resource/{dataset-id}.json`,
    );
  }
  const str = (k: string) => (typeof c[k] === 'string' && c[k] ? (c[k] as string) : null);
  const dateField = str('dateField');
  if (!dateField || !SOCRATA_FIELD.test(dateField)) {
    throw new Error(`socrata source ${source.id} needs config.dateField (a column name)`);
  }
  const idField = str('idField');
  if (idField && !SOCRATA_FIELD.test(idField)) throw new Error(`socrata: bad idField ${idField}`);
  return {
    ...parsed,
    dateField,
    idField,
    title: str('title'),
    fields: fieldMap(c.fields),
    where: str('where'),
    linkField: str('linkField'),
    type: c.type,
    timezone: str('timezone') ?? 'America/New_York',
    days: Number(c.days) > 0 ? Number(c.days) : 30,
  };
}

/** Socrata floating timestamp ("2026-10-15T13:30:00.000") in the portal's local time → Date. */
export function socrataDate(value: unknown, timeZone: string): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return zonedTimeToUtc(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), timeZone);
}

/** A Date as a floating timestamp in the portal's local time, for SoQL comparisons. */
function floating(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function queryUrl(opts: Options, since: Date, limit = LIMIT): string {
  const where = [`${opts.dateField} > '${floating(since, opts.timezone)}'`, opts.where]
    .filter(Boolean)
    .map((w) => `(${w})`)
    .join(' AND ');
  const params = new URLSearchParams({
    $select: '*, :id',
    $where: where,
    $order: `${opts.dateField} DESC`,
    $limit: String(limit),
  });
  return `https://${opts.domain}/resource/${opts.dataset}.json?${params.toString()}`;
}

function headers(): Record<string, string> {
  // An optional free app token raises the portal's throttling limits; never required.
  const token = loadEnv().SOCRATA_APP_TOKEN;
  return token ? { 'x-app-token': token } : {};
}

function firstText(row: Row): string | null {
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(':')) continue;
    const text = cell(v);
    if (text && /[A-Za-z]/.test(text) && text.length > 3) return text;
  }
  return null;
}

export function socrataRecord(row: Row, opts: Options, kind: SourceConfig['kind']): RawRecord {
  const id = cell(opts.idField ? row[opts.idField] : row[':id']) ?? cell(row[':id']);
  const link = opts.linkField ? cell(row[opts.linkField]) : null;
  const linkUrl =
    link && /^https?:\/\//.test(link) ? link : `https://${opts.domain}/d/${opts.dataset}`;
  return {
    externalId: `row:${id ?? JSON.stringify(row).slice(0, 80)}`,
    type: rowType(kind, opts.type),
    title: (opts.title ? fillTemplate(opts.title, row) : firstText(row)) || null,
    text: rowText(row, opts.fields) || null,
    url: linkUrl,
    occurredAt: socrataDate(row[opts.dateField], opts.timezone),
    raw: row,
  };
}

async function fetchRows(opts: Options, since: Date, ctx: AdapterContext, limit?: number) {
  return ctx.fetcher.getJson<Row[]>(queryUrl(opts, since, limit), headers());
}

export const socrataAdapter: SourceAdapter = {
  platform: 'socrata',
  kinds: [
    'permits',
    'inspections',
    'police',
    'fire',
    'property_sales',
    'business_filings',
    'events',
  ],

  async detect(url, html) {
    if (parseDatasetUrl(url)) return 0.95;
    if (/socrata|Data\s*&(?:amp;)?\s*Insights|\/api\/views\//i.test(html)) return 0.7;
    return 0;
  },

  async fetch(source, since, ctx) {
    const opts = options(source);
    const from = since ?? new Date(ctx.now.getTime() - opts.days * 86_400_000);
    const rows = await fetchRows(opts, from, ctx);
    return rows.map((row) => socrataRecord(row, opts, source.kind));
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      await fetchRows(opts, new Date(ctx.now.getTime() - 365 * 86_400_000), ctx, 1);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
