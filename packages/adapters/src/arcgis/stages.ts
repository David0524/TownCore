import { cell, fieldMap, fillTemplate, rowText, type Row } from '../lib/rows';
import type { AdapterContext, RawRecord, SourceConfig } from '../types';

// Development activity maps on ArcGIS: the projects a city lists as proposed, approved, under
// construction or completed, one feature per project. Cities publish them either as one layer
// per stage (Boca Raton's Development/InfrastructureAlerts MapServer, layers 0–3) or as one
// layer with a status column. Such maps rarely carry a date (Boca's LASTUPDATE is empty), so the
// news is a project appearing or moving to another stage: each project becomes one record per
// stage (`project:<id>:<stage>`), dated when it's first seen there (RawRecord.datedOnSight), and
// the earlier stage's record stays as the source for "was proposed" (pipeline/templates.ts).
//
// Source config (in place of dateField):
//   stages: { '0': proposed, '1': approved, … } — layer id → stage, url = the service
//                                                 (…/MapServer); or with stageField, a column
//                                                 value → stage, url = the layer
//   stageField: 'STATUS'
//   idField: 'GlobalID'           — default GlobalID, which a city's own layers share (Boca's
//                                   object IDs are unique across its four stage layers)
//   caseField: 'CASE_FILE_NUM'    — the city's case number, which ties a project's records together
//   title, fields, where, outFields, linkField, type — as for one layer. List outFields: these
//   layers carry staff names (ASSIGNEDTO, LASTEDITOR), which are never requested.

export const DEVELOPMENT_STAGES = [
  'proposed',
  'approved',
  'under_construction',
  'completed',
] as const;
export type DevelopmentStage = (typeof DEVELOPMENT_STAGES)[number];

/** How each stage reads in a record's text ("Stage: Approved, not yet built"). */
export const STAGE_TEXT: Record<DevelopmentStage, string> = {
  proposed: 'Proposed',
  approved: 'Approved, not yet built',
  under_construction: 'Under construction',
  completed: 'Completed',
};

type StageOptions = {
  service: string;
  /** One query per layer: its url, and the stage of every feature in it (null: stageField). */
  layers: { url: string; stage: DevelopmentStage | null }[];
  stageField: string | null;
  stageValues: Record<string, DevelopmentStage>;
  idField: string;
  caseField: string | null;
  title: string | null;
  fields: Record<string, string> | null;
  where: string | null;
  linkField: string | null;
  outFields: string[] | null;
  type: string;
};

