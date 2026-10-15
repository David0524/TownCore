import { geocodeAddress, type Fetcher } from '@towncore/adapters';
import { and, asc, businesses, eq, isNotNull, isNull, towns, type Db } from '@towncore/db';

// Marks each listing inside or outside city limits (D-M6-3) with the Census Geocoder, a few
// hundred per run at 1 request/second (Rule 8), oldest first. A run stops at the first network
// error and leaves the rest for the next run; an address the Census can't find is recorded as
// no_match and not retried until the address changes.

export type GeocodeRunResult = { matched: number; noMatch: number; failed: boolean };

export async function geocodeListings(
  db: Db,
  fetcher: Fetcher,
  townId: string,
  { limit = 200, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<GeocodeRunResult> {
  const [town] = await db
    .select({ state: towns.state, censusId: towns.censusId })
    .from(towns)
    .where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);

  const pending = await db
    .select({
      id: businesses.id,
      address: businesses.address,
      city: businesses.city,
      zip: businesses.zip,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, townId),
        eq(businesses.active, true),
        isNull(businesses.geocodedAt),
        isNotNull(businesses.address),
        isNotNull(businesses.city),
      ),
    )
    .orderBy(asc(businesses.createdAt))
    .limit(limit);

  const result: GeocodeRunResult = { matched: 0, noMatch: 0, failed: false };
  for (const listing of pending) {
    let found;
    try {
      found = await geocodeAddress(fetcher, {
        street: listing.address!,
        city: listing.city!,
        state: town.state,
        zip: listing.zip,
      });
    } catch {
      result.failed = true;
      break;
    }
    if (found.status === 'match') {
      result.matched++;
      await db
        .update(businesses)
        .set({
          lat: found.lat,
          lng: found.lng,
          // Without the town's Census place ID we can't tell; leave it unknown.
          inCityLimits: town.censusId ? found.placeGeoid === town.censusId : null,
          geocodeStatus: 'match',
          geocodedAt: now,
        })
        .where(eq(businesses.id, listing.id));
    } else {
      result.noMatch++;
      await db
        .update(businesses)
        .set({
          lat: null,
          lng: null,
          inCityLimits: null,
          geocodeStatus: 'no_match',
          geocodedAt: now,
        })
        .where(eq(businesses.id, listing.id));
    }
  }
  return result;
}
