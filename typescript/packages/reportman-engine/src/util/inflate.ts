// A zlib (RFC 1950) and DEFLATE (RFC 1951) decoder: StreamUtil.DeCompressStream of the C# engine
// (SharpZipLib InflaterInputStream), which the engine uses for the compressed images embedded in
// a report. Like SharpZipLib it checks the header, the stored block lengths, the codes and the
// Adler-32 of the data, and fails when the data ends early.

/** An error of the compressed data (SharpZipBaseException). */
export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InflateError';
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: the count of codes of each length and the symbols in code order. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i] as number]!++;
  counts[0] = 0;
  // An over-subscribed set of lengths is not a code
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left <<= 1;
    left -= counts[len] as number;
    if (left < 0) throw new InflateError('Invalid Huffman code lengths');
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = (offs[len] as number) + (counts[len] as number);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const len = lengths[i] as number;
    if (len !== 0) symbols[offs[len]!++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  pos: number;
  private bitbuf = 0;
  private bitcnt = 0;
  constructor(
    readonly data: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }

  bits(need: number): number {
    let val = this.bitbuf;
    while (this.bitcnt < need) {
      if (this.pos >= this.data.length) throw new InflateError('Unexpected EOF');
      val |= (this.data[this.pos++] as number) << this.bitcnt;
      this.bitcnt += 8;
    }
    this.bitbuf = val >>> need;
    this.bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  /** Drops the bits left in the current byte (a stored block starts on a byte). */
  align(): void {
    this.bitbuf = 0;
    this.bitcnt = 0;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = h.counts[len] as number;
      if (code - count < first) return h.symbols[index + (code - first)] as number;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new InflateError('Invalid Huffman code');
  }
}

class Output {
  buf = new Uint8Array(1 << 16);
  len = 0;
  push(b: number): void {
    if (this.len === this.buf.length) this.grow(1);
    this.buf[this.len++] = b;
  }
  grow(extra: number): void {
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const n = new Uint8Array(cap);
    n.set(this.buf.subarray(0, this.len));
    this.buf = n;
  }
}

let fixedLit: Huffman | null = null;
let fixedDist: Huffman | null = null;

function fixedCodes(): [Huffman, Huffman] {
  if (fixedLit === null || fixedDist === null) {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    fixedLit = huffman(l, 288);
    fixedDist = huffman(new Uint8Array(30).fill(5), 30);
  }
  return [fixedLit, fixedDist];
}

function codes(br: BitReader, out: Output, lit: Huffman, dist: Huffman): void {
  for (;;) {
    let sym = br.decode(lit);
    if (sym < 256) out.push(sym);
    else if (sym === 256) return;
    else {
      sym -= 257;
      if (sym >= 29) throw new InflateError('Illegal literal length code');
      const len = (LENGTH_BASE[sym] as number) + br.bits(LENGTH_EXTRA[sym] as number);
      const dsym = br.decode(dist);
      if (dsym >= 30) throw new InflateError('Illegal distance code');
      const d = (DIST_BASE[dsym] as number) + br.bits(DIST_EXTRA[dsym] as number);
      if (d > out.len) throw new InflateError('Illegal distance: too far back');
      if (out.len + len > out.buf.length) out.grow(len);
      for (let i = 0; i < len; i++) {
        out.buf[out.len] = out.buf[out.len - d] as number;
        out.len++;
      }
    }
  }
}

function dynamicCodes(br: BitReader): [Huffman, Huffman] {
  const nlen = br.bits(5) + 257;
  const ndist = br.bits(5) + 1;
  const ncode = br.bits(4) + 4;
  if (nlen > 286 || ndist > 30) throw new InflateError('Illegal code counts');
  const lengths = new Uint8Array(320);
  for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i] as number] = br.bits(3);
  const lencode = huffman(lengths, 19);
  let index = 0;
  const all = new Uint8Array(nlen + ndist);
  while (index < nlen + ndist) {
    const sym = br.decode(lencode);
    if (sym < 16) all[index++] = sym;
    else {
      let len = 0;
      let rep: number;
      if (sym === 16) {
        if (index === 0) throw new InflateError('Repeat with no first length');
        len = all[index - 1] as number;
        rep = 3 + br.bits(2);
      } else if (sym === 17) rep = 3 + br.bits(3);
      else rep = 11 + br.bits(7);
      if (index + rep > nlen + ndist) throw new InflateError('Too many code lengths');
      while (rep-- > 0) all[index++] = len;
    }
  }
  if (all[256] === 0) throw new InflateError('No end of block code');
  return [huffman(all.subarray(0, nlen), nlen), huffman(all.subarray(nlen), ndist)];
}

/** Inflates raw DEFLATE data from a position; returns the bytes and where the data ended. */
function inflateRaw(data: Uint8Array, start: number): { bytes: Uint8Array; end: number } {
  const br = new BitReader(data, start);
  const out = new Output();
  let last: number;
  do {
    last = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.align();
      if (br.pos + 4 > data.length) throw new InflateError('Unexpected EOF');
      const len = (data[br.pos] as number) | ((data[br.pos + 1] as number) << 8);
      const nlen = (data[br.pos + 2] as number) | ((data[br.pos + 3] as number) << 8);
      if (len !== (~nlen & 0xffff)) throw new InflateError('Broken uncompressed block');
      br.pos += 4;
      if (br.pos + len > data.length) throw new InflateError('Unexpected EOF');
      if (out.len + len > out.buf.length) out.grow(len);
      out.buf.set(data.subarray(br.pos, br.pos + len), out.len);
      out.len += len;
      br.pos += len;
    } else if (type === 1) {
      const [lit, dist] = fixedCodes();
      codes(br, out, lit, dist);
    } else if (type === 2) {
      const [lit, dist] = dynamicCodes(br);
      codes(br, out, lit, dist);
    } else throw new InflateError('Illegal block type');
  } while (last === 0);
  br.align();
  return { bytes: out.buf.slice(0, out.len), end: br.pos };
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] as number)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Decompresses a zlib stream (StreamUtil.DeCompressStream); bytes after its end are ignored. */
export function inflateZlib(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new InflateError('Unexpected EOF');
  const cmf = data[0] as number;
  const flg = data[1] as number;
  if (((cmf << 8) | flg) % 31 !== 0) throw new InflateError('Header checksum illegal');
  if ((cmf & 0x0f) !== 8) throw new InflateError('Compression Method unknown');
  if ((flg & 0x20) !== 0) throw new InflateError('Dictionary is not supported');
  const { bytes, end } = inflateRaw(data, 2);
  if (end + 4 > data.length) throw new InflateError('Unexpected EOF');
  const stored = (((data[end] as number) << 24) | ((data[end + 1] as number) << 16) | ((data[end + 2] as number) << 8) | (data[end + 3] as number)) >>> 0;
  const computed = adler32(bytes);
  if (stored !== computed) throw new InflateError('Adler chksum doesn\'t match: ' + computed.toString(16) + ' vs. ' + stored.toString(16));
  return bytes;
}
