// WOFF2 web fonts (https://www.w3.org/TR/WOFF2/): the tables of an sfnt font compressed together with
// Brotli, the glyf and loca tables usually transformed (the outlines split into streams of contours,
// points, flags, coordinates, components, boxes and instructions) and the hmtx table maybe without
// its left side bearings. The font library reads sfnt files, so a WOFF2 file is rebuilt as an sfnt
// with the same tables: glyf and loca decoded as the reference decoder does it (woff2_dec.cc of
// Google: the points stored with the shortest flags and repeats, each glyph padded to 4 bytes), the
// table records sorted by tag with their checksums. A collection (ttcf) is not read.

import { decompress } from 'brotli/decompress.js';

const WOFF2 = 0x774f4632; // 'wOF2'
const TTCF = 0x74746366; // 'ttcf'

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const tagNumber = (tag: string): number => ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;

/** Whether some bytes start as a WOFF2 file. */
export function isWoff2(head: Uint8Array): boolean {
  return head.length >= 4 && u32(head, 0) === WOFF2;
}

/** A cursor over bytes (the streams of the transformed glyf table). */
class Reader {
  pos: number;
  constructor(
    private readonly b: Uint8Array,
    start = 0,
    private readonly end = b.length,
  ) {
    this.pos = start;
  }
  private need(n: number): void {
    if (this.pos + n > this.end) throw new Error('WOFF2: a stream ends too soon');
  }
  u8(): number {
    this.need(1);
    return this.b[this.pos++]!;
  }
  u16(): number {
    this.need(2);
    const v = u16(this.b, this.pos);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    this.need(4);
    const v = u32(this.b, this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  /** UIntBase128: up to 5 bytes of 7 bits, the high bit says another one follows. */
  base128(): number {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw new Error('WOFF2: a UIntBase128 with a leading zero');
      if (v & 0xfe000000) throw new Error('WOFF2: a UIntBase128 too big');
      v = (v << 7) | (c & 0x7f);
      if ((c & 0x80) === 0) return v >>> 0;
    }
    throw new Error('WOFF2: a UIntBase128 longer than 5 bytes');
  }
  /** 255UInt16. */
  u255(): number {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return this.u8() + 253;
    if (code === 254) return this.u8() + 506;
    return code;
  }
}

/** A growing byte buffer. */
class Writer {
  private buf = new Uint8Array(1024);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  u8(v: number): void {
    this.room(1);
    this.buf[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.room(2);
    this.buf[this.length++] = (v >>> 8) & 0xff;
    this.buf[this.length++] = v & 0xff;
  }
  u32(v: number): void {
    this.u16(v >>> 16);
    this.u16(v & 0xffff);
  }
  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  pad4(): void {
    while (this.length % 4 !== 0) this.u8(0);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

interface Point {
  x: number;
  y: number;
  onCurve: boolean;
}

/** The points of a simple glyph from the flag and coordinate streams (TripletDecode). */
function decodeTriplets(flags: Reader, glyphs: Reader, nPoints: number): Point[] {
  const withSign = (flag: number, v: number): number => (flag & 1 ? v : -v);
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < nPoints; i++) {
    let flag = flags.u8();
    const onCurve = flag >> 7 === 0;
    flag &= 0x7f;
    let dx: number;
    let dy: number;
    if (flag < 10) {
      dx = 0;
      dy = withSign(flag, ((flag & 14) << 7) + glyphs.u8());
    } else if (flag < 20) {
      dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphs.u8());
      dy = 0;
    } else if (flag < 84) {
      const b0 = flag - 20;
      const b1 = glyphs.u8();
      dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
      dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
    } else if (flag < 120) {
      const b0 = flag - 84;
      dx = withSign(flag, 1 + (Math.trunc(b0 / 12) << 8) + glyphs.u8());
      dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8());
    } else if (flag < 124) {
      const b1 = glyphs.u8();
      const b2 = glyphs.u8();
      dx = withSign(flag, (b1 << 4) + (b2 >> 4));
      dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + glyphs.u8());
    } else {
      dx = withSign(flag, glyphs.u16());
      dy = withSign(flag >> 1, glyphs.u16());
    }
    x += dx;
    y += dy;
    points.push({ x, y, onCurve });
  }
  return points;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME = 0x10;
const Y_SAME = 0x20;
const OVERLAP_SIMPLE = 0x40;

/** The flags and coordinates of a simple glyph, as StorePoints of woff2_dec.cc writes them. */
function storePoints(out: Writer, points: Point[], overlap: boolean): void {
  const flags: number[] = [];
  let lastFlag = -1;
  let repeat = 0;
  let lastX = 0;
  let lastY = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  points.forEach((p, i) => {
    let flag = p.onCurve ? ON_CURVE : 0;
    if (overlap && i === 0) flag |= OVERLAP_SIMPLE;
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    if (dx === 0) flag |= X_SAME;
    else if (dx > -256 && dx < 256) flag |= X_SHORT | (dx > 0 ? X_SAME : 0);
    if (dy === 0) flag |= Y_SAME;
    else if (dy > -256 && dy < 256) flag |= Y_SHORT | (dy > 0 ? Y_SAME : 0);
    xs.push(dx);
    ys.push(dy);
    if (flag === lastFlag && repeat !== 255) {
      flags[flags.length - 1] = flags[flags.length - 1]! | REPEAT;
      repeat++;
    } else {
      if (repeat !== 0) flags.push(repeat);
      flags.push(flag);
      repeat = 0;
    }
    lastX = p.x;
    lastY = p.y;
    lastFlag = flag;
  });
  // The repeat count follows the flag it repeats (flags[] holds the flag before its count)
  if (repeat !== 0) flags.push(repeat);
  for (const f of flags) out.u8(f);
  for (const dx of xs) {
    if (dx === 0) continue;
    if (dx > -256 && dx < 256) out.u8(Math.abs(dx));
    else out.u16(dx & 0xffff);
  }
  for (const dy of ys) {
    if (dy === 0) continue;
    if (dy > -256 && dy < 256) out.u8(Math.abs(dy));
    else out.u16(dy & 0xffff);
  }
}

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

/** The glyf and loca tables of a transformed glyf table, and the xMin of each glyph (for hmtx). */
function rebuildGlyf(data: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; indexFormat: number; xMins: number[] } {
  const h = new Reader(data);
  h.u16(); // reserved
  const optionFlags = h.u16();
  const numGlyphs = h.u16();
  const indexFormat = h.u16();
  const sizes = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  let at = h.pos;
  const stream = (size: number): Reader => {
    const r = new Reader(data, at, at + size);
    at += size;
    if (at > data.length) throw new Error('WOFF2: a glyf stream out of the table');
    return r;
  };
  const nContours = stream(sizes[0]!);
  const nPoints = stream(sizes[1]!);
  const flags = stream(sizes[2]!);
  const glyphs = stream(sizes[3]!);
  const composites = stream(sizes[4]!);
  const bboxStream = stream(sizes[5]!);
  const instructions = stream(sizes[6]!);
  const bitmapLength = ((numGlyphs + 31) >> 5) << 2;
  const bboxBitmap = bboxStream.bytes(bitmapLength);
  let overlapBitmap: Uint8Array | null = null;
  if (optionFlags & 1) overlapBitmap = new Reader(data, at, data.length).bytes(bitmapLength);
  const hasBit = (bitmap: Uint8Array, i: number): boolean => (bitmap[i >> 3]! & (0x80 >> (i & 7))) !== 0;
  const out = new Writer();
  const offsets: number[] = [];
  const xMins: number[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(out.length);
    const n = nContours.i16();
    const explicitBox = hasBit(bboxBitmap, g);
    if (n === 0) {
      if (explicitBox) throw new Error('WOFF2: an empty glyph with a box');
      xMins.push(0);
      continue;
    }
    if (n > 0) {
      const ends: number[] = [];
      let total = 0;
      for (let c = 0; c < n; c++) {
        total += nPoints.u255();
        ends.push(total - 1);
      }
      const points = decodeTriplets(flags, glyphs, total);
      const instructionLength = glyphs.u255();
      const code = instructions.bytes(instructionLength);
      let box: number[];
      if (explicitBox) box = [bboxStream.i16(), bboxStream.i16(), bboxStream.i16(), bboxStream.i16()];
      else {
        let xMin = Infinity;
        let yMin = Infinity;
        let xMax = -Infinity;
        let yMax = -Infinity;
        for (const p of points) {
          if (p.x < xMin) xMin = p.x;
          if (p.x > xMax) xMax = p.x;
          if (p.y < yMin) yMin = p.y;
          if (p.y > yMax) yMax = p.y;
        }
        box = [xMin, yMin, xMax, yMax];
      }
      out.u16(n);
      for (const v of box) out.u16(v & 0xffff);
      for (const e of ends) out.u16(e);
      out.u16(instructionLength);
      out.bytes(code);
      storePoints(out, points, overlapBitmap !== null && hasBit(overlapBitmap, g));
      xMins.push(box[0]!);
    } else {
      // A composite glyph: its components as they are, its box always given
      if (!explicitBox) throw new Error('WOFF2: a composite glyph without a box');
      const start = composites.pos;
      let haveInstructions = false;
      let more = true;
      while (more) {
        const f = composites.u16();
        composites.u16(); // glyph index
        composites.bytes(f & ARG_1_AND_2_ARE_WORDS ? 4 : 2);
        if (f & WE_HAVE_A_SCALE) composites.bytes(2);
        else if (f & WE_HAVE_AN_X_AND_Y_SCALE) composites.bytes(4);
        else if (f & WE_HAVE_A_TWO_BY_TWO) composites.bytes(8);
        if (f & WE_HAVE_INSTRUCTIONS) haveInstructions = true;
        more = (f & MORE_COMPONENTS) !== 0;
      }
      const components = data.subarray(start, composites.pos);
      const box = [bboxStream.i16(), bboxStream.i16(), bboxStream.i16(), bboxStream.i16()];
      out.u16(0xffff);
      for (const v of box) out.u16(v & 0xffff);
      out.bytes(components);
      if (haveInstructions) {
        const instructionLength = glyphs.u255();
        out.u16(instructionLength);
        out.bytes(instructions.bytes(instructionLength));
      }
      xMins.push(box[0]!);
    }
    out.pad4();
  }
  offsets.push(out.length);
  const loca = new Writer();
  for (const o of offsets) {
    if (indexFormat === 0) loca.u16(o >>> 1);
    else loca.u32(o);
  }
  return { glyf: out.result(), loca: loca.result(), indexFormat, xMins };
}

/** The hmtx table of a transformed one: the left side bearings that were left out are the xMins. */
function rebuildHmtx(data: Uint8Array, numHMetrics: number, numGlyphs: number, xMins: number[]): Uint8Array {
  const r = new Reader(data);
  const flags = r.u8();
  const advances: number[] = [];
  for (let i = 0; i < numHMetrics; i++) advances.push(r.u16());
  const lsbs: number[] = [];
  for (let i = 0; i < numHMetrics; i++) lsbs.push(flags & 1 ? (xMins[i] ?? 0) : r.i16());
  for (let i = numHMetrics; i < numGlyphs; i++) lsbs.push(flags & 2 ? (xMins[i] ?? 0) : r.i16());
  const out = new Writer();
  for (let i = 0; i < numHMetrics; i++) {
    out.u16(advances[i]!);
    out.u16(lsbs[i]! & 0xffff);
  }
  for (let i = numHMetrics; i < numGlyphs; i++) out.u16(lsbs[i]! & 0xffff);
  return out.result();
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

/** The sfnt font of a WOFF2 file. */
export function woff2ToSfnt(woff2: Uint8Array): Uint8Array {
  if (woff2.length < 48 || u32(woff2, 0) !== WOFF2) throw new Error('Not a WOFF2 font');
  const flavor = u32(woff2, 4);
  if (flavor === TTCF) throw new Error('WOFF2 font collections are not supported');
  const numTables = u16(woff2, 12);
  const compressedLength = u32(woff2, 20);
  const r = new Reader(woff2, 48);
  const entries: { tag: string; origLength: number; length: number; transformed: boolean; offset: number }[] = [];
  let total = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const index = flags & 0x3f;
    let tag: string;
    if (index === 63) {
      const t = r.u32();
      tag = String.fromCharCode(t >>> 24, (t >>> 16) & 0xff, (t >>> 8) & 0xff, t & 0xff);
    } else {
      tag = KNOWN_TAGS[index] as string;
      if (tag === undefined) throw new Error('WOFF2: an unknown table index ' + index);
    }
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const origLength = r.base128();
    const length = transformed ? r.base128() : origLength;
    entries.push({ tag, origLength, length, transformed, offset: total });
    total += length;
  }
  const compressed = woff2.subarray(r.pos, r.pos + compressedLength);
  if (compressed.length !== compressedLength) throw new Error('WOFF2: the compressed data ends too soon');
  const stream = decompress(compressed, total) as Uint8Array;
  if (stream.length < total) throw new Error('WOFF2: the compressed data is shorter than its tables');
  const tableOf = (tag: string): Uint8Array | null => {
    const e = entries.find((x) => x.tag === tag);
    return e === undefined ? null : stream.subarray(e.offset, e.offset + e.length);
  };
  const result = new Map<string, Uint8Array>();
  for (const e of entries) if (!e.transformed) result.set(e.tag, stream.subarray(e.offset, e.offset + e.length));
  const glyfEntry = entries.find((x) => x.tag === 'glyf');
  let xMins: number[] = [];
  if (glyfEntry?.transformed === true) {
    const rebuilt = rebuildGlyf(tableOf('glyf') as Uint8Array);
    result.set('glyf', rebuilt.glyf);
    result.set('loca', rebuilt.loca);
    xMins = rebuilt.xMins;
    // head.indexToLocFormat follows the loca that was written
    const head = result.get('head');
    if (head !== undefined && head.length >= 52) {
      const copy = head.slice();
      copy[50] = 0;
      copy[51] = rebuilt.indexFormat;
      result.set('head', copy);
    }
  }
  const hmtxEntry = entries.find((x) => x.tag === 'hmtx');
  if (hmtxEntry?.transformed === true) {
    const hhea = result.get('hhea');
    const maxp = result.get('maxp');
    if (hhea === undefined || maxp === undefined || xMins.length === 0) throw new Error('WOFF2: a transformed hmtx without hhea, maxp or glyf');
    result.set('hmtx', rebuildHmtx(tableOf('hmtx') as Uint8Array, u16(hhea, 34), u16(maxp, 4), xMins));
  }
  // The sfnt: the table records sorted by tag
  const tags = [...result.keys()].sort((a, b) => tagNumber(a) - tagNumber(b));
  let log2 = 0;
  while (1 << (log2 + 1) <= tags.length) log2++;
  const searchRange = (1 << log2) * 16;
  const out = new Writer();
  out.u32(flavor);
  out.u16(tags.length);
  out.u16(searchRange);
  out.u16(log2);
  out.u16(tags.length * 16 - searchRange);
  let offset = 12 + tags.length * 16;
  for (const tag of tags) {
    const data = result.get(tag) as Uint8Array;
    out.u32(tagNumber(tag));
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    offset += (data.length + 3) & ~3;
  }
  for (const tag of tags) {
    out.bytes(result.get(tag) as Uint8Array);
    out.pad4();
  }
  return out.result();
}
