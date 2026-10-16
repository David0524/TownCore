import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  bboxAround,
  classifyWay,
  extractBasemap,
  geofabrikStateUrl,
  simplify,
} from '../src/osm/basemap';
import { pbfFileFrames } from '../src/osm/pbf';

// The OSM PBF reader and base-map clipping, against a small file written here to the published
// format (https://wiki.openstreetmap.org/wiki/PBF_Format): a header blob, then one OSMData blob
// with dense nodes and ways, zlib-compressed.

class Writer {
  parts: number[] = [];
  varint(n: number) {
    while (n >= 0x80) {
      this.parts.push((n % 128) | 0x80);
      n = Math.floor(n / 128);
    }
    this.parts.push(n);
    return this;
  }
  zig = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
  tag(field: number, wire: number) {
    return this.varint(field * 8 + wire);
  }
  bytes(field: number, data: Uint8Array) {
    this.tag(field, 2).varint(data.length);
    this.parts.push(...data);
    return this;
  }
  str(field: number, s: string) {
    return this.bytes(field, new TextEncoder().encode(s));
  }
  uint(field: number, n: number) {
    return this.tag(field, 0).varint(n);
  }
  packed(field: number, values: number[], signed = false) {
    const inner = new Writer();
    for (const v of values) inner.varint(signed ? this.zig(v) : v);
    return this.bytes(field, inner.done());
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

const delta = (xs: number[]) => xs.map((x, i) => x - (i ? xs[i - 1]! : 0));

/** A PBF file with the given nodes (degrees) and ways. */
function pbf(
  nodes: Array<{ id: number; lat: number; lon: number }>,
  ways: Array<{ id: number; tags: Record<string, string>; refs: number[] }>,
): Uint8Array {
  const strings = [''];
  const s = (x: string) => (strings.includes(x) ? strings.indexOf(x) : strings.push(x) - 1);
  const wayBufs = ways.map((w) => {
    const keys = Object.keys(w.tags).map(s);
    const vals = Object.values(w.tags).map(s);
    return (
      new Writer()
        .uint(1, w.id)
        .packed(2, keys)
        .packed(3, vals)
        // Info (version, timestamp, …) as real extracts carry it; the reader skips it.
        .bytes(4, new Writer().uint(1, 3).uint(2, 1_700_000_000).done())
        .packed(8, delta(w.refs), true)
        .done()
    );
  });
  const dense = new Writer()
    .packed(1, delta(nodes.map((n) => n.id)), true)
    // Granularity 100 nanodegrees: units of 1e-7 degrees.
    .packed(8, delta(nodes.map((n) => Math.round(n.lat * 1e7))), true)
    .packed(9, delta(nodes.map((n) => Math.round(n.lon * 1e7))), true)
    // DenseInfo and keys_vals, as in Geofabrik extracts: skipped fields with multi-byte lengths.
    .bytes(
      5,
      new Writer()
        .packed(
          1,
          nodes.map(() => 1),
        )
        .packed(
          2,
          nodes.map(() => 200),
        )
        .done(),
    )
    .packed(
      10,
      nodes.map(() => 0),
    )
    .done();
  const group = new Writer().bytes(2, dense);
  for (const w of wayBufs) group.bytes(3, w);
  const table = new Writer();
  for (const x of strings) table.str(1, x);
  const block = new Writer().bytes(1, table.done()).bytes(2, group.done()).done();
  const frame = (type: string, payload: Uint8Array) => {
    const blob = new Writer().uint(2, payload.length).bytes(3, deflateSync(payload)).done();
    const header = new Writer().str(1, type).uint(3, blob.length).done();
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, header.length);
    return [...len, ...header, ...blob];
  };
  return Uint8Array.from([
    ...frame('OSMHeader', new Writer().str(4, 'OsmSchema-V0.6').done()),
    ...frame('OSMData', block),
  ]);
}

describe('OSM base maps', () => {
  it('reads a PBF extract and clips drawn ways to the box', async () => {
    const box = bboxAround(26.35, -80.08, 1);
    const file = pbf(
      [
        { id: 1, lat: 26.35, lon: -80.09 },
        { id: 2, lat: 26.35, lon: -80.085 },
        { id: 3, lat: 26.35, lon: -80.08 },
        { id: 4, lat: 26.5, lon: -80.08 }, // outside the box
        { id: 5, lat: 26.351, lon: -80.081 },
        { id: 6, lat: 26.352, lon: -80.082 },
      ],
      [
        { id: 10, tags: { highway: 'primary', name: 'Palmetto Park Road' }, refs: [1, 2, 3, 4] },
        { id: 11, tags: { highway: 'footway' }, refs: [5, 6] },
        { id: 12, tags: { natural: 'coastline' }, refs: [5, 6] },
      ],
    );
    const dir = mkdtempSync(join(tmpdir(), 'osm-'));
    writeFileSync(join(dir, 'x.osm.pbf'), file);
    const lines = await extractBasemap(pbfFileFrames(join(dir, 'x.osm.pbf')), box);
    expect(lines).toEqual([
      // Straight line: simplified to its ends; the node outside the box is cut off.
      {
        c: 'major',
        n: 'Palmetto Park Road',
        p: [
          [-80.09, 26.35],
          [-80.08, 26.35],
        ],
      },
      {
        c: 'coast',
        p: [
          [-80.081, 26.351],
          [-80.082, 26.352],
        ],
      },
    ]);
  });

  it('draws only roads, waterways and coastline', () => {
    expect(classifyWay({ highway: 'residential' })).toBe('minor');
    expect(classifyWay({ highway: 'tertiary' })).toBe('secondary');
    expect(classifyWay({ waterway: 'canal' })).toBe('water');
    expect(classifyWay({ highway: 'footway' })).toBeNull();
    expect(classifyWay({ building: 'yes' })).toBeNull();
  });

  it('simplifies lines but keeps real bends', () => {
    expect(
      simplify(
        [
          [0, 0],
          [1, 0.000001],
          [2, 0],
          [2, 1],
        ],
        0.0001,
      ),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
    ]);
  });

  it('knows Geofabrik state extract URLs', () => {
    expect(geofabrikStateUrl('FL')).toBe(
      'https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf',
    );
    expect(() => geofabrikStateUrl('ZZ')).toThrow();
  });
});
