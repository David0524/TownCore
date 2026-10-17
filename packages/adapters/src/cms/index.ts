import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// CMS nursing-home inspections and penalties (Medicare Care Compare), one adapter for every town
// in the country: federal health inspections of nursing homes with a town address, and the fines
// and payment denials that followed, from the Provider Data Catalog's public datastore API
//   GET https://data.cms.gov/provider-data/api/1/datastore/query/{dataset}/0?conditions…
// (DKAN; no key, `accessLevel: public`, refreshed monthly). data.cms.gov/robots.txt allows
// /provider-data/ and asks for 10 seconds between requests ("crawl-delay: 10", written before its
// first group; the Fetcher honors it), checked 2026-10-17. A documented GET, so Rule 8 applies
// as to any page: robots.txt, Crawl-delay, identification.
//
// Datasets: Provider Information 4pq5-n9py (the town's homes and their beds), Health Deficiencies
// r5ix-sfxw (every citation from the last three inspection cycles) and Penalties g6vv-u9sr
// (fines and payment denials, last three years). A town with no nursing home costs one request.
//
// One record per inspection date per home (`nursing-home-inspection`: every citation, its scope
// and severity, and the home's previous inspection with citations), and one per penalty
// (`nursing-home-penalty`). Only facility names: CMS publishes no resident, staff or inspector
// names in these files, and the descriptions are the regulation's own wording, not the
// inspector's narrative. An inspection that found nothing has no citation rows, so it isn't
// listed. The address is the facility's, by its mailing city, which can be outside city limits.
//
// Source: no url. Config: city: 'Boca Raton', state: 'FL'; days: 240 (how far back inspection
// dates are read; CMS publishes a survey two to six months after it happens); penaltyDays: 365
// (penalties are posted later still, often four to six months after the fine).

const API = 'https://data.cms.gov/provider-data/api/1/datastore/query';
const CARE_COMPARE = 'https://www.medicare.gov/care-compare/details/nursing-home/';

export const DATASETS = {
  providers: '4pq5-n9py',
  deficiencies: 'r5ix-sfxw',
  penalties: 'g6vv-u9sr',
} as const;

/** The datastore's largest page. */
const PAGE = 1500;
/** Pages read per dataset and run: a city with more citations than this is read in part. */
const MAX_PAGES = 6;

const FIELDS = {
  providers: [
    'cms_certification_number_ccn',
    'provider_name',
    'provider_address',
    'citytown',
    'state',
    'zip_code',
    'number_of_certified_beds',
  ],
  deficiencies: [
    'cms_certification_number_ccn',
    'provider_name',
    'provider_address',
    'zip_code',
    'survey_date',
    'survey_type',
    'deficiency_prefix',
    'deficiency_category',
    'deficiency_tag_number',
    'deficiency_description',
    'scope_severity_code',
    'standard_deficiency',
    'complaint_deficiency',
    'infection_control_inspection_deficiency',
  ],
  penalties: [
    'cms_certification_number_ccn',
    'provider_name',
    'provider_address',
    'zip_code',
    'penalty_date',
    'penalty_type',
    'fine_id',
    'fine_amount',
    'payment_denial_start_date',
    'payment_denial_length_in_days',
  ],
} as const;

type Options = { city: string; state: string; days: number; penaltyDays: number };
type Row = Record<string, string | undefined>;

/** CMS's scope and severity grid: A–C minimal harm … J–L immediate jeopardy. */
export const SEVERITY_LEVELS = [
  { codes: 'ABC', level: 1, words: 'no actual harm, with potential for minimal harm' },
  { codes: 'DEF', level: 2, words: 'no actual harm, with potential for more than minimal harm' },
  { codes: 'GHI', level: 3, words: 'actual harm that is not immediate jeopardy' },
  { codes: 'JKL', level: 4, words: 'immediate jeopardy to resident health or safety' },
] as const;
const SCOPES = ['isolated', 'pattern', 'widespread'] as const;

