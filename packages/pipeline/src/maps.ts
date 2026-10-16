import { geocodeAddress, type Fetcher } from '@towncore/adapters';
import { MAP_VIEW, type MapSpec } from '@towncore/config';

// Block-level maps (CLAUDE.md §11c; docs/plans/M4.md §3, D-M4-1). A story's street address is
// snapped to its block ("1200 block of SW 12th Ave"), the middle of that block is geocoded with
// the Census Geocoder, and the town's OpenStreetMap base map is drawn around it. The exact
// address is never geocoded, stored or shown: the map is never more precise than the block.

const SUFFIX =
  'Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Parkway|Pkwy|Highway|Hwy|Way|Place|Pl|Terrace|Ter|Circle|Cir|Trail|Trl';
const ADDRESS = new RegExp(
  String.raw`\b(\d{1,6})\s+((?:(?:N|S|E|W|NE|NW|SE|SW)\.?\s+)?(?:[A-Z0-9][A-Za-z0-9'.-]*\s+){0,4}?(?:${SUFFIX})\b\.?)`,
);

/** The first street address in a story: its number and street ("W Palmetto Park Road"). */
export function findStreetAddress(text: string): { number: number; street: string } | null {
  const m = text.match(ADDRESS);
  if (!m) return null;
  return { number: Number(m[1]), street: m[2]!.replace(/\.$/, '').trim() };
}

/** The block a house number is on: 1234 → 1200. */
export const blockOf = (number: number) => Math.floor(number / 100) * 100;

/** "1200 block of SW 12th Ave"; the first block reads "first block of …". */
export function blockLabel(number: number, street: string): string {
  const block = blockOf(number);
  return `${block === 0 ? 'First' : block} block of ${street}`;
}

export type BasemapLines = Array<{
  c: MapSpec['lines'][number]['c'];
  n?: string;
  p: Array<[number, number]>;
}>;

const METERS_PER_DEGREE = 111_320;
const WIDTH_METERS = 900;
/** A block is about 100 m: the marker shows roughly half a block on each side. */
const MARKER_METERS = 60;
const MAX_LABELS = 6;

/**
 * Projects the base map around `center` into the 1200×675 view: only lines that reach the view,
 * as SVG path data, and up to six street-name labels for the larger roads, spread apart.
 */
