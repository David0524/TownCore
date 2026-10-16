import { censusPlaceAt, type Fetcher, type OsmPlace, type PlaceAt } from '@towncore/adapters';
import { directoryCategory } from '@towncore/config';
import { and, businesses, eq, inArray, isNotNull, type Db } from '@towncore/db';
import { listingSlug, titleCase } from './names';

// Mapped places in the directory (owner, 2026-10-16, after reviewing bocatownsquare.com): named
// shops, restaurants, offices and venues from OpenStreetMap, with their public address, phone and
// website. Idempotent; run after each monthly extract.
// - A place is listed if it's in one of the town's mailing ZIPs or inside its city limits (the
//   "{Town} area", like license listings, D-M6-3). A mapped ZIP decides it; a place without one
//   gets one Census lookup by its coordinates, through the Fetcher (Rule 8). Known places keep
//   their earlier answer.
// - A place that is a listing we already have (same name, same ZIP or within 300 m) enriches it
//   instead: its storefront address, phone, website and cuisine. Never a claimed listing's
//   owner-edited fields.
// - A mapped place gone from the extract is hidden, never deleted.

export const OSM = 'osm';

export type OsmSeedResult = {
  created: number;
  updated: number;
  matched: number;
  outside: number;
  hidden: number;
  lookupFailed: boolean;
};

type Lookup = (lat: number, lng: number) => Promise<PlaceAt>;

