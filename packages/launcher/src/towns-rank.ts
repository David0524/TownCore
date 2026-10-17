import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { highValueIndustries, rankingFilters, rankingWeights } from '@towncore/config';
import { and, isNotNull, ne, sql, townCandidates, towns, type Db } from '@towncore/db';
import type { Fetcher } from '@towncore/adapters';
import {
  CENSUS_ATTRIBUTION,
  cachedFile,
  censusFiles,
  extractZipEntry,
  parseGazetteerPlaces,
  readAcsPlaces,
  readPopEstimates,
  readZctaPlaces,
  readZipBusiness,
  STATE_FIPS,
  type Place,
} from './census';
import type { CandidateRow, RankFacts } from './rank';

// `pnpm towns:rank FL [--near "Boca Raton, FL" --radius 60]` (CLAUDE.md §10a): load the Census
// files, rank the state's incorporated places, save them as `town_candidates` (keeping every
// staff decision) and write a CSV and a short report to docs/town-rankings/.

export type FileOpts = { cacheDir?: string; fetcher?: Fetcher };

const ACS_TABLES: Array<[table: string, columns: string[]]> = [
  ['b01003', ['B01003_E001']],
  ['b11001', ['B11001_E001']],
  ['b19013', ['B19013_E001']],
  ['b25003', ['B25003_E001', 'B25003_E002']],
];

export function stateFips(state: string): string {
  const fips = STATE_FIPS[state.toUpperCase()];
  if (!fips) throw new Error(`Unknown state "${state}". Use a two-letter code such as FL.`);
  return fips;
}

/** Every incorporated place in a state, from the Gazetteer. */
export async function statePlaces(state: string, opts: FileOpts = {}): Promise<Place[]> {
  const path = await cachedFile(censusFiles.gazetteer(stateFips(state)), opts);
  return parseGazetteerPlaces(readFileSync(path, 'utf8'));
}

/** "Boca Raton, FL" → its Gazetteer place, or an error naming close matches. */
export function findPlace(places: Place[], name: string): Place {
  const wanted = name.split(',')[0]!.trim().toLowerCase();
  const match = places.find((p) => p.name.toLowerCase() === wanted);
  if (match) return match;
  const close = places.filter((p) => p.name.toLowerCase().includes(wanted)).map((p) => p.name);
  throw new Error(
    `No incorporated place "${name}".${close.length ? ` Did you mean: ${close.slice(0, 5).join(', ')}?` : ''}`,
  );
}

export async function loadRankFacts(
  db: Db,
  state: string,
  opts: FileOpts = {},
): Promise<RankFacts> {
  const st = state.toUpperCase();
  const fips = stateFips(st);
  const places = await statePlaces(st, opts);
  const pop = await readPopEstimates(await cachedFile(censusFiles.popEstimates, opts), fips);
  const acs = new Map<string, Array<number | null>>();
  for (const [table, columns] of ACS_TABLES) {
    const values = await readAcsPlaces(
      await cachedFile(censusFiles.acsTable(table), opts),
      fips,
      columns,
    );
    for (const [geoid, v] of values) acs.set(geoid, [...(acs.get(geoid) ?? []), ...v]);
  }
  const zctaParts = await readZctaPlaces(await cachedFile(censusFiles.zctaPlace, opts), fips);
  const zip = await cachedFile(censusFiles.zipBusiness, opts);
  const zipText = await extractZipEntry(zip, zip.replace(/\.zip$/, '.txt'));
  const zipBusiness = await readZipBusiness(
    zipText,
    st,
    highValueIndustries.map((i) => i.naics),
  );
  // Towns we already run in this state (paused ones don't count toward clusters).
  const ours = await db
    .select({ censusId: towns.censusId, name: towns.name })
    .from(towns)
    .where(and(isNotNull(towns.censusId), ne(towns.status, 'paused'), sql`${towns.state} = ${st}`));
  const byGeoid = new Map(places.map((p) => [p.geoid, p]));
  const existing = ours.flatMap((t) => {
    const p = byGeoid.get(t.censusId!);
    return p ? [{ geoid: p.geoid, name: t.name, lat: p.lat, lon: p.lon }] : [];
  });
  return { places, pop, acs, zctaParts, zipBusiness, existing };
}

/**
 * Saves a ranking. New places come in `proposed`; places already ranked get their new score,
 * rank and inputs, but an approved, rejected or live row keeps its status and decision.
 */
