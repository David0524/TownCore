import {
  highValueIndustries,
  NEUTRAL_INPUT,
  rankingFilters,
  rankingWeights,
  type RankingInput,
} from '@towncore/config';
import type { Place, PopEstimate, ZctaPart } from './census';

// Ranking towns (CLAUDE.md §10a). Pure: the CLI loads the Census files and the existing towns,
// this turns them into scored candidates. Every input is normalized to 0–1 within the state's
// candidates, so the §10a weights apply to comparable numbers.

export type RankFacts = {
  places: Place[];
  pop: Map<string, PopEstimate>;
  /** geoid → [population, households, median household income, occupied units, owner units] */
  acs: Map<string, Array<number | null>>;
  zctaParts: ZctaPart[];
  /** ZIP → 4-digit NAICS → establishments */
  zipBusiness: Map<string, Map<string, number>>;
  /** Towns we already run (any status but paused), as Gazetteer coordinates. */
  existing: Array<{ geoid: string; name: string; lat: number; lon: number }>;
};

export type CandidateRow = {
  geoid: string;
  name: string;
  rank: number;
  score: number;
  inputs: Record<RankingInput, number>;
  figures: {
    population2025: number;
    population2020: number;
    growthPct: number;
    households: number | null;
    medianIncome: number | null;
    ownerShare: number | null;
    /** Weighted high-value establishments, shared out from ZIPs by land area. */
    businessValue: number;
    establishments: Record<string, number>;
    nearestTown: { name: string; miles: number } | null;
    lat: number;
    lon: number;
  };
};

export const EARTH_MILES = 3958.8;

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

/** Share of each value's position in the set: the lowest is near 0, the highest near 1. */
export function percentiles(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let below = 0;
    let equal = 0;
    for (const s of sorted) {
      if (s < v) below++;
      else if (s === v) equal++;
    }
    return values.length === 1 ? 1 : (below + (equal - 1) / 2) / (values.length - 1);
  });
}

/**
 * A place's high-value establishments: each ZIP's counts, shared out by the fraction of the
 * ZIP's land inside the place (an approximation; Census publishes no place-level counts).
 */
export function establishmentsFor(
  geoid: string,
  parts: ZctaPart[],
  zipBusiness: RankFacts['zipBusiness'],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.place !== geoid || part.zctaLand <= 0) continue;
    const share = Math.min(1, part.partLand / part.zctaLand);
    for (const [code, est] of zipBusiness.get(part.zcta) ?? [])
      out[code] = (out[code] ?? 0) + est * share;
  }
  return out;
}

export function rankPlaces(
  facts: RankFacts,
  opts: { near?: { lat: number; lon: number }; radiusMiles?: number } = {},
): CandidateRow[] {
  const existing = new Set(facts.existing.map((t) => t.geoid));
  const partsByPlace = new Map<string, ZctaPart[]>();
  for (const p of facts.zctaParts)
    partsByPlace.set(p.place, [...(partsByPlace.get(p.place) ?? []), p]);

  const rows = facts.places.flatMap((place) => {
    const pop = facts.pop.get(place.geoid);
    if (!pop || pop.pop2025 < rankingFilters.minPopulation || existing.has(place.geoid)) return [];
    if (opts.near && milesBetween(opts.near, place) > (opts.radiusMiles ?? 60)) return [];
    const [, households, income, occupied, owners] = facts.acs.get(place.geoid) ?? [];
    const establishments = establishmentsFor(
      place.geoid,
      partsByPlace.get(place.geoid) ?? [],
      facts.zipBusiness,
    );
    const businessValue = highValueIndustries.reduce(
      (sum, i) => sum + (establishments[i.naics] ?? 0) * i.weight,
      0,
    );
    const nearest = facts.existing
      .map((t) => ({ name: t.name, miles: milesBetween(t, place) }))
      .sort((a, b) => a.miles - b.miles)[0];
    return [
      {
        place,
        figures: {
          population2025: pop.pop2025,
          population2020: pop.base2020,
          growthPct: pop.base2020 > 0 ? (pop.pop2025 / pop.base2020 - 1) * 100 : 0,
          households: households ?? null,
          medianIncome: income ?? null,
          ownerShare: occupied && owners != null ? owners / occupied : null,
          businessValue,
          establishments: Object.fromEntries(
            Object.entries(establishments).map(([k, v]) => [k, Math.round(v * 10) / 10]),
          ),
          nearestTown: nearest ? { name: nearest.name, miles: Math.round(nearest.miles) } : null,
          lat: place.lat,
          lon: place.lon,
        },
      },
    ];
  });

  const business = percentiles(rows.map((r) => r.figures.businessValue));
  const buying = percentiles(
    rows.map((r) => (r.figures.households ?? 0) * (r.figures.medianIncome ?? 0)),
  );
  const growth = percentiles(rows.map((r) => r.figures.growthPct));
  const scored = rows.map((r, i) => {
    const miles = r.figures.nearestTown?.miles;
    const inputs: Record<RankingInput, number> = {
      business_value: business[i]!,
      households_x_income: buying[i]!,
      source_readiness: NEUTRAL_INPUT,
      coverage_gap: NEUTRAL_INPUT,
      cluster_fit: miles == null ? 0 : Math.max(0, 1 - miles / rankingFilters.clusterRadiusMiles),
      growth: growth[i]!,
    };
    const score = (Object.keys(rankingWeights) as RankingInput[]).reduce(
      (sum, k) => sum + rankingWeights[k] * inputs[k],
      0,
    );
    return {
      geoid: r.place.geoid,
      name: r.place.name,
      rank: 0,
      score: Math.round(score * 1000) / 1000,
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
      ) as Record<RankingInput, number>,
      figures: r.figures,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.map((row, i) => ({ ...row, rank: i + 1 }));
}