/** 1 (minimal harm) to 4 (immediate jeopardy); 0 for a code CMS doesn't grid. */
export function severityLevel(code: string | undefined): number {
  return SEVERITY_LEVELS.find((s) => code && s.codes.includes(code))?.level ?? 0;
}

/** "D: isolated; no actual harm, with potential for more than minimal harm". */
export function severityWords(code: string): string {
  const s = SEVERITY_LEVELS.find((l) => l.codes.includes(code));
  return s ? `${code}: ${SCOPES[s.codes.indexOf(code)]}; ${s.words}` : code;
}

export type Citation = {
  tag: string;
  category: string;
  description: string;
  severity: string;
  complaint: boolean;
  infectionControl: boolean;
};

export type NursingHomeInspection = {
  ccn: string;
  name: string;
  address: string;
  zip: string;
  beds: number | null;
  date: string;
  /** "standard", "complaint", "infection control", from the citations' flags. */
  kinds: string[];
  citations: Citation[];
  /** The most serious scope and severity code (letters rank A … L). */
  worst: string;
  /** The home's previous inspection with citations still in CMS's data. */
  previous: { date: string; citations: number } | null;
  /** Nursing homes with this city on Care Compare when the record was read. */
  homesInTown: number;
};

export type NursingHomePenalty = {
  ccn: string;
  name: string;
  address: string;
  zip: string;
  beds: number | null;
  date: string;
  type: 'fine' | 'payment denial';
  amount: number | null;
  denialDays: number | null;
  homesInTown: number;
};

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  const city = typeof c.city === 'string' ? c.city.trim() : '';
  const state = typeof c.state === 'string' ? c.state.trim().toUpperCase() : '';
  if (!city || !/^[A-Z]{2}$/.test(state)) {
    throw new Error(`cms source ${source.id} needs config.city and config.state (e.g. FL)`);
  }
  return {
    city,
    state,
    days: Number(c.days) > 0 ? Number(c.days) : 240,
    penaltyDays: Number(c.penaltyDays) > 0 ? Number(c.penaltyDays) : 365,
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const isDay = (s: string | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

/** The datastore query for a dataset: the town's rows, optionally from a date on. */
export function queryUrl(
  dataset: keyof typeof DATASETS,
  opts: Pick<Options, 'city' | 'state'>,
  page: { limit?: number; offset?: number; from?: { field: string; date: Date } } = {},
): string {
  const q = new URLSearchParams();
  const conditions: [string, string, string][] = [
    ['citytown', opts.city.toUpperCase(), '='],
    ['state', opts.state, '='],
  ];
  if (page.from) conditions.push([page.from.field, day(page.from.date), '>=']);
  conditions.forEach(([property, value, operator], i) => {
    q.set(`conditions[${i}][property]`, property);
    q.set(`conditions[${i}][value]`, value);
    q.set(`conditions[${i}][operator]`, operator);
  });
  FIELDS[dataset].forEach((f, i) => q.set(`properties[${i}]`, f));
  // A full order, so pages never overlap or skip.
  ['cms_certification_number_ccn', ...(dataset === 'providers' ? [] : ['record_number'])].forEach(
    (property, i) => {
      q.set(`sorts[${i}][property]`, property);
      q.set(`sorts[${i}][order]`, 'asc');
    },
  );
  q.set('limit', String(page.limit ?? PAGE));
  q.set('offset', String(page.offset ?? 0));
  q.set('count', 'true');
  q.set('schema', 'false');
  q.set('keys', 'true');
  return `${API}/${DATASETS[dataset]}/0?${q}`;
}

async function readAll(
  dataset: keyof typeof DATASETS,
  opts: Options,
  ctx: AdapterContext,
  from?: { field: string; date: Date },
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await ctx.fetcher.getJson<{ results?: Row[]; count?: number }>(
      queryUrl(dataset, opts, { offset: p * PAGE, from }),
    );
    rows.push(...(res.results ?? []));
    if ((res.results?.length ?? 0) < PAGE || rows.length >= (res.count ?? 0)) break;
  }
  return rows;
}

const careCompare = (ccn: string, state: string) =>
  `${CARE_COMPARE}${encodeURIComponent(ccn)}?state=${state}`;

type Home = { name: string; address: string; zip: string; beds: number | null };

function homeLines(h: Home, city: string, state: string, beds: number | null) {
  return [
    `Facility: ${h.name}`,
    `Address: ${h.address}, ${city.toUpperCase()}, ${state} ${h.zip}`.trim(),
    beds ? `Certified beds: ${beds}` : null,
  ];
}

/** Every citation row grouped into one inspection per home and date, oldest first. */
export function inspections(
  rows: Row[],
  homes: Map<string, Home>,
): Omit<NursingHomeInspection, 'previous' | 'homesInTown'>[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const ccn = r.cms_certification_number_ccn;
    // Health inspections only; fire safety citations are another dataset.
    if (!ccn || !isDay(r.survey_date) || (r.survey_type && r.survey_type !== 'Health')) continue;
    const key = `${ccn}:${r.survey_date}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((group) => {
      const first = group[0]!;
      const ccn = first.cms_certification_number_ccn!;
      const home = homes.get(ccn);
      const seen = new Set<string>();
      const citations: Citation[] = [];
      for (const r of group) {
        const tag = `${r.deficiency_prefix ?? ''}${r.deficiency_tag_number ?? ''}`;
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        citations.push({
          tag,
          category: r.deficiency_category ?? '',
          description: (r.deficiency_description ?? '').trim(),
          severity: (r.scope_severity_code ?? '').trim().toUpperCase(),
          complaint: r.complaint_deficiency === 'Y',
          infectionControl: r.infection_control_inspection_deficiency === 'Y',
        });
      }
      citations.sort((a, b) => b.severity.localeCompare(a.severity) || a.tag.localeCompare(b.tag));
      const kinds = [
        group.some((r) => r.standard_deficiency === 'Y') ? 'standard' : null,
        group.some((r) => r.complaint_deficiency === 'Y') ? 'complaint' : null,
        group.some((r) => r.infection_control_inspection_deficiency === 'Y')
          ? 'infection control'
          : null,
      ].filter((k): k is string => k !== null);
      return {
        ccn,
        name: home?.name ?? first.provider_name ?? '',
        address: home?.address ?? first.provider_address ?? '',
        zip: home?.zip ?? first.zip_code ?? '',
        beds: home?.beds ?? null,
        date: first.survey_date!,
        kinds,
        citations,
        worst: citations.map((c) => c.severity).reduce((w, s) => (s > w ? s : w), ''),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.ccn.localeCompare(b.ccn));
}

export function inspectionRecord(
  v: NursingHomeInspection,
  opts: Pick<Options, 'city' | 'state'>,
): RawRecord {
  return {
    externalId: `inspection:${v.ccn}:${v.date}`,
    type: 'nursing-home-inspection',
    title: v.name,
    text: [
      ...homeLines(v, opts.city, opts.state, v.beds),
      `Inspected: ${v.date}`,
      v.kinds.length ? `Inspection type: ${v.kinds.join(', ')}` : null,
      `Citations: ${v.citations.length}`,
      v.worst ? `Most serious: ${severityWords(v.worst)}` : null,
      ...v.citations.map(
        (c) =>
          `Citation ${c.tag} (${c.severity}), ${c.category}${c.complaint ? ', from a complaint' : ''}: ${c.description}`,
      ),
      v.previous
        ? `Previous inspection with citations: ${v.previous.date} (${v.previous.citations})`
        : null,
      `CMS certification number: ${v.ccn}`,
    ]
      .filter(Boolean)
      .join('\n'),
    url: careCompare(v.ccn, opts.state),
    // Date-only, stored as UTC midnight like the state records.
    occurredAt: new Date(`${v.date}T00:00:00Z`),
    raw: v,
  };
}

export function penaltyRecord(
  r: Row,
  homes: Map<string, Home>,
  homesInTown: number,
  opts: Pick<Options, 'city' | 'state'>,
): RawRecord | null {
  const ccn = r.cms_certification_number_ccn;
  const date = isDay(r.penalty_date) ? r.penalty_date : r.payment_denial_start_date;
  const type =
    r.penalty_type === 'Fine'
      ? 'fine'
      : r.penalty_type === 'Payment Denial'
        ? 'payment denial'
        : null;
  if (!ccn || !isDay(date) || !type) return null;
  const home = homes.get(ccn);
  const amount = type === 'fine' && Number(r.fine_amount) > 0 ? Number(r.fine_amount) : null;
  const denialDays =
    Number(r.payment_denial_length_in_days) > 0 ? Number(r.payment_denial_length_in_days) : null;
  const p: NursingHomePenalty = {
    ccn,
    name: home?.name ?? r.provider_name ?? '',
    address: home?.address ?? r.provider_address ?? '',
    zip: home?.zip ?? r.zip_code ?? '',
    beds: home?.beds ?? null,
    date,
    type,
    amount,
    denialDays,
    homesInTown,
  };
  return {
    // By what the penalty is, not CMS's row id: the file can list one fine twice under two ids
    // (West Palm Beach, 2026-03-13), and a repeated row must never double a total.
    externalId: `penalty:${ccn}:${type}:${date}:${amount ?? denialDays ?? ''}`,
    type: 'nursing-home-penalty',
    title: p.name,
    text: [
      ...homeLines(p, opts.city, opts.state, p.beds),
      `Penalty: ${type}`,
      `Date: ${date}`,
      amount ? `Amount: ${amount}` : null,
      denialDays ? `Payment denial length: ${denialDays} days` : null,
      `CMS certification number: ${ccn}`,
    ]
      .filter(Boolean)
      .join('\n'),
    url: careCompare(ccn, opts.state),
    occurredAt: new Date(`${date}T00:00:00Z`),
    raw: p,
  };
}

export const cmsAdapter: SourceAdapter = {
  platform: 'cms',
  kinds: ['health_facilities'],

  async detect(url) {
    return /^https:\/\/data\.cms\.gov\/provider-data\//i.test(url) ? 0.9 : 0;
  },

  async fetch(source, _since, ctx) {
    const opts = options(source);
    const providers = await readAll('providers', opts, ctx);
    // No nursing home in town: nothing else to ask for.
    if (providers.length === 0) return [];
    const homes = new Map<string, Home>(
      providers
        .filter((p) => p.cms_certification_number_ccn)
        .map((p) => [
          p.cms_certification_number_ccn!,
          {
            name: p.provider_name ?? '',
            address: p.provider_address ?? '',
            zip: p.zip_code ?? '',
            beds:
              Number(p.number_of_certified_beds) > 0 ? Number(p.number_of_certified_beds) : null,
          },
        ]),
    );
    // CMS publishes an inspection one to three months after it happens, so every run re-reads the
    // same window of dates and dedupe drops what's stored. A survey published later than the
    // window is missed rather than written up as news months late.
    const from = new Date(ctx.now.getTime() - opts.days * 86_400_000);
    const out: RawRecord[] = [];
    // Every cycle on file, for each inspection's previous one.
    const all = inspections(await readAll('deficiencies', opts, ctx), homes);
    for (const [i, v] of all.entries()) {
      if (v.date < day(from)) continue;
      const before = all
        .slice(0, i)
        .filter((p) => p.ccn === v.ccn)
        .at(-1);
      out.push(
        inspectionRecord(
          {
            ...v,
            previous: before ? { date: before.date, citations: before.citations.length } : null,
            homesInTown: homes.size,
          },
          opts,
        ),
      );
    }
    const penaltiesFrom = new Date(ctx.now.getTime() - opts.penaltyDays * 86_400_000);
    for (const r of await readAll('penalties', opts, ctx, {
      field: 'penalty_date',
      date: penaltiesFrom,
    })) {
      const record = penaltyRecord(r, homes, homes.size, opts);
      if (record && !out.some((o) => o.externalId === record.externalId)) out.push(record);
    }
    return out;
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      await ctx.fetcher.getJson(queryUrl('providers', opts, { limit: 1 }));
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