export async function saveCandidates(
  db: Db,
  state: string,
  rows: CandidateRow[],
  now = new Date(),
): Promise<{ saved: number }> {
  for (const row of rows) {
    await db
      .insert(townCandidates)
      .values({
        state: state.toUpperCase(),
        geoid: row.geoid,
        name: row.name,
        inputs: { inputs: row.inputs, figures: row.figures, weights: rankingWeights },
        score: row.score,
        rank: row.rank,
        rankedAt: now,
      })
      .onConflictDoUpdate({
        target: townCandidates.geoid,
        set: {
          name: row.name,
          inputs: { inputs: row.inputs, figures: row.figures, weights: rankingWeights },
          score: row.score,
          rank: row.rank,
          rankedAt: now,
        },
      });
  }
  return { saved: rows.length };
}

const money = (n: number | null) => (n == null ? '–' : `$${Math.round(n).toLocaleString('en-US')}`);
const num = (n: number | null) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rankingCsv(rows: CandidateRow[]): string {
  const header = [
    'rank', 'geoid', 'name', 'score',
    ...Object.keys(rankingWeights).map((k) => `input_${k}`),
    'population_2025', 'growth_pct_2020_2025', 'households', 'median_household_income',
    'owner_share', 'business_value', 'nearest_town', 'nearest_town_miles',
  ]; // prettier-ignore
  const lines = rows.map(
    (r) =>
    [
      r.rank, r.geoid, r.name, r.score,
      ...Object.keys(rankingWeights).map((k) => r.inputs[k as keyof typeof r.inputs]),
      r.figures.population2025, r.figures.growthPct.toFixed(1), r.figures.households,
      r.figures.medianIncome, r.figures.ownerShare?.toFixed(3), r.figures.businessValue.toFixed(1),
      r.figures.nearestTown?.name, r.figures.nearestTown?.miles,
    ].map(csvCell).join(','), // prettier-ignore
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

export function rankingReport(input: {
  state: string;
  rows: CandidateRow[];
  date: string;
  near?: { name: string; radiusMiles: number };
  existing: RankFacts['existing'];
  top?: number;
}): string {
  const top = input.rows.slice(0, input.top ?? 25);
  const w = rankingWeights;
  return `# Town ranking: ${input.state}${input.near ? ` within ${input.near.radiusMiles} miles of ${input.near.name}` : ''}

Ranked ${input.date} by \`pnpm towns:rank\` (CLAUDE.md §10a). ${input.rows.length} incorporated places with at least ${rankingFilters.minPopulation.toLocaleString('en-US')} people${input.existing.length ? `, leaving out the towns we already run (${input.existing.map((t) => t.name).join(', ')})` : ''}. The full list is in the CSV beside this file.

**Nothing launches from this list until an admin approves the town** in Admin → Launches.

## Top ${top.length}

| # | Town | Score | Population (2025) | Growth since 2020 | Households | Median income | Business value | Nearest town we run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${top
  .map(
    (r) =>
      `| ${r.rank} | ${r.name} | ${r.score.toFixed(3)} | ${num(r.figures.population2025)} | ${r.figures.growthPct.toFixed(1)}% | ${num(r.figures.households)} | ${money(r.figures.medianIncome)} | ${r.figures.businessValue.toFixed(0)} | ${r.figures.nearestTown ? `${r.figures.nearestTown.name}, ${r.figures.nearestTown.miles} mi` : '–'} |`,
  )
  .join('\n')}

## How the score works

score = ${w.business_value} business value + ${w.households_x_income} households × income + ${w.source_readiness} source readiness + ${w.coverage_gap} coverage gap + ${w.cluster_fit} cluster fit + ${w.growth} growth (weights in \`packages/config/src/ranking.ts\`). Each input is 0–1, ranked within this list.

- **Business value:** establishments in high-value categories (${highValueIndustries.map((i) => `${i.label.split(':')[0]} ${i.naics}`).join(', ')}), weighted (home services 1, legal, medical, dental and real estate 0.8, restaurants 0.6). Census publishes these counts by ZIP, not by town, so each ZIP's counts are shared out by the part of its land inside the town: an estimate.
- **Households × income:** ACS 2020–2024 households times median household income.
- **Growth:** Vintage 2025 population estimate against the 2020 base.
- **Cluster fit:** 1 next to a town we run, falling to 0 at ${rankingFilters.clusterRadiusMiles} miles.
- **Source readiness and coverage gap are neutral (0.5) for every town for now,** so they don't change the order: source readiness until the launcher's light check runs on a shortlist (M7 PR D), news coverage until a Medill data license (D-M7-3). Readiness is measured at launch against the Rule 7 target, and the gap becomes the town's source to-do list.
- **Search demand** is skipped (no permitted data source, §10a).

${CENSUS_ATTRIBUTION}
`;
}

export function writeRanking(dir: string, state: string, date: string, csv: string, md: string) {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${state.toLowerCase()}-${date}`);
  writeFileSync(`${base}.csv`, csv);
  writeFileSync(`${base}.md`, md);
  return { csv: `${base}.csv`, md: `${base}.md` };
}
