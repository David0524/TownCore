import type { Fetcher } from '../http/fetcher';

// U.S. Census Bureau Geocoder (D-M4-1): free, public, no key. Its robots.txt is absent (404),
// so the Fetcher's normal Rule 8 checks apply and allow it. One address per GET at the
// Fetcher's 1 request/second; the batch endpoint is a POST and doesn't return places.
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/address';

export type GeocodeInput = { street: string; city: string; state: string; zip?: string | null };

export type GeocodeResult =
  | { status: 'match'; lat: number; lng: number; matchedAddress: string; placeGeoid: string | null }
  | { status: 'no_match' };

type CensusResponse = {
  result?: {
    addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
      geographies?: { 'Incorporated Places'?: Array<{ GEOID: string }> };
    }>;
  };
};

export function geocodeUrl(input: GeocodeInput): string {
  const params = new URLSearchParams({
    street: input.street,
    city: input.city,
    state: input.state,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'Incorporated Places',
    format: 'json',
  });
  const zip = input.zip?.slice(0, 5);
  if (zip && /^\d{5}$/.test(zip)) params.set('zip', zip);
  return `${ENDPOINT}?${params}`;
}

/**
 * Geocodes one street address. `placeGeoid` is the Census incorporated place it falls in
 * (e.g. 1207300 for the city of Boca Raton), or null for unincorporated land.
 */
export async function geocodeAddress(
  fetcher: Fetcher,
  input: GeocodeInput,
): Promise<GeocodeResult> {
  const data = await fetcher.getJson<CensusResponse>(geocodeUrl(input));
  const match = data.result?.addressMatches?.[0];
  if (!match) return { status: 'no_match' };
  return {
    status: 'match',
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    matchedAddress: match.matchedAddress,
    placeGeoid: match.geographies?.['Incorporated Places']?.[0]?.GEOID ?? null,
  };
}

const COORDINATES_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';

export type PlaceAt = { placeGeoid: string | null; zcta: string | null };

export function placeAtUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    x: lng.toFixed(6),
    y: lat.toFixed(6),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'Incorporated Places,2020 Census ZIP Code Tabulation Areas',
    format: 'json',
  });
  return `${COORDINATES_ENDPOINT}?${params}`;
}

type CoordinatesResponse = {
  result?: {
    geographies?: {
      'Incorporated Places'?: Array<{ GEOID: string }>;
      '2020 Census ZIP Code Tabulation Areas'?: Array<{ GEOID: string }>;
    };
  };
};

/**
 * What lies at a point: the incorporated place (null for unincorporated land) and the ZIP Code
 * Tabulation Area. Used to keep mapped places to a town's area (owner, 2026-10-16).
 */
export async function censusPlaceAt(fetcher: Fetcher, lat: number, lng: number): Promise<PlaceAt> {
  const data = await fetcher.getJson<CoordinatesResponse>(placeAtUrl(lat, lng));
  const g = data.result?.geographies;
  return {
    placeGeoid: g?.['Incorporated Places']?.[0]?.GEOID ?? null,
    zcta: g?.['2020 Census ZIP Code Tabulation Areas']?.[0]?.GEOID ?? null,
  };
}
