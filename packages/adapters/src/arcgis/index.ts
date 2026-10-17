import { cell, fieldMap, fillTemplate, rowText, rowType, type Row } from '../lib/rows';
import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// ArcGIS REST feature layers (CLAUDE.md §9): the GIS server most US counties and cities use to
// publish permits, code cases, development applications and road closures, on ArcGIS Online
// (services{n}.arcgis.com) or their own servers (gis.{city}.gov/server/rest/services). Documented
// REST API: {layer}/query?where=…&outFields=*&f=json. robots.txt (checked 2026-10-16): ArcGIS
// Online service hosts answer 403 and self-hosted servers 404, both "no rules"; Hub catalog pages
// (Crawl-delay 60, /sites/ disallowed) are never fetched. One source per layer, with a field map.
//
// Source: url = the layer (…/FeatureServer/0 or …/MapServer/3).
// Config:
//   dateField: 'SUBMITDT'          — required: a date column; what "new" means
//   idField: 'CASEKEY'             — a unique column; default: GlobalID, else the object ID
//   title: '{PERMITTYPE} at {FULLADDR}'
//   fields: { COLUMN: 'Label', … } — what goes in the record text (default: every column)
//   where: "PERMITSTAT = 'ISSUED'" — extra filter, ANDed
//   outFields: ['PARCEL', …]       — only these columns are requested and stored (default: all).
//                                    Use it to keep private people's names (property owners)
//                                    out of our database entirely.
//   lagDays: 21                    — re-read this many days before the last run, for layers whose
//                                    records appear after their date (deeds are recorded ~10 days
//                                    after a sale); records already stored are deduped
//   linkField, type, days         — as for the Socrata adapter

type Options = {
  layer: string;
  dateField: string;
  idField: string | null;
  title: string | null;
  fields: Record<string, string> | null;
  where: string | null;
  linkField: string | null;
  outFields: string[] | null;
  lagDays: number;
  type: unknown;
  days: number;
};

type QueryResponse = {
  objectIdFieldName?: string;
  fields?: { name: string; type: string }[];
  features?: { attributes: Row }[];
  error?: { code?: number; message?: string };
};

const LIMIT = 1000;
const FIELD = /^[A-Za-z_][\w]*$/;
const LAYER = /^https:\/\/[^/]+\/.*\/rest\/services\/.+\/(?:FeatureServer|MapServer)\/\d+$/i;

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  const layer = source.url?.replace(/\/+$/, '').replace(/\/query$/i, '') ?? '';
  if (!LAYER.test(layer)) {
    throw new Error(
      `arcgis source ${source.id} needs url …/rest/services/{service}/FeatureServer/{layer}`,
    );
  }
  const str = (k: string) => (typeof c[k] === 'string' && c[k] ? (c[k] as string) : null);
  const dateField = str('dateField');
  if (!dateField || !FIELD.test(dateField)) {
    throw new Error(`arcgis source ${source.id} needs config.dateField (a date column)`);
  }
  const idField = str('idField');
  if (idField && !FIELD.test(idField)) throw new Error(`arcgis: bad idField ${idField}`);
  const outFields = Array.isArray(c.outFields) ? c.outFields.map(String) : null;
  const badField = outFields?.find((f) => !FIELD.test(f));
  if (badField) throw new Error(`arcgis: bad outFields column ${badField}`);
  return {
    layer,
    dateField,
    idField,
    title: str('title'),
    fields: fieldMap(c.fields),
    where: str('where'),
    linkField: str('linkField'),
    // The id and date columns are always requested, so records stay keyed and dated.
    outFields: outFields
      ? [...new Set([...outFields, dateField, ...(idField ? [idField] : [])])]
      : null,
    lagDays: Number(c.lagDays) > 0 ? Number(c.lagDays) : 0,
    type: c.type,
    days: Number(c.days) > 0 ? Number(c.days) : 30,
  };
}

/** ArcGIS date literal (UTC): timestamp 'YYYY-MM-DD HH:MM:SS'. */
const timestamp = (d: Date) => `timestamp '${d.toISOString().slice(0, 19).replace('T', ' ')}'`;

export function arcgisQueryUrl(opts: Options, since: Date, limit = LIMIT): string {
  const where = [`${opts.dateField} > ${timestamp(since)}`, opts.where]
    .filter(Boolean)
    .map((w) => `(${w})`)
    .join(' AND ');
  const params = new URLSearchParams({
    where,
    outFields: opts.outFields?.join(',') ?? '*',
    orderByFields: `${opts.dateField} DESC`,
    resultRecordCount: String(limit),
    returnGeometry: 'false',
    f: 'json',
  });
  return `${opts.layer}/query?${params.toString()}`;
}

async function query(opts: Options, since: Date, ctx: AdapterContext, limit?: number) {
  const body = await ctx.fetcher.getJson<QueryResponse>(arcgisQueryUrl(opts, since, limit));
  // ArcGIS reports query errors in a 200 response.
  if (body.error) throw new Error(`ArcGIS query failed: ${body.error.message ?? body.error.code}`);
  return body;
}

export function arcgisRecords(
  body: QueryResponse,
  opts: Options,
  kind: SourceConfig['kind'],
): RawRecord[] {
  const dates = new Set(
    (body.fields ?? []).filter((f) => f.type === 'esriFieldTypeDate').map((f) => f.name),
  );
  dates.add(opts.dateField);
  // Date columns are epoch milliseconds: show them as YYYY-MM-DD (UTC).
  const asRow = (attributes: Row): Row =>
    Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [
        k,
        dates.has(k) && typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : v,
      ]),
    );
  // GlobalID survives a layer being republished; OBJECTID may not.
  const hasGlobalId = (body.fields ?? []).some((f) => f.type === 'esriFieldTypeGlobalID');
  const idField =
    opts.idField ?? (hasGlobalId ? 'GlobalID' : (body.objectIdFieldName ?? 'OBJECTID'));
  return (body.features ?? []).map(({ attributes }) => {
    const row = asRow(attributes);
    const when = attributes[opts.dateField];
    const link = opts.linkField ? cell(row[opts.linkField]) : null;
    return {
      externalId: `feature:${cell(attributes[idField]) ?? cell(attributes.OBJECTID) ?? JSON.stringify(attributes).slice(0, 80)}`,
      type: rowType(kind, opts.type),
      title: (opts.title ? fillTemplate(opts.title, row) : null) || null,
      text: rowText(row, opts.fields) || null,
      url: link && /^https?:\/\//.test(link) ? link : opts.layer,
      occurredAt: typeof when === 'number' ? new Date(when) : null,
      raw: attributes,
    };
  });
}

export const arcgisAdapter: SourceAdapter = {
  platform: 'arcgis',
  kinds: ['permits', 'inspections', 'police', 'fire', 'property_sales', 'events', 'city_news'],

  async detect(url, html) {
    if (/\/rest\/services\/.+\/(FeatureServer|MapServer)/i.test(url)) return 0.95;
    if (/arcgis\.com\/(apps|home)\/|\/arcgis\/rest\/services\//i.test(html)) return 0.5;
    return 0;
  },

  async fetch(source, since, ctx) {
    const opts = options(source);
    const from = since
      ? new Date(since.getTime() - opts.lagDays * 86_400_000)
      : new Date(ctx.now.getTime() - opts.days * 86_400_000);
    return arcgisRecords(await query(opts, from, ctx), opts, source.kind);
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      await query(opts, new Date(ctx.now.getTime() - 365 * 86_400_000), ctx, 1);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
