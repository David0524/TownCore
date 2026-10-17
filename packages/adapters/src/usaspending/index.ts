import type { AdapterContext, RawRecord, SourceAdapter, SourceConfig } from '../types';

// USASpending.gov (federal contracts and grants), one adapter for every town in the country:
// new awards whose recipient has an address in the town, through the documented API
//   POST https://api.usaspending.gov/api/v2/search/spending_by_award/
// (https://api.usaspending.gov/docs/; open, no key). api.usaspending.gov/robots.txt answers 404
// (no rules), checked 2026-10-17, so this is a read-only query POST under owner decision
// 2026-10-16 (a), with the Fetcher's usual robots.txt, rate limit and identification.
//
// The recipient's address is its mailing address, like the state records: a company "with a
// Boca Raton address" may do the work anywhere (the record says where). Contracts and grants are
// asked for separately, since the API won't mix award types in one query. Grants to individuals
// and direct payments are never requested.
//
// Source: no url. Config: city: 'Boca Raton', state: 'FL'; days: 30 (first run).

const API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const AWARD_PAGE = 'https://www.usaspending.gov/award/';

/** Definitive contracts, purchase and delivery orders, BPA calls; then project and formula grants. */
export const AWARD_GROUPS = {
  contract: ['A', 'B', 'C', 'D'],
  grant: ['02', '03', '04', '05'],
} as const;

const FIELDS = [
  'Award ID',
  'Recipient Name',
  'Award Amount',
  'Start Date',
  'Base Obligation Date',
  'Awarding Agency',
  'Awarding Sub Agency',
  'Description',
  'Recipient Location',
  'Place of Performance State Code',
  'Place of Performance City Code',
  'generated_internal_id',
];

/** Most awards read per group and run; a busy town is read again next run. */
const LIMIT = 100;

type Options = { city: string; state: string; days: number };

export type AwardRow = {
  'Award ID'?: string;
  'Recipient Name'?: string;
  'Award Amount'?: number;
  'Start Date'?: string;
  'Base Obligation Date'?: string;
  'Awarding Agency'?: string;
  'Awarding Sub Agency'?: string;
  Description?: string | null;
  'Recipient Location'?: { city_name?: string; state_code?: string; zip5?: string } | null;
  'Place of Performance State Code'?: string | null;
  generated_internal_id?: string;
};

function options(source: SourceConfig): Options {
  const c = source.config as Record<string, unknown>;
  const city = typeof c.city === 'string' ? c.city.trim() : '';
  const state = typeof c.state === 'string' ? c.state.trim().toUpperCase() : '';
  if (!city || !/^[A-Z]{2}$/.test(state)) {
    throw new Error(`usaspending source ${source.id} needs config.city and config.state (e.g. FL)`);
  }
  return { city, state, days: Number(c.days) > 0 ? Number(c.days) : 30 };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function queryBody(
  opts: Options,
  group: keyof typeof AWARD_GROUPS,
  from: Date,
  to: Date,
  limit = LIMIT,
) {
  return {
    filters: {
      award_type_codes: [...AWARD_GROUPS[group]],
      recipient_locations: [{ country: 'USA', state: opts.state, city: opts.city }],
      // New awards only: modifications to old awards would repeat them every month.
      time_period: [{ start_date: day(from), end_date: day(to), date_type: 'new_awards_only' }],
    },
    fields: FIELDS,
    sort: 'Award Amount',
    order: 'desc',
    limit,
    page: 1,
  };
}

const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

export function awardRecord(row: AwardRow, group: keyof typeof AWARD_GROUPS): RawRecord | null {
  const id = row.generated_internal_id;
  // When the money was first obligated: the award's news date. The start date can be months
  // earlier or later (the period of performance).
  const start = row['Base Obligation Date'] ?? row['Start Date'];
  if (!id || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const where = row['Recipient Location'];
  const pop = row['Place of Performance State Code'];
  return {
    externalId: `award:${id}`,
    type: 'federal-award',
    title: row['Recipient Name'] ?? null,
    text: [
      `Recipient: ${row['Recipient Name'] ?? ''}`,
      `Award type: ${group}`,
      `Amount: ${row['Award Amount'] ?? ''}`,
      `Awarded: ${start}`,
      row['Start Date'] ? `Work starts: ${row['Start Date']}` : null,
      `Agency: ${row['Awarding Agency'] ?? ''}`,
      row['Awarding Sub Agency'] ? `Office: ${row['Awarding Sub Agency']}` : null,
      row.Description ? `Description: ${row.Description}` : null,
      where?.city_name
        ? `Recipient address: ${title(where.city_name)}, ${where.state_code ?? ''} ${where.zip5 ?? ''}`.trim()
        : null,
      pop ? `Place of performance: ${pop}` : null,
      `Award ID: ${row['Award ID'] ?? ''}`,
    ]
      .filter(Boolean)
      .join('\n'),
    url: `${AWARD_PAGE}${encodeURIComponent(id)}`,
    // Date-only, stored as UTC midnight like the state records.
    occurredAt: new Date(`${start}T00:00:00Z`),
    raw: { ...row, group },
  };
}

async function query(
  opts: Options,
  group: keyof typeof AWARD_GROUPS,
  from: Date,
  ctx: AdapterContext,
  limit?: number,
) {
  const res = await ctx.fetcher.queryJson<{ results?: AwardRow[] }>(
    API,
    queryBody(opts, group, from, ctx.now, limit),
  );
  return res.results ?? [];
}

export const usaspendingAdapter: SourceAdapter = {
  platform: 'usaspending',
  kinds: ['federal_awards'],

  async detect(url) {
    return /^https:\/\/(api\.|www\.)?usaspending\.gov\//i.test(url) ? 0.9 : 0;
  },

  async fetch(source, since, ctx) {
    const opts = options(source);
    // Awards are posted days after they're made (Defense contracts 90 days after), so each run
    // re-reads a window and dedupe drops what's stored.
    const from = new Date(
      Math.min(
        (since ?? ctx.now).getTime() - 14 * 86_400_000,
        ctx.now.getTime() - (since ? 14 : opts.days) * 86_400_000,
      ),
    );
    const out: RawRecord[] = [];
    for (const group of Object.keys(AWARD_GROUPS) as (keyof typeof AWARD_GROUPS)[]) {
      for (const row of await query(opts, group, from, ctx)) {
        const record = awardRecord(row, group);
        if (record) out.push(record);
      }
    }
    return out;
  },

  async healthCheck(source, ctx) {
    try {
      const opts = options(source);
      await query(opts, 'contract', new Date(ctx.now.getTime() - 365 * 86_400_000), ctx, 1);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
};
