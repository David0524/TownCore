import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { geocodeAddress, geocodeUrl } from '../src/census/geocoder';
import { Fetcher } from '../src/http/fetcher';
import { replayFetch } from '../src/http/fixtures';

// Recorded live from the Census Geocoder on 2026-10-15.
const fixture = fileURLToPath(new URL('../fixtures/census/geocoder.json', import.meta.url));
const fetcher = () =>
  new Fetcher({ fetchImpl: replayFetch(fixture), sleep: async () => {}, minIntervalMs: 0 });

describe('Census geocoder', () => {
  it('returns coordinates and the incorporated place', async () => {
    const result = await geocodeAddress(fetcher(), {
      street: '201 W PALMETTO PARK RD',
      city: 'BOCA RATON',
      state: 'FL',
      zip: '33432',
    });
    expect(result).toMatchObject({ status: 'match', placeGeoid: '1207300' });
    if (result.status === 'match') {
      expect(result.lat).toBeCloseTo(26.3505, 3);
      expect(result.lng).toBeCloseTo(-80.0898, 3);
    }
  });

  it('reports unincorporated land as no place (a Boca Raton mailing address outside the city)', async () => {
    const result = await geocodeAddress(fetcher(), {
      street: '6006 SW 18 ST',
      city: 'BOCA RATON',
      state: 'FL',
      zip: '33433-7188',
    });
    expect(result).toMatchObject({ status: 'match', placeGeoid: null });
  });

  it('reports addresses it cannot find', async () => {
    const result = await geocodeAddress(fetcher(), {
      street: '20583 BOCA WEST DR',
      city: 'BOCA RATON',
      state: 'FL',
      zip: '33434-9990',
    });
    expect(result).toEqual({ status: 'no_match' });
  });

  it('sends a five-digit ZIP only', () => {
    const url = new URL(
      geocodeUrl({ street: '1 A ST', city: 'X', state: 'FL', zip: '33434-9990' }),
    );
    expect(url.searchParams.get('zip')).toBe('33434');
    const none = new URL(geocodeUrl({ street: '1 A ST', city: 'X', state: 'FL', zip: 'n/a' }));
    expect(none.searchParams.has('zip')).toBe(false);
  });
});