/** A name as compared across sources: lower case, no punctuation or company suffix. */
export function matchName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(the|llc|inc|corp|co|ltd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

function meters(a: [number, number], b: [number, number]): number {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  const y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6_371_000;
}

export async function seedOsmPlaces(
  db: Db,
  town: { id: string; name: string; censusId: string | null },
  places: OsmPlace[],
  {
    fetcher,
    lookup = fetcher ? (lat, lng) => censusPlaceAt(fetcher, lat, lng) : undefined,
    now = new Date(),
  }: { fetcher?: Fetcher; lookup?: Lookup; now?: Date } = {},
): Promise<OsmSeedResult> {
  if (!lookup) throw new Error('seedOsmPlaces needs a fetcher or a lookup');
  const existing = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      category: businesses.category,
      zip: businesses.zip,
      city: businesses.city,
      lat: businesses.lat,
      lng: businesses.lng,
      osmRef: businesses.osmRef,
      dataSource: businesses.dataSource,
      inCityLimits: businesses.inCityLimits,
      claimedAt: businesses.claimedAt,
      phone: businesses.phone,
      website: businesses.website,
      active: businesses.active,
    })
    .from(businesses)
    .where(eq(businesses.townId, town.id));
  const byRef = new Map(existing.filter((b) => b.osmRef).map((b) => [b.osmRef!, b]));
  // The town's mailing ZIPs: those its license listings with the town's city name use.
  const townZips = new Set(
    existing
      .filter((b) => b.zip && b.city?.toLowerCase() === town.name.toLowerCase())
      .map((b) => b.zip!.slice(0, 5)),
  );
  const unmatched = existing.filter((b) => !b.osmRef && b.dataSource !== OSM);
  const keyed = unmatched.map((b) => ({ ...b, key: matchName(b.name) }));
  const taken = new Set<string>();
  /**
   * The listing a mapped place already is: in the same group of categories (food, home…), the
   * same name or one name starting with the other ("Pei Wei" / "Pei Wei Fresh Kitchen #0256"),
   * in the same ZIP or within 300 m. An exact name wins over a prefix; each listing takes one.
   */
  const twinOf = (name: string, category: string, zip: string | null, at: [number, number]) => {
    const key = matchName(name);
    if (key.length < 3) return null;
    const group = directoryCategory(category)?.group;
    const near = keyed.filter(
      (b) =>
        !taken.has(b.id) &&
        directoryCategory(b.category ?? '')?.group === group &&
        ((zip && b.zip?.slice(0, 5) === zip) ||
          (b.lat != null && b.lng != null && meters([b.lat, b.lng], at) < 300)),
    );
    return (
      near.find((b) => b.key === key) ??
      (key.length >= 5
        ? near.find((b) => b.key.length >= 5 && (b.key.startsWith(key) || key.startsWith(b.key)))
        : undefined) ??
      null
    );
  };

  const result: OsmSeedResult = {
    created: 0,
    updated: 0,
    matched: 0,
    outside: 0,
    hidden: 0,
    lookupFailed: false,
  };
  const seen = new Set<string>();
  const cityName = titleCase(town.name);
  for (const place of places) {
    seen.add(place.ref);
    const details = {
      osmRef: place.ref,
      cuisine: place.cuisine,
      lat: place.lat,
      lng: place.lon,
      updatedAt: now,
    };
    const known = byRef.get(place.ref);
    if (known) {
      await db
        .update(businesses)
        .set({
          ...details,
          active: true,
          // Owners edit their own listing once claimed.
          ...(known.claimedAt
            ? {}
            : {
                ...(known.dataSource === OSM ? { name: place.name, category: place.category } : {}),
                phone: place.phone ?? known.phone,
                website: place.website ?? known.website,
                ...(place.street ? { address: place.street, addressPublic: true } : {}),
                ...(place.zip ? { zip: place.zip } : {}),
                hours: place.hours,
              }),
        })
        .where(eq(businesses.id, known.id));
      result.updated++;
      continue;
    }

    // A mapped ZIP decides the area without a lookup; whether it's inside city limits is left
    // to the address geocoder (geocodedAt null). Only places without a ZIP are looked up.
    let inCity: boolean | null = null;
    let zip = place.zip;
    if (!zip) {
      let where: PlaceAt;
      try {
        where = await lookup(place.lat, place.lon);
      } catch {
        result.lookupFailed = true;
        break;
      }
      inCity = !!town.censusId && where.placeGeoid === town.censusId;
      zip = where.zcta;
    }
    if (!inCity && !(zip && townZips.has(zip))) {
      result.outside++;
      continue;
    }

    const twin = twinOf(place.name, place.category, zip, [place.lat, place.lon]);
    if (twin) {
      await db
        .update(businesses)
        .set({
          ...details,
          ...(inCity === null ? {} : { inCityLimits: inCity }),
          ...(twin.claimedAt
            ? {}
            : {
                phone: twin.phone ?? place.phone,
                website: twin.website ?? place.website,
                ...(place.street ? { address: place.street, addressPublic: true } : {}),
                ...(zip ? { zip } : {}),
                hours: place.hours,
              }),
        })
        .where(eq(businesses.id, twin.id));
      taken.add(twin.id);
      result.matched++;
      continue;
    }

    await db.insert(businesses).values({
      townId: town.id,
      slug: listingSlug(place.name, place.ref.replace('/', '')),
      name: place.name,
      category: place.category,
      address: place.street,
      addressPublic: place.street != null,
      city: cityName,
      zip,
      phone: place.phone,
      website: place.website,
      hours: place.hours,
      dataSource: OSM,
      licenseVerified: false,
      active: true,
      inCityLimits: inCity,
      // Known from the lookup, or left for the address geocoder.
      geocodeStatus: inCity === null ? null : 'match',
      geocodedAt: inCity === null ? null : now,
      ...details,
    });
    result.created++;
  }

  // Mapped places gone from the extract are hidden (only when the run saw every place).
  if (!result.lookupFailed) {
    const gone = existing
      .filter((b) => b.dataSource === OSM && b.active && b.osmRef && !seen.has(b.osmRef))
      .map((b) => b.id);
    if (gone.length > 0) {
      await db
        .update(businesses)
        .set({ active: false, updatedAt: now })
        .where(and(inArray(businesses.id, gone), isNotNull(businesses.osmRef)));
      result.hidden = gone.length;
    }
  }
  return result;
}
