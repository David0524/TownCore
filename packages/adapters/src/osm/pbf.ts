import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { ProtoReader } from './protobuf';

// Reads OpenStreetMap PBF files (https://wiki.openstreetmap.org/wiki/PBF_Format): a sequence of
// [4-byte length][BlobHeader][Blob] frames; each OSMData blob is a zlib-compressed
// PrimitiveBlock holding nodes (plain or dense) and ways. Relations are not needed here.

export type OsmNode = { id: number; lat: number; lon: number };
export type OsmWay = { id: number; tags: Record<string, string>; refs: number[] };
export type PrimitiveBlock = { nodes: OsmNode[]; ways: OsmWay[] };

function parseBlobHeader(buf: Uint8Array): { type: string; size: number } {
  const header = new ProtoReader(buf);
  let type = '';
  let size = 0;
  while (!header.done) {
    const { field, wire } = header.tag();
    if (field === 1) type = new TextDecoder().decode(header.bytes());
    else if (field === 3) size = header.varint();
    else header.skip(wire);
  }
  return { type, size };
}

/**
 * Streams a PBF file's frames (blob type and payload) from disk, one at a time, so a state
 * extract of hundreds of megabytes never sits in memory whole.
 */
export async function* pbfFileFrames(
  path: string,
): AsyncGenerator<{ type: string; blob: Uint8Array }> {
  const file = await open(path, 'r');
  try {
    let pos = 0;
    const read = async (length: number) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await file.read(buf, 0, length, pos);
      pos += bytesRead;
      return bytesRead === length ? new Uint8Array(buf.buffer, buf.byteOffset, length) : null;
    };
    for (;;) {
      const len = await read(4);
      if (!len) return;
      const headerBuf = await read(new DataView(len.buffer, len.byteOffset, 4).getUint32(0));
      if (!headerBuf) throw new Error('truncated PBF header');
      const { type, size } = parseBlobHeader(headerBuf);
      const blob = await read(size);
      if (!blob) throw new Error('truncated PBF blob');
      yield { type, blob };
    }
  } finally {
    await file.close();
  }
}

/** A Blob's uncompressed payload (raw or zlib; other compressions aren't used by Geofabrik). */
export function blobData(blob: Uint8Array): Uint8Array {
  const r = new ProtoReader(blob);
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1) return r.bytes();
    if (field === 3) return inflateSync(r.bytes());
    r.skip(wire);
  }
  throw new Error('PBF blob has no raw or zlib data');
}

/** Decodes a PrimitiveBlock: coordinates in degrees, tags as strings. */
export function decodePrimitiveBlock(data: Uint8Array): PrimitiveBlock {
  const r = new ProtoReader(data);
  const strings: string[] = [];
  const groups: Uint8Array[] = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1) {
      const st = new ProtoReader(r.bytes());
      const dec = new TextDecoder();
      while (!st.done) {
        const t = st.tag();
        if (t.field === 1) strings.push(dec.decode(st.bytes()));
        else st.skip(t.wire);
      }
    } else if (field === 2) groups.push(r.bytes());
    else if (field === 17) granularity = r.varint();
    else if (field === 19) latOffset = r.varint();
    else if (field === 20) lonOffset = r.varint();
    else r.skip(wire);
  }
  const deg: Deg = (v, axis) => ((axis === 'lat' ? latOffset : lonOffset) + granularity * v) * 1e-9;
  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  for (const g of groups) {
    const gr = new ProtoReader(g);
    while (!gr.done) {
      const { field, wire } = gr.tag();
      if (field === 1) nodes.push(decodeNode(gr.bytes(), deg));
      else if (field === 2) nodes.push(...decodeDense(gr.bytes(), deg));
      else if (field === 3) ways.push(decodeWay(gr.bytes(), strings));
      else gr.skip(wire);
    }
  }
  return { nodes, ways };
}

type Deg = (v: number, axis: 'lat' | 'lon') => number;

function decodeNode(buf: Uint8Array, deg: Deg): OsmNode {
  const r = new ProtoReader(buf);
  let id = 0;
  let lat = 0;
  let lon = 0;
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1) id = r.svarint();
    else if (field === 8) lat = r.svarint();
    else if (field === 9) lon = r.svarint();
    else r.skip(wire);
  }
  return { id, lat: deg(lat, 'lat'), lon: deg(lon, 'lon') };
}

function decodeDense(buf: Uint8Array, deg: Deg): OsmNode[] {
  const r = new ProtoReader(buf);
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1) ids = r.packed(true);
    else if (field === 8) lats = r.packed(true);
    else if (field === 9) lons = r.packed(true);
    else r.skip(wire);
  }
  const out: OsmNode[] = [];
  let id = 0;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]!;
    lat += lats[i]!;
    lon += lons[i]!;
    out.push({ id, lat: deg(lat, 'lat'), lon: deg(lon, 'lon') });
  }
  return out;
}

function decodeWay(buf: Uint8Array, strings: string[]): OsmWay {
  const r = new ProtoReader(buf);
  let id = 0;
  let keys: number[] = [];
  let vals: number[] = [];
  let refs: number[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1) id = r.varint();
    else if (field === 2) keys = r.packed();
    else if (field === 3) vals = r.packed();
    else if (field === 8) refs = r.packed(true);
    else r.skip(wire);
  }
  const tags: Record<string, string> = {};
  keys.forEach((k, i) => (tags[strings[k]!] = strings[vals[i]!]!));
  let ref = 0;
  return { id, tags, refs: refs.map((d) => (ref += d)) };
}