type QueryResponse = {
  features?: { attributes: Row }[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
};

const FIELD = /^[A-Za-z_][\w]*$/;
const SERVICE = /^https:\/\/[^/]+\/.*\/rest\/services\/.+\/(?:FeatureServer|MapServer)$/i;
const LAYER = /^https:\/\/[^/]+\/.*\/rest\/services\/.+\/(?:FeatureServer|MapServer)\/\d+$/i;
const PAGE = 1000;
/** Most pages read per layer: a development map has hundreds of projects, not tens of thousands. */
const MAX_PAGES = 5;

const isStage = (v: unknown): v is DevelopmentStage =>
  typeof v === 'string' && (DEVELOPMENT_STAGES as readonly string[]).includes(v);

export function stageOptions(source: SourceConfig): StageOptions {
  const c = source.config as Record<string, unknown>;
  const str = (k: string) => (typeof c[k] === 'string' && c[k] ? (c[k] as string) : null);
  const url = source.url?.replace(/\/+$/, '').replace(/\/query$/i, '') ?? '';
  const stages = (c.stages ?? {}) as Record<string, unknown>;
  const bad = Object.entries(stages).find(([, v]) => !isStage(v));
  if (bad || Object.keys(stages).length === 0) {
    throw new Error(
      `arcgis source ${source.id}: config.stages maps to ${DEVELOPMENT_STAGES.join(', ')}`,
    );
  }
  const stageField = str('stageField');
  for (const f of [stageField, str('idField'), str('caseField')]) {
    if (f && !FIELD.test(f)) throw new Error(`arcgis: bad column ${f}`);
  }
  const outFields = Array.isArray(c.outFields) ? c.outFields.map(String) : null;
  const badField = outFields?.find((f) => !FIELD.test(f));
  if (badField) throw new Error(`arcgis: bad outFields column ${badField}`);
  const idField = str('idField') ?? 'GlobalID';
  const caseField = str('caseField');
  let layers: StageOptions['layers'];
  if (stageField) {
    if (!LAYER.test(url))
      throw new Error(`arcgis source ${source.id} needs url …/MapServer/{layer}`);
    layers = [{ url, stage: null }];
  } else {
    if (!SERVICE.test(url)) throw new Error(`arcgis source ${source.id} needs url …/MapServer`);
    if (Object.keys(stages).some((k) => !/^\d+$/.test(k))) {
      throw new Error(
        `arcgis source ${source.id}: stages are keyed by layer id without stageField`,
      );
    }
    layers = Object.entries(stages).map(([id, stage]) => ({
      url: `${url}/${id}`,
      stage: stage as DevelopmentStage,
    }));
  }
  return {
    service: url.replace(/\/\d+$/, ''),
    layers,
    stageField,
    stageValues: stageField ? (stages as Record<string, DevelopmentStage>) : {},
    idField,
    caseField,
    title: str('title'),
    fields: fieldMap(c.fields),
    where: str('where'),
    linkField: str('linkField'),
    // The id, case and stage columns are always requested, so records stay keyed and staged.
    outFields: outFields
      ? [
          ...new Set([
            ...outFields,
            idField,
            ...(caseField ? [caseField] : []),
            ...(stageField ? [stageField] : []),
          ]),
        ]
      : null,
    type: str('type') ?? 'development-project',
  };
}

export function stageQueryUrl(opts: StageOptions, layer: string, offset = 0, limit = PAGE) {
  const params = new URLSearchParams({
    where: opts.where ?? '1=1',
    outFields: opts.outFields?.join(',') ?? '*',
    orderByFields: opts.idField,
    resultOffset: String(offset),
    resultRecordCount: String(limit),
    returnGeometry: 'false',
    f: 'json',
  });
  return `${layer}/query?${params.toString()}`;
}

async function queryLayer(opts: StageOptions, layer: string, ctx: AdapterContext, limit = PAGE) {
  const out: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await ctx.fetcher.getJson<QueryResponse>(
      stageQueryUrl(opts, layer, page * limit, limit),
    );
    // ArcGIS reports query errors in a 200 response.
    if (body.error)
      throw new Error(`ArcGIS query failed: ${body.error.message ?? body.error.code}`);
    out.push(...(body.features ?? []).map((f) => f.attributes));
    if (!body.exceededTransferLimit || limit < PAGE) break;
  }
  return out;
}

/** A case number as one line ("UC-23-02 SC/ZC/PD/SPA/AB PZCPM-2023-00006"), the project's key. */
const caseKey = (value: unknown) => cell(value)?.toUpperCase() ?? null;

export function stageRecord(
  attributes: Row,
  stage: DevelopmentStage,
  opts: StageOptions,
  layer: string,
): RawRecord | null {
  const id = cell(attributes[opts.idField]);
  if (!id) return null;
  const link = opts.linkField ? cell(attributes[opts.linkField]) : null;
  const details = rowText(attributes, opts.fields);
  return {
    externalId: `project:${id}:${stage}`,
    type: opts.type,
    title: (opts.title ? fillTemplate(opts.title, attributes) : null) || null,
    // The stage leads the text, so the record says where the project stands.
    text: [`Stage: ${STAGE_TEXT[stage]}`, details].filter(Boolean).join('\n'),
    url: link && /^https?:\/\//.test(link) ? link : layer,
    occurredAt: null,
    datedOnSight: true,
    raw: {
      ...attributes,
      project: id,
      case: opts.caseField ? caseKey(attributes[opts.caseField]) : null,
      stage,
    },
  };
}

export async function fetchStages(source: SourceConfig, ctx: AdapterContext): Promise<RawRecord[]> {
  const opts = stageOptions(source);
  const out: RawRecord[] = [];
  for (const layer of opts.layers) {
    for (const attributes of await queryLayer(opts, layer.url, ctx)) {
      const value = opts.stageField ? cell(attributes[opts.stageField]) : null;
      // A status the config doesn't map (withdrawn, on hold) isn't one of the four stages.
      const stage = layer.stage ?? (value ? opts.stageValues[value] : undefined);
      if (!stage) continue;
      const record = stageRecord(attributes, stage, opts, layer.url);
      if (record) out.push(record);
    }
  }
  return out;
}

export async function stagesHealth(source: SourceConfig, ctx: AdapterContext) {
  const opts = stageOptions(source);
  for (const layer of opts.layers) await queryLayer(opts, layer.url, ctx, 1);
}
