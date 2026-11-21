// A PNG decoder that gives the pixels SkiaSharp gives the C# engine (SKBitmap.Decode of the PNG,
// then its Pixels): libpng with the transformations Skia asks for (SkPngCodec) and the Skia
// swizzlers, decoded without color management (SKBitmap.Decode drops the color space, so gAMA,
// cHRM, sRGB and iCCP change nothing) and premultiplied when the image has alpha.
//
// Every color type and bit depth, palettes with tRNS, interlaced images. What Skia does, kept:
//   - 16 bit samples keep their high byte (libpng png_set_strip_16 for gray, the Skia swizzlers
//     for color): 0x80FF is 0x80, not rounded;
//   - a translucent pixel goes through the premultiplication of Skia (see skiaRoundTrip), a
//     transparent one becomes (0, 0, 0, 0);
//   - a tRNS color is compared at the bit depth of the image (the low byte of an 8 bit one);
//   - an RGB image with an sBIT of 5, 6, 5 is decoded as RGB 565 (the precision of 565), and is
//     not decoded at all (null) when it also has tRNS;
//   - a gray and alpha image with an sBIT of 1 for gray and 8 for alpha is decoded as alpha only;
//   - a palette index past the palette takes the last color;
//   - a truncated image keeps the rows decoded and the rest is zero (transparent, or black in the
//     opaque color types), as SKBitmap.Decode accepts an incomplete input;
//   - an image libpng rejects (bad signature, header, CRC of a critical chunk, filter or zlib
//     data) is not decoded (null).
// Not ported: a truncated interlaced image (Skia leaves the rows of the passes not decoded
// uninitialized, so there is no defined result to match): it fails with PngIncompleteError.

import { Inflate } from 'fflate';
import { skiaRoundTrip, type RgbaImage } from './rgbaimage.js';