export function buildMapSpec(
  lines: BasemapLines,
  center: [number, number],
  label: string,
  street: string,
): MapSpec {
  const { width, height } = MAP_VIEW;
  const scale = width / WIDTH_METERS;
  const cos = Math.cos((center[1] * Math.PI) / 180);
  const project = ([lon, lat]: [number, number]): [number, number] => [
    width / 2 + (lon - center[0]) * cos * METERS_PER_DEGREE * scale,
    height / 2 - (lat - center[1]) * METERS_PER_DEGREE * scale,
  ];
  const margin = 50;
  const inView = ([x, y]: [number, number]) =>
    x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;
  const crossesView = (a: [number, number], b: [number, number]) =>
    Math.max(a[0], b[0]) >= -margin &&
    Math.min(a[0], b[0]) <= width + margin &&
    Math.max(a[1], b[1]) >= -margin &&
    Math.min(a[1], b[1]) <= height + margin;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const out: MapSpec['lines'] = [];
  const candidates: Array<{
    text: string;
    x: number;
    y: number;
    angle: number;
    len: number;
    rank: number;
  }> = [];
  for (const line of lines) {
    const pts = line.p.map(project);
    // A long straight road can cross the view with every point outside it.
    if (!pts.some((a, i) => (i === 0 ? inView(a) : crossesView(pts[i - 1]!, a)))) continue;
    out.push({ c: line.c, d: `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}` });
    if (line.n && (line.c === 'major' || line.c === 'secondary')) {
      // Label on the line's longest in-view segment.
      let best = { len: 0, x: 0, y: 0, angle: 0 };
      for (let i = 1; i < pts.length; i++) {
        const clipped = clipSegment(pts[i - 1]!, pts[i]!, LABEL_INSET, width, height);
        if (!clipped) continue;
        const [a, b] = clipped;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > best.len) {
          let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          // A quarter of the way along, at the end farther from the marker, so labels don't
          // cover the block or each other where streets cross at the center.
          const at = (t: number) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
          const [q1, q3] = [at(0.25), at(0.75)];
          const off = (p: number[]) => Math.hypot(p[0]! - width / 2, p[1]! - height / 2);
          const order = off(q1) >= off(q3) ? [q1, q3] : [q3, q1];
          // Both ends of the text (about 11 map units a character at phone size) stay clear.
          const half = line.n.length * 11;
          const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
          const spot = order.find(
            ([px, py]) =>
              !underBlockLabel(px! - ux * half, py! - uy * half) &&
              !underBlockLabel(px! + ux * half, py! + uy * half),
          );
          if (spot) best = { len, x: spot[0]!, y: spot[1]!, angle };
        }
      }
      if (best.len > 120) {
        candidates.push({ text: line.n, ...best, rank: line.c === 'major' ? 0 : 1 });
      }
    }
  }
  const labels: MapSpec['labels'] = [];
  for (const c of candidates.sort((a, b) => a.rank - b.rank || b.len - a.len)) {
    if (labels.length >= MAX_LABELS) break;
    if (labels.some((l) => l.text === c.text || Math.hypot(l.x - c.x, l.y - c.y) < 160)) continue;
    labels.push({ text: c.text, x: r1(c.x), y: r1(c.y), angle: Math.round(c.angle) });
  }
  return {
    type: 'map',
    label,
    street,
    center,
    widthMeters: WIDTH_METERS,
    lines: out,
    labels,
    marker: { x: width / 2, y: height / 2, r: r1(MARKER_METERS * scale) },
  };
}

/**
 * The page draws the block's name in the lower-left corner of the map (about 820×120 map units
 * at phone width): street labels stay out of it.
 */
const underBlockLabel = (x: number, y: number) => x < 860 && y > MAP_VIEW.height - 160;

/** Room kept between a label's anchor and the edge of the view. */
const LABEL_INSET = 80;

/** The part of segment a→b inside the view inset by `inset` (Liang–Barsky), or null. */
function clipSegment(
  a: [number, number],
  b: [number, number],
  inset: number,
  width: number,
  height: number,
): [[number, number], [number, number]] | null {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  let [t0, t1] = [0, 1];
  const edges: Array<[number, number]> = [
    [-dx, a[0] - inset],
    [dx, width - inset - a[0]],
    [-dy, a[1] - inset],
    [dy, height - inset - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/**
 * Geocodes the middle of the block (number 50 on it), never the address the story gives.
 * Null when the Census has no match or the match is outside the base map.
 */
export async function geocodeBlock(
  fetcher: Fetcher,
  address: { number: number; street: string },
  town: { name: string; state: string },
): Promise<[number, number] | null> {
  const found = await geocodeAddress(fetcher, {
    street: `${blockOf(address.number) + 50} ${address.street}`,
    city: town.name,
    state: town.state,
  });
  return found.status === 'match' ? [found.lng, found.lat] : null;
}

/** Alt text written from what the map shows. */
export function mapAlt(spec: MapSpec, townName: string): string {
  const own = streetKey(spec.street);
  const streets = spec.labels.map((l) => l.text).filter((t) => streetKey(t) !== own);
  const near = streets.length ? `, with ${listWords(streets.slice(0, 3))} nearby` : '';
  return `Street map of ${townName} centered on the ${spec.label}${near}. The marked area shows the block, not an exact address.`;
}

const listWords = (xs: string[]) =>
  xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const ABBREVIATIONS: Record<string, string> = {
  rd: 'road',
  st: 'street',
  ave: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  pkwy: 'parkway',
  hwy: 'highway',
  pl: 'place',
  ter: 'terrace',
  cir: 'circle',
  trl: 'trail',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
};

/** "W. Palmetto Park Rd" and "West Palmetto Park Road" compare equal. */
export const streetKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\./g, '')
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(' ');
