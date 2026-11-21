// A GIF decoder for the first frame, giving the pixels SkiaSharp gives the C# engine (SKBitmap.Decode
// with the Wuffs GIF codec of Skia, then its Pixels):
//   - the image is the logical screen, grown to the bounds of the first frame when it goes past
//     them (Wuffs without QUIRK_IMAGE_BOUNDS_ARE_STRICT); outside the frame it is transparent;
//   - the palette is the local one of the frame or the global one, padded with opaque black (an
//     image without a palette is black); the transparent index of a graphic control extension
//     gives (0, 0, 0, 0); the background color is not used;
//   - interlaced frames are deinterlaced; pixel data past the frame is ignored
//     (QUIRK_IGNORE_TOO_MUCH_PIXEL_DATA);
//   - a frame with less pixel data than it needs, an invalid LZW code or literal width (only 2 to
//     8), a bad block or a file without a frame is not decoded (null); a file cut inside the pixel
//     data keeps the pixels decoded and the rest is transparent (SKBitmap.Decode accepts an
//     incomplete input).

import type { RgbaImage } from './rgbaimage.js';

/** The sniffing of the GIF codec of Skia: the bytes start with GIF8. */
export function isGifSignature(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38;
}

class Truncated extends Error {}

class Reader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.data.length) throw new Truncated();
    return this.data[this.pos++] as number;
  }
  u16(): number {
    const lo = this.u8();
    return lo | (this.u8() << 8);
  }
  skip(n: number): void {
    if (this.pos + n > this.data.length) throw new Truncated();
    this.pos += n;
  }
}

/** Skips the sub-blocks of an extension (to the zero length block). */
function skipSubBlocks(r: Reader): void {
  for (;;) {
    const n = r.u8();
    if (n === 0) return;
    r.skip(n);
  }
}

interface FrameHeader {
  x: number;
  y: number;
  w: number;
  h: number;
  interlaced: boolean;
  palette: Uint8Array | null;
}

/**
 * Decodes the first frame of a GIF as SKBitmap.Decode and SKBitmap.Pixels do; null when Skia
 * gives no bitmap.
 */
export function decodeGif(data: Uint8Array): RgbaImage | null {
  const r = new Reader(data);
  let globalPalette: Uint8Array | null = null;
  let transparent = -1;
  try {
    if (data.length < 6) return null;
    const sig = String.fromCharCode(...data.subarray(0, 6));
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
    r.skip(6);
    const screenW = r.u16();
    const screenH = r.u16();
    const flags = r.u8();
    r.u8(); // background color index (not used)
    r.u8(); // pixel aspect ratio
    if ((flags & 0x80) !== 0) {
      const n = 2 << (flags & 7);
      r.skip(n * 3);
      globalPalette = data.slice(r.pos - n * 3, r.pos);
    }
    for (;;) {
      const block = r.u8();
      if (block === 0x21) {
        const label = r.u8();
        if (label === 0xf9) {
          // Graphic control extension: 4 bytes and the block terminator
          if (r.u8() !== 4) return null;
          const gflags = r.u8();
          r.u16(); // delay
          const index = r.u8();
          if (r.u8() !== 0) return null;
          transparent = (gflags & 1) !== 0 ? index : -1;
        } else skipSubBlocks(r);
      } else if (block === 0x2c) {
        const x = r.u16();
        const y = r.u16();
        const w = r.u16();
        const h = r.u16();
        const fflags = r.u8();
        let palette: Uint8Array | null = null;
        if ((fflags & 0x80) !== 0) {
          const n = 2 << (fflags & 7);
          r.skip(n * 3);
          palette = data.slice(r.pos - n * 3, r.pos);
        }
        const frame: FrameHeader = { x, y, w, h, interlaced: (fflags & 0x40) !== 0, palette: palette ?? globalPalette };
        const width = Math.max(screenW, x + w);
        const height = Math.max(screenH, y + h);
        return decodeFrame(r, frame, width, height, transparent);
      } else return null; // the trailer (no frame) or a bad block
    }
  } catch (e) {
    // Cut before the pixel data: Skia has no codec
    if (e instanceof Truncated) return null;
    throw e;
  }
}