/** A truncated interlaced PNG, which has no defined result in the C# engine. */
export class PngIncompleteError extends Error {
  constructor() {
    super('A truncated interlaced PNG image is not supported by the TypeScript PDF writer (reportman-pdf)');
    this.name = 'PngIncompleteError';
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** png_sig_cmp over the bytes there are (up to 8): the sniffing of SkPngCodec::IsPng. */
export function isPngSignature(data: Uint8Array): boolean {
  const n = Math.min(8, data.length);
  if (n < 1) return false;
  for (let i = 0; i < n; i++) if (data[i] !== SIGNATURE[i]) return false;
  return true;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data: Uint8Array, start: number, end: number): number {
  let c = -1;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function u32(data: Uint8Array, pos: number): number {
  return (((data[pos] as number) << 24) | ((data[pos + 1] as number) << 16) | ((data[pos + 2] as number) << 8) | (data[pos + 3] as number)) >>> 0;
}

/** The libpng default user limits (PNG_USER_WIDTH_MAX and PNG_USER_HEIGHT_MAX). */
const USER_MAX = 1000000;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: boolean;
}

function validHeader(h: Header, compression: number, filter: number, interlace: number): boolean {
  if (h.width < 1 || h.width > USER_MAX || h.height < 1 || h.height > USER_MAX) return false;
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return false;
  const bd = h.bitDepth;
  if (bd !== 1 && bd !== 2 && bd !== 4 && bd !== 8 && bd !== 16) return false;
  switch (h.colorType) {
    case 0:
      return true;
    case 3:
      return bd <= 8;
    case 2:
    case 4:
    case 6:
      return bd >= 8;
    default:
      return false;
  }
}

function validChunkName(data: Uint8Array, pos: number): boolean {
  for (let i = 0; i < 4; i++) {
    const c = data[pos + i] as number;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  }
  return true;
}

/** The chunks libpng reads before and with the image data. */
interface Chunks {
  header: Header;
  palette: Uint8Array | null;
  /** tRNS: the alphas of the palette, or the gray / RGB key as 16 bit values. */
  trnsAlphas: Uint8Array | null;
  trnsKey: number[] | null;
  sbit: number[] | null;
  idat: Uint8Array[];
}

/** Reads the chunks as libpng does (null when it fails). */
function readChunks(data: Uint8Array): Chunks | null {
  if (data.length < 8) return null;
  let pos = 8;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let havePlte = false;
  let trnsAlphas: Uint8Array | null = null;
  let trnsKey: number[] | null = null;
  let haveTrns = false;
  let sbit: number[] | null = null;
  let haveSbit = false;
  const idat: Uint8Array[] = [];
  let haveIdat = false;
  let afterIdat = false;
  while (pos + 8 <= data.length) {
    const length = u32(data, pos);
    if (length > 0x7fffffff) return null;
    if (!validChunkName(data, pos + 4)) return null;
    const type = String.fromCharCode(data[pos + 4] as number, data[pos + 5] as number, data[pos + 6] as number, data[pos + 7] as number);
    const start = pos + 8;
    const end = start + length;
    const complete = end + 4 <= data.length;
    const body = data.subarray(start, Math.min(end, data.length));
    const crcOk = complete && crc32(data, pos + 4, end) === u32(data, end);
    const critical = ((data[pos + 4] as number) & 0x20) === 0;
    if (header === null && type !== 'IHDR') return null;
    // Skia reads the header up to the first image data: a truncated header is not an image
    if (!complete && !haveIdat && type !== 'IDAT') return null;
    if (!complete && haveIdat) {
      if (type === 'IDAT' && !afterIdat) idat.push(body);
      break;
    }
    if (critical && complete && !crcOk) return null;
    switch (type) {
      case 'IHDR': {
        if (header !== null || length !== 13) return null;
        header = {
          width: u32(body, 0),
          height: u32(body, 4),
          bitDepth: body[8] as number,
          colorType: body[9] as number,
          interlace: body[12] === 1,
        };
        if (!validHeader(header, body[10] as number, body[11] as number, body[12] as number)) return null;
        break;
      }
      case 'PLTE': {
        if (havePlte) return null; // duplicate
        if (haveIdat) break; // out of place
        havePlte = true;
        const h = header as Header;
        if (h.colorType === 0 || h.colorType === 4) break; // ignored in grayscale PNG
        if (length > 3 * 256 || length % 3 !== 0) {
          if (h.colorType === 3) return null;
          break;
        }
        let num = length / 3;
        if (h.colorType === 3) {
          num = Math.min(num, 1 << h.bitDepth);
          if (num === 0) return null;
        }
        palette = body.slice(0, num * 3);
        break;
      }
      case 'IDAT': {
        const h = header as Header;
        if (h.colorType === 3 && palette === null) return null;
        haveIdat = true;
        // C# parity: libpng warns about (and skips) image data after other chunks
        if (!afterIdat) idat.push(body);
        break;
      }
      case 'IEND':
        pos = data.length;
        continue;
      case 'tRNS': {
        const h = header as Header;
        if (haveIdat || haveTrns || !crcOk) break;
        if (h.colorType === 0) {
          if (length !== 2) break;
          trnsKey = [(body[0]! << 8) | body[1]!];
        } else if (h.colorType === 2) {
          if (length !== 6) break;
          trnsKey = [(body[0]! << 8) | body[1]!, (body[2]! << 8) | body[3]!, (body[4]! << 8) | body[5]!];
        } else if (h.colorType === 3) {
          if (palette === null) break; // out of place
          if (length > palette.length / 3 || length === 0) break;
          trnsAlphas = body.slice();
        } else break; // invalid with alpha channel
        haveTrns = true;
        break;
      }
      case 'sBIT': {
        const h = header as Header;
        if (haveIdat || havePlte || haveSbit) break;
        const truelen = h.colorType === 3 ? 3 : (CHANNELS[h.colorType] as number);
        const sampleDepth = h.colorType === 3 ? 8 : h.bitDepth;
        if (length !== truelen || length > 4 || !crcOk) break;
        let ok = true;
        for (let i = 0; i < truelen; i++) if (body[i] === 0 || (body[i] as number) > sampleDepth) ok = false;
        if (!ok) break;
        sbit = [...body];
        haveSbit = true;
        break;
      }
      default:
        // libpng: an unknown critical chunk is an error, an ancillary one is skipped
        if (critical) return null;
        break;
    }
    if (haveIdat && type !== 'IDAT') afterIdat = true;
    pos = end + 4;
  }
  if (header === null || !haveIdat) return null;
  return { header, palette, trnsAlphas, trnsKey, sbit, idat };
}

/** The zlib data of the image, inflated as far as it goes; null when zlib fails. */
function inflateIdat(idat: Uint8Array[]): Uint8Array | null {
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  // A truncated header is waited for: no rows
  if (z.length < 2) return new Uint8Array(0);
  const cmf = z[0] as number;
  const flg = z[1] as number;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  const inflater = new Inflate((chunk) => {
    parts.push(chunk);
    size += chunk.length;
  });
  try {
    // Not final: a truncated stream gives what it has (C# parity: the Adler-32 is not checked,
    // libpng only warns about it once the rows are complete)
    inflater.push(z.subarray(2), false);
  } catch {
    return null;
  }
  const out = new Uint8Array(size);
  o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Undoes the filter of a row in place; false for a bad filter type. */
function unfilter(filter: number, row: Uint8Array, prior: Uint8Array | null, bpp: number): boolean {
  const n = row.length;
  switch (filter) {
    case 0:
      return true;
    case 1:
      for (let i = bpp; i < n; i++) row[i] = ((row[i] as number) + (row[i - bpp] as number)) & 0xff;
      return true;
    case 2:
      if (prior !== null) for (let i = 0; i < n; i++) row[i] = ((row[i] as number) + (prior[i] as number)) & 0xff;
      return true;
    case 3:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? (row[i - bpp] as number) : 0;
        const up = prior !== null ? (prior[i] as number) : 0;
        row[i] = ((row[i] as number) + ((left + up) >> 1)) & 0xff;
      }
      return true;
    case 4:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? (row[i - bpp] as number) : 0;
        const up = prior !== null ? (prior[i] as number) : 0;
        const ul = i >= bpp && prior !== null ? (prior[i - bpp] as number) : 0;
        row[i] = ((row[i] as number) + paeth(left, up, ul)) & 0xff;
      }
      return true;
    default:
      return false;
  }
}

/** How Skia decodes the image (its SkEncodedInfo color and the color type of the bitmap). */
enum Target {
  /** kGray_8: gray, opaque. */
  Gray,
  /** kAlpha_8 (kXAlpha_Color): alpha only, black. */
  Alpha,
  /** kRGB_565: opaque, 5-6-5 precision. */
  Rgb565,
  /** kBGRA_8888 premultiplied (or opaque). */
  N32,
}

/** A row of samples: the sample at an index, at the bit depth of the image. */
function sampleAt(row: Uint8Array, index: number, bitDepth: number): number {
  switch (bitDepth) {
    case 16:
      return ((row[index * 2] as number) << 8) | (row[index * 2 + 1] as number);
    case 8:
      return row[index] as number;
    default: {
      const bit = index * bitDepth;
      return ((row[bit >> 3] as number) >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
    }
  }
}

/** The 8 bit value of a sample (libpng expands gray of 1, 2 and 4 bits, 16 bits keep the high byte). */
function to8(v: number, bitDepth: number): number {
  switch (bitDepth) {
    case 1:
      return v * 0xff;
    case 2:
      return v * 0x55;
    case 4:
      return v * 0x11;
    case 16:
      return v >> 8;
    default:
      return v;
  }
}

/** SkPack888ToRGB16 then SkPixel16ToColor: the color an RGB 565 bitmap gives back. */
function rgb565(r: number, g: number, b: number, out: Uint8Array, o: number): void {
  const r5 = r >> 3;
  const g6 = g >> 2;
  const b5 = b >> 3;
  out[o] = (r5 << 3) | (r5 >> 2);
  out[o + 1] = (g6 << 2) | (g6 >> 4);
  out[o + 2] = (b5 << 3) | (b5 >> 2);
  out[o + 3] = 255;
}

/** Converts the unfiltered rows to the pixels of the Skia bitmap. */
class PixelConverter {
  readonly target: Target;
  private readonly colorTable: Uint8Array | null = null;
  private readonly ch: Chunks;

  constructor(ch: Chunks) {
    this.ch = ch;
    const h = ch.header;
    const sbit = ch.sbit;
    switch (h.colorType) {
      case 0:
        this.target = ch.trnsKey !== null ? Target.N32 : Target.Gray;
        break;
      case 2:
        this.target = sbit !== null && sbit[0] === 5 && sbit[1] === 6 && sbit[2] === 5 ? Target.Rgb565 : Target.N32;
        break;
      case 4:
        this.target = sbit !== null && sbit[0] === 1 && sbit[1] === 8 ? Target.Alpha : Target.N32;
        break;
      default:
        this.target = Target.N32;
        break;
    }
    if (h.colorType === 3) {
      // SkPngCodec::createColorTable: the alphas of tRNS premultiplied, the table padded with
      // its last color
      const pal = ch.palette as Uint8Array;
      const numColors = pal.length / 3;
      const alphas = ch.trnsAlphas;
      const t = new Uint8Array(256 * 4);
      for (let i = 0; i < numColors; i++) {
        const a = alphas !== null && i < alphas.length ? (alphas[i] as number) : 255;
        t[i * 4] = skiaRoundTrip(pal[i * 3] as number, a);
        t[i * 4 + 1] = skiaRoundTrip(pal[i * 3 + 1] as number, a);
        t[i * 4 + 2] = skiaRoundTrip(pal[i * 3 + 2] as number, a);
        t[i * 4 + 3] = a;
      }
      for (let i = numColors; i < 256; i++) t.copyWithin(i * 4, (numColors - 1) * 4, numColors * 4);
      this.colorTable = t;
    }
  }

  /** The bitmap value of memory left zero (rows not decoded). */
  zeroPixel(out: Uint8Array, o: number): void {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = this.target === Target.Gray || this.target === Target.Rgb565 ? 255 : 0;
  }

  /** Converts a row of samples (unfiltered, width pixels) into the output at a pixel offset. */
  convertRow(row: Uint8Array, width: number, out: Uint8Array, o: number, xStart: number, xStep: number): void {
    const h = this.ch.header;
    const bd = h.bitDepth;
    switch (h.colorType) {
      case 0: {
        const key = this.ch.trnsKey;
        for (let x = 0; x < width; x++) {
          const p = o + (xStart + x * xStep) * 4;
          const g = sampleAt(row, x, bd);
          const g8 = to8(g, bd);
          // png_do_expand: the key at the bit depth (its low bits, its low byte at 8 bits)
          let transparent = false;
          if (key !== null) {
            const k = key[0] as number;
            transparent = bd === 16 ? g === k : bd === 8 ? g === (k & 0xff) : g === (k & ((1 << bd) - 1));
          }
          if (transparent) {
            out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
          } else {
            out[p] = out[p + 1] = out[p + 2] = g8;
            out[p + 3] = 255;
          }
        }
        break;
      }
      case 2: {
        const key = this.ch.trnsKey;
        for (let x = 0; x < width; x++) {
          const p = o + (xStart + x * xStep) * 4;
          const r = to8(sampleAt(row, x * 3, bd), bd);
          const g = to8(sampleAt(row, x * 3 + 1, bd), bd);
          const b = to8(sampleAt(row, x * 3 + 2, bd), bd);
          if (this.target === Target.Rgb565) rgb565(r, g, b, out, p);
          else if (key !== null && this.keyMatches(row, x, bd, key)) {
            out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
          } else {
            out[p] = r;
            out[p + 1] = g;
            out[p + 2] = b;
            out[p + 3] = 255;
          }
        }
        break;
      }
      case 3: {
        const t = this.colorTable as Uint8Array;
        for (let x = 0; x < width; x++) {
          const p = o + (xStart + x * xStep) * 4;
          const i = sampleAt(row, x, bd) * 4;
          out[p] = t[i] as number;
          out[p + 1] = t[i + 1] as number;
          out[p + 2] = t[i + 2] as number;
          out[p + 3] = t[i + 3] as number;
        }
        break;
      }
      case 4: {
        for (let x = 0; x < width; x++) {
          const p = o + (xStart + x * xStep) * 4;
          const g = to8(sampleAt(row, x * 2, bd), bd);
          const a = to8(sampleAt(row, x * 2 + 1, bd), bd);
          if (this.target === Target.Alpha) {
            out[p] = out[p + 1] = out[p + 2] = 0;
          } else {
            const v = skiaRoundTrip(g, a);
            out[p] = out[p + 1] = out[p + 2] = v;
          }
          out[p + 3] = a;
        }
        break;
      }
      default: {
        for (let x = 0; x < width; x++) {
          const p = o + (xStart + x * xStep) * 4;
          const a = to8(sampleAt(row, x * 4 + 3, bd), bd);
          out[p] = skiaRoundTrip(to8(sampleAt(row, x * 4, bd), bd), a);
          out[p + 1] = skiaRoundTrip(to8(sampleAt(row, x * 4 + 1, bd), bd), a);
          out[p + 2] = skiaRoundTrip(to8(sampleAt(row, x * 4 + 2, bd), bd), a);
          out[p + 3] = a;
        }
        break;
      }
    }
  }

  /** png_do_expand of an RGB key: the low bytes at 8 bits, the whole values at 16. */
  private keyMatches(row: Uint8Array, x: number, bd: number, key: number[]): boolean {
    const mask = bd === 16 ? 0xffff : 0xff;
    return (
      sampleAt(row, x * 3, bd) === ((key[0] as number) & mask) &&
      sampleAt(row, x * 3 + 1, bd) === ((key[1] as number) & mask) &&
      sampleAt(row, x * 3 + 2, bd) === ((key[2] as number) & mask)
    );
  }
}

const PASSES: [number, number, number, number][] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * Decodes a PNG as SKBitmap.Decode and SKBitmap.Pixels do; null when Skia gives no bitmap. A
 * truncated interlaced image fails (PngIncompleteError).
 */
export function decodePng(data: Uint8Array): RgbaImage | null {
  if (!isPngSignature(data)) return null;
  const ch = readChunks(data);
  if (ch === null) return null;
  const h = ch.header;
  // An RGB image with an sBIT of 5, 6, 5 and tRNS: Skia decodes it as 565 with alpha, which it
  // cannot convert (no bitmap)
  const sbit = ch.sbit;
  if (h.colorType === 2 && ch.trnsKey !== null && sbit !== null && sbit[0] === 5 && sbit[1] === 6 && sbit[2] === 5) return null;
  const raw = inflateIdat(ch.idat);
  if (raw === null) return null;
  const bitsPerPixel = (CHANNELS[h.colorType] as number) * h.bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const conv = new PixelConverter(ch);
  const out = new Uint8Array(h.width * h.height * 4);
  if (!h.interlace) {
    const rowBytes = Math.ceil((h.width * bitsPerPixel) / 8);
    const rows = Math.min(h.height, Math.floor(raw.length / (rowBytes + 1)));
    let prior: Uint8Array | null = null;
    for (let y = 0; y < rows; y++) {
      const start = y * (rowBytes + 1);
      const row = raw.slice(start + 1, start + 1 + rowBytes);
      if (!unfilter(raw[start] as number, row, prior, bpp)) return null;
      conv.convertRow(row, h.width, out, y * h.width * 4, 0, 1);
      prior = row;
    }
    for (let p = rows * h.width * 4; p < out.length; p += 4) conv.zeroPixel(out, p);
    return { width: h.width, height: h.height, pixels: out };
  }
  let pos = 0;
  for (const [x0, y0, dx, dy] of PASSES) {
    const pw = Math.ceil((h.width - x0) / dx);
    const ph = Math.ceil((h.height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rowBytes = Math.ceil((pw * bitsPerPixel) / 8);
    let prior: Uint8Array | null = null;
    for (let py = 0; py < ph; py++) {
      if (pos + rowBytes + 1 > raw.length) throw new PngIncompleteError();
      const row = raw.slice(pos + 1, pos + 1 + rowBytes);
      if (!unfilter(raw[pos] as number, row, prior, bpp)) return null;
      const y = y0 + py * dy;
      conv.convertRow(row, pw, out, y * h.width * 4, x0, dx);
      prior = row;
      pos += rowBytes + 1;
    }
  }
  return { width: h.width, height: h.height, pixels: out };
}
