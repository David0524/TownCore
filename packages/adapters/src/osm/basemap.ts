import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Fetcher } from '../http/fetcher';
import { blobData, decodePrimitiveBlock, type OsmWay } from './pbf';

// Town base maps (CLAUDE.md §11c; docs/plans/M4.md §3, D-M4-1): streets, waterways and coastline
// from a downloaded OpenStreetMap extract (Geofabrik), clipped to the town and simplified, then
// stored per town. Refreshed monthly by a job; never fetched per request, and nothing is sent to
// OpenStreetMap's own servers. Every map we draw from it credits "© OpenStreetMap contributors".

export type BasemapClass = 'major' | 'secondary' | 'minor' | 'water' | 'coast';
/** One line: its class, its name if any, and [lon, lat] points rounded to about a meter. */
export type BasemapLine = { c: BasemapClass; n?: string; p: Array<[number, number]> };
export type Bbox = [west: number, south: number, east: number, north: number];

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_LICENSE = 'ODbL-1.0';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

const ROADS: Record<string, BasemapClass> = {
  motorway: 'major',
  motorway_link: 'major',
  trunk: 'major',
  trunk_link: 'major',
  primary: 'major',
  primary_link: 'major',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'secondary',
  tertiary_link: 'secondary',
  unclassified: 'minor',
  residential: 'minor',
  living_street: 'minor',
};

/** What a way is on our base map, or null if we don't draw it. */
export function classifyWay(tags: Record<string, string>): BasemapClass | null {
  if (tags.highway && ROADS[tags.highway]) return ROADS[tags.highway]!;
  if (tags.natural === 'coastline') return 'coast';
  if (tags.waterway === 'river' || tags.waterway === 'canal' || tags.natural === 'water') {
    return 'water';
  }
  return null;
}

/** A box about `km` kilometers on each side of a point. */
export function bboxAround(lat: number, lon: number, km: number): Bbox {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

/** Douglas–Peucker simplification in degrees (tolerance ~ tol × 111 km). */
export function simplify(points: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  const [a, b] = [points[0]!, points[points.length - 1]!];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i]!, a, b);
    if (d > worst) [worst, index] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [
    ...simplify(points.slice(0, index + 1), tol).slice(0, -1),
    ...simplify(points.slice(index), tol),
  ];
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t =
    len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Clips an extract to boxes in one pass (one box per town in the state): keeps nodes inside any
 * box, then cuts each drawn way into runs of nodes inside each box. Assumes the usual sorted
 * extract (nodes before ways), as Geofabrik publishes.
 */
export async function extractBasemaps(
  frames: AsyncIterable<{ type: string; blob: Uint8Array }>,
  boxes: Bbox[],
  { tolerance = 0.00002 }: { tolerance?: number } = {},
): Promise<BasemapLine[][]> {
  const inBox = (b: Bbox, [x, y]: [number, number]) =>
    x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  const nodes = new Map<number, [number, number]>();
  const out: BasemapLine[][] = boxes.map(() => []);
  const keep = (way: OsmWay) => {
    const c = classifyWay(way.tags);
    if (!c) return;
    boxes.forEach((box, i) => {
      let run: Array<[number, number]> = [];
      const flush = () => {
        if (run.length >= 2) {
          const p = simplify(run, tolerance).map(
            ([x, y]) => [round(x), round(y)] as [number, number],
          );
          out[i]!.push(way.tags.name ? { c, n: way.tags.name, p } : { c, p });
        }
        run = [];
      };
      for (const ref of way.refs) {
        const point = nodes.get(ref);
        if (point && inBox(box, point)) run.push(point);
        else flush();
      }
      flush();
    });
  };
  for await (const { type, blob } of frames) {
    if (type !== 'OSMData') continue;
    const block = decodePrimitiveBlock(blobData(blob));
    for (const node of block.nodes) {
      const point: [number, number] = [node.lon, node.lat];
      if (boxes.some((b) => inBox(b, point))) nodes.set(node.id, point);
    }
    for (const way of block.ways) keep(way);
  }
  return out;
}

/** One box's base map (see extractBasemaps). */
export async function extractBasemap(
  frames: AsyncIterable<{ type: string; blob: Uint8Array }>,
  bbox: Bbox,
  opts: { tolerance?: number } = {},
): Promise<BasemapLine[]> {
  return (await extractBasemaps(frames, [bbox], opts))[0]!;
}

/** Geofabrik's extract URL for a US state (two-letter code). */
export function geofabrikStateUrl(state: string): string {
  const name = US_STATES[state.toUpperCase()];
  if (!name) throw new Error(`No Geofabrik extract known for state ${state}`);
  return `https://download.geofabrik.de/north-america/us/${name}-latest.osm.pbf`;
}

/** Downloads a file through the polite Fetcher (robots.txt, rate limit, our User-Agent). */
export async function downloadTo(fetcher: Fetcher, url: string, dest: string): Promise<void> {
  const res = await fetcher.get(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

const US_STATES: Record<string, string> = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DE: 'delaware',
  DC: 'district-of-columbia',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'new-hampshire',
  NJ: 'new-jersey',
  NM: 'new-mexico',
  NY: 'new-york',
  NC: 'north-carolina',
  ND: 'north-dakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode-island',
  SC: 'south-carolina',
  SD: 'south-dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'west-virginia',
  WI: 'wisconsin',
  WY: 'wyoming',
};
