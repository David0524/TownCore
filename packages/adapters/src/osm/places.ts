import { categoryForOsmTags } from '@towncore/config';
import type { Bbox } from './basemap';
import { blobData, decodePrimitiveBlock } from './pbf';

// Places from an OpenStreetMap extract for the directory (owner, 2026-10-16): named shops,
// restaurants, offices and venues in a town's box, from the same Geofabrik extract as the base
// maps. ODbL: every page listing them credits "© OpenStreetMap contributors".

export type OsmPlace = {
  /** "node/123" or "way/456": stable, and the page a reader can check on openstreetmap.org. */
  ref: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  /** "123 Main Street", from addr:housenumber and addr:street. */
  street: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  /** "sushi; japanese" → "sushi, japanese". */
  cuisine: string | null;
  hours: string | null;
};

const clean = (v: string | undefined) => v?.replace(/\s+/g, ' ').trim() || null;

/** A US phone number as "(561) 555-0100", or the original text if it isn't one. */
export function formatPhone(raw: string | undefined): string | null {
  const text = clean(raw?.split(';')[0]);
  if (!text) return null;
  const digits = text.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : text;
}

/** Only http(s) links; a bare domain gets https://. */
export function cleanWebsite(raw: string | undefined): string | null {
  const text = clean(raw?.split(';')[0]);
  if (!text) return null;
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function placeFromTags(
  ref: string,
  tags: Readonly<Record<string, string>>,
  [lon, lat]: [number, number],
): OsmPlace | null {
  const category = categoryForOsmTags(tags);
  // Disused places and private ones (a home office) aren't listed.
  if (!category || tags.disused === 'yes' || tags['disused:shop'] || tags.access === 'private') {
    return null;
  }
  // A house number alone ("7152B") isn't an address.
  const street = tags['addr:street']
    ? [clean(tags['addr:housenumber']), clean(tags['addr:street'])].filter(Boolean).join(' ')
    : '';
  return {
    ref,
    name: clean(tags.name)!,
    category: category.slug,
    lat,
    lon,
    street: street || null,
    city: clean(tags['addr:city']),
    zip: clean(tags['addr:postcode'])?.slice(0, 5) ?? null,
    phone: formatPhone(tags.phone ?? tags['contact:phone']),
    website: cleanWebsite(tags.website ?? tags['contact:website']),
    cuisine:
      clean(tags.cuisine)
        ?.split(';')
        .map((c) => c.trim().replace(/_/g, ' '))
        .filter(Boolean)
        .join(', ') ?? null,
    hours: clean(tags.opening_hours),
  };
}

/**
 * Named, categorized places in the box: tagged nodes, and tagged ways (buildings and lots)
 * placed at the average of their nodes. One pass; assumes the usual sorted extract (nodes before
 * ways), as Geofabrik publishes.
 */
export async function extractPlaces(
  frames: AsyncIterable<{ type: string; blob: Uint8Array }>,
  box: Bbox,
): Promise<OsmPlace[]> {
  const inBox = (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const points = new Map<number, [number, number]>();
  const places: OsmPlace[] = [];
  for await (const { type, blob } of frames) {
    if (type !== 'OSMData') continue;
    const block = decodePrimitiveBlock(blobData(blob));
    for (const node of block.nodes) {
      if (!inBox(node.lon, node.lat)) continue;
      points.set(node.id, [node.lon, node.lat]);
      if (node.tags) {
        const place = placeFromTags(`node/${node.id}`, node.tags, [node.lon, node.lat]);
        if (place) places.push(place);
      }
    }
    for (const way of block.ways) {
      if (!way.tags.name) continue;
      const coords = way.refs.map((r) => points.get(r)).filter((p) => p !== undefined);
      // Only ways wholly in the box, so a place on the edge isn't half-placed.
      if (coords.length === 0 || coords.length < way.refs.length) continue;
      const lon = coords.reduce((s, p) => s + p[0], 0) / coords.length;
      const lat = coords.reduce((s, p) => s + p[1], 0) / coords.length;
      const place = placeFromTags(`way/${way.id}`, way.tags, [lon, lat]);
      if (place) places.push(place);
    }
  }
  return places;
}