/** The pixel data of the frame (LZW in sub-blocks) into the image. */
function decodeFrame(r: Reader, f: FrameHeader, width: number, height: number, transparent: number): RgbaImage | null {
  // The palette as RGBA, 256 entries, padded with opaque black
  const pal = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    if (f.palette !== null && i * 3 < f.palette.length) {
      pal[i * 4] = f.palette[i * 3] as number;
      pal[i * 4 + 1] = f.palette[i * 3 + 1] as number;
      pal[i * 4 + 2] = f.palette[i * 3 + 2] as number;
    }
    pal[i * 4 + 3] = 255;
  }
  if (transparent >= 0) pal.fill(0, transparent * 4, transparent * 4 + 4);
  const out = new Uint8Array(width * height * 4);
  const image: RgbaImage = { width, height, pixels: out };
  const literalWidth = r.u8();
  if (literalWidth < 2 || literalWidth > 8) return null;
  // The row of each line of the frame, in the order of the data
  const total = f.w * f.h;
  const rows: number[] = [];
  if (f.interlaced) {
    for (const [start, step] of [
      [0, 8],
      [4, 8],
      [2, 4],
      [1, 2],
    ] as const)
      for (let y = start; y < f.h; y += step) rows.push(y);
  } else for (let y = 0; y < f.h; y++) rows.push(y);
  let written = 0;
  const put = (index: number): void => {
    if (written >= total) return; // too much pixel data: ignored
    const row = rows[Math.floor(written / f.w)] as number;
    const col = written % f.w;
    const p = ((f.y + row) * width + f.x + col) * 4;
    out[p] = pal[index * 4] as number;
    out[p + 1] = pal[index * 4 + 1] as number;
    out[p + 2] = pal[index * 4 + 2] as number;
    out[p + 3] = pal[index * 4 + 3] as number;
    written++;
  };
  // The LZW decoder (as Wuffs: the table is full at 4096 codes, then no code is added)
  const clear = 1 << literalWidth;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    first[i] = i;
    lengths[i] = 1;
  }
  let codeWidth = literalWidth + 1;
  let next = end + 1;
  let prev = -1;
  let bits = 0;
  let nbits = 0;
  const stack = new Uint8Array(4096);
  const emit = (code: number): void => {
    const n = lengths[code] as number;
    let c = code;
    for (let i = n - 1; i >= 0; i--) {
      stack[i] = suffix[c] as number;
      c = prefix[c] as number;
    }
    for (let i = 0; i < n; i++) put(stack[i] as number);
  };
  let ended = false;
  try {
    for (;;) {
      const n = r.u8();
      if (n === 0) break;
      for (let i = 0; i < n; i++) {
        bits |= r.u8() << nbits;
        nbits += 8;
        while (!ended && nbits >= codeWidth) {
          const code = bits & ((1 << codeWidth) - 1);
          bits >>>= codeWidth;
          nbits -= codeWidth;
          if (code === clear) {
            codeWidth = literalWidth + 1;
            next = end + 1;
            prev = -1;
            continue;
          }
          if (code === end) {
            ended = true;
            break;
          }
          if (code < clear) emit(code);
          else if (code < next && prev >= 0) emit(code);
          else if (code === next && prev >= 0) {
            // KwKwK: the previous string and its first character
            emit(prev);
            put(first[prev] as number);
          } else return null; // bad code
          if (prev >= 0 && next < 4096) {
            prefix[next] = prev;
            suffix[next] = code === next ? (first[prev] as number) : (first[code] as number);
            first[next] = first[prev] as number;
            lengths[next] = (lengths[prev] as number) + 1;
            next++;
            if (next === 1 << codeWidth && codeWidth < 12) codeWidth++;
          }
          prev = code;
        }
      }
      if (ended) break;
    }
  } catch (e) {
    // Cut inside the pixel data: what was decoded stays, the rest is transparent
    if (e instanceof Truncated) return image;
    throw e;
  }
  // Not enough pixel data
  if (written < total) return null;
  return image;
}
