// A minimal protocol-buffers reader: just what the OpenStreetMap PBF format needs (varints,
// zigzag sint64, length-delimited fields and packed repeated numbers). OSM ids and coordinates
// fit in a double's 53 bits, so plain numbers are used rather than BigInt.

export class ProtoReader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.buf[this.pos++];
      if (byte === undefined) throw new Error('truncated varint');
      result += (byte & 0x7f) * shift;
      if (byte < 0x80) return result;
      shift *= 128;
    }
  }

  /** A zigzag-encoded signed varint (sint32/sint64). */
  svarint(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /** Field number and wire type of the next field. */
  tag(): { field: number; wire: number } {
    const t = this.varint();
    return { field: Math.floor(t / 8), wire: t % 8 };
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Read the length first: `this.pos += this.varint()` would add it to the position from
      // before the length's own bytes.
      const len = this.varint();
      this.pos += len;
    } else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }

  /** A packed repeated field of (zigzag-decoded when `signed`) varints. */
  packed(signed = false): number[] {
    const end = this.varint() + this.pos;
    const out: number[] = [];
    while (this.pos < end) out.push(signed ? this.svarint() : this.varint());
    return out;
  }
}
