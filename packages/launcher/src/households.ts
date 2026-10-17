import { eq, isNotNull, townCandidates, towns, type Db } from '@towncore/db';
import { cachedFile, censusFiles, readAcsPlaces } from './census';
import { stateFips, type FileOpts } from './towns-rank';

// `pnpm towns:households [--census]` (owner, 2026-10-17): each town's household count, so Admin →
// Health can show subscribers per 1,000 households. By default it copies the figure the town's
// ranking already stored (ACS B11001, no download); `--census` reads the ACS file for every
// state with towns (www2.census.gov, on the documented-API list, cached after the first run).

export type HouseholdsResult = {
  updated: Array<{ slug: string; households: number; from: 'ranking' | 'census' }>;
  missing: string[];
};

/** ACS B11001 total households by place GEOID, for the given states. */
export async function acsHouseholds(
  states: readonly string[],
  opts: FileOpts = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (states.length === 0) return out;
  const path = await cachedFile(censusFiles.acsTable('b11001'), opts);
  for (const state of new Set(states.map((s) => s.toUpperCase()))) {
    for (const [geoid, [households]] of await readAcsPlaces(path, stateFips(state), [
      'B11001_E001',
    ]))
      if (households != null) out.set(geoid, households);
  }
  return out;
}

/** The households figure a town's ranking stored, by GEOID. */
export async function rankedHouseholds(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ geoid: townCandidates.geoid, inputs: townCandidates.inputs })
    .from(townCandidates);
  const out = new Map<string, number>();
  for (const row of rows) {
    const n = (row.inputs as { figures?: { households?: unknown } } | null)?.figures?.households;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out.set(row.geoid, Math.round(n));
  }
  return out;
}

/** Sets `towns.households` for every town with a Census id; never blanks a known figure. */
export async function fillHouseholds(
  db: Db,
  opts: FileOpts & { census?: boolean } = {},
): Promise<HouseholdsResult> {
  const list = await db
    .select({ id: towns.id, slug: towns.slug, state: towns.state, censusId: towns.censusId })
    .from(towns)
    .where(isNotNull(towns.censusId));
  const ranked = await rankedHouseholds(db);
  const census = opts.census
    ? await acsHouseholds(
        list.map((t) => t.state),
        opts,
      )
    : new Map();
  const result: HouseholdsResult = { updated: [], missing: [] };
  for (const town of list) {
    const fromCensus = census.get(town.censusId!);
    const households = fromCensus ?? ranked.get(town.censusId!);
    if (households == null) {
      result.missing.push(town.slug);
      continue;
    }
    await db.update(towns).set({ households }).where(eq(towns.id, town.id));
    result.updated.push({
      slug: town.slug,
      households,
      from: fromCensus != null ? 'census' : 'ranking',
    });
  }
  return result;
}
