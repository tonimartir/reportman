// The image decoding the C# PDF device asks SkiaSharp for (IBitmapInfoProvider of
// PrintOutPDFStandard): the size of an image (GetBitmapInfo, SKBitmap.Decode) and its pixels for
// the formats the PDF writer does not read itself (EncodeImageStreamAsBitmapStream, read back as
// a 32 bit bitmap: RGB and the alpha as a soft mask).
//
// The codecs are tried in the order of SkCodec::MakeFromStream: PNG and GIF are decoded here;
// WebP, ICO / CUR and WBMP, which Skia decodes, are not ported and fail with
// ImageFormatNotSupportedError; bytes no codec of Skia reads give no image (as in C#).

import { getJpegInfo } from './bitmaputil.js';
import { decodeGif, isGifSignature } from './gifdecoder.js';
import { decodePng, isPngSignature } from './pngdecoder.js';
import type { RgbaImage } from './rgbaimage.js';

/** An image format that SkiaSharp decodes for the C# engine but the TypeScript one does not. */
export class ImageFormatNotSupportedError extends Error {
  constructor(format: string) {
    super(format + ' images are not supported yet by the TypeScript PDF writer (reportman-pdf)');
    this.name = 'ImageFormatNotSupportedError';
  }
}

/** The NullReferenceException of PrintOutPDFStandard.GetBitmapInfo for bytes Skia cannot decode. */
export const NULL_REFERENCE = 'Object reference not set to an instance of an object.';

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (data[offset + i] !== bytes[i]) return false;
  return true;
}

const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBPVP = [0x57, 0x45, 0x42, 0x50, 0x56, 0x50];

/** A multi byte integer of WBMP (7 bits per byte, the high bit continues); null when it ends. */
function readMbf(data: Uint8Array, pos: { p: number }): number | null {
  let n = 0;
  for (;;) {
    if (pos.p >= data.length) return null;
    const b = data[pos.p++] as number;
    n = n * 128 + (b & 0x7f);
    if (n > 0xffffffff) return null;
    if ((b & 0x80) === 0) return n;
  }
}

/** SkWbmpCodec::IsWbmp: type 0, a fixed header without reserved bits, a size of 1 to 65535. */
function isWbmp(data: Uint8Array): boolean {
  const pos = { p: 0 };
  if (readMbf(data, pos) !== 0) return false;
  if (pos.p >= data.length || ((data[pos.p++] as number) & 0x9f) !== 0) return false;
  const width = readMbf(data, pos);
  if (width === null || width === 0 || width > 0xffff) return false;
  const height = readMbf(data, pos);
  return height !== null && height !== 0 && height <= 0xffff;
}

/** The size of the info header of a bitmap (after the 14 bytes of the file header). */
function bmpHeaderSize(data: Uint8Array): number {
  if (data.length < 18) return -1;
  return ((data[14] as number) | ((data[15] as number) << 8) | ((data[16] as number) << 16) | ((data[17] as number) << 24)) >>> 0;
}

/**
 * The size of a bitmap as the BMP codec of Skia reads its header (SkBmpCodec::ReadHeader): an
 * OS/2 1.x header of 16 bit fields or a Windows header of 32 bit ones (a negative height is a
 * top down bitmap), at most 65535 pixels a side, the bit counts and compressions Skia decodes
 * (RGB 1, 2, 4, 8, 16, 24 or 32 bits, RLE8, RLE4, bit fields of 16 or 32 bits). Null when Skia
 * rejects it. The rest of the header (palette, masks, data offset) is not checked.
 */
function bmpHeaderInfo(data: Uint8Array): { width: number; height: number } | null {
  const size = bmpHeaderSize(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let width: number;
  let height: number;
  let bpp: number;
  let compression = 0;
  if (size < 12 || size > 0x7fffffff) return null;
  if (size >= 16) {
    if (data.length < 30) return null;
    width = view.getInt32(18, true);
    height = view.getInt32(22, true);
    bpp = view.getUint16(28, true);
    if (size >= 20) {
      if (data.length < 34) return null;
      compression = view.getUint32(30, true);
    }
  } else {
    if (data.length < 26) return null;
    width = view.getUint16(18, true);
    height = view.getUint16(20, true);
    bpp = view.getUint16(24, true);
  }
  if (height === -2147483648) return null;
  height = Math.abs(height);
  if (width <= 0 || height === 0 || width >= 65536 || height >= 65536) return null;
  switch (compression) {
    case 0:
      if (![1, 2, 4, 8, 16, 24, 32].includes(bpp)) return null;
      break;
    case 1:
      if (bpp !== 8) return null;
      break;
    case 2:
      if (bpp !== 4) return null;
      break;
    case 3:
    case 6:
      if (bpp !== 16 && bpp !== 32) return null;
      break;
    default:
      return null;
  }
  return { width, height };
}

/**
 * SKBitmap.Decode and its Pixels: the image as Skia decodes it, null when no codec of Skia reads
 * it. Fails for the formats Skia decodes that are not ported.
 */
export function decodeImage(data: Uint8Array): RgbaImage | null {
  if (data.length === 0) return null;
  if (isPngSignature(data)) return decodePng(data);
  if (startsWith(data, [0xff, 0xd8, 0xff])) throw new ImageFormatNotSupportedError('Decoding JPEG');
  if (startsWith(data, RIFF) && startsWith(data, WEBPVP, 8)) throw new ImageFormatNotSupportedError('WebP');
  if (isGifSignature(data)) return decodeGif(data);
  if (startsWith(data, [0, 0, 1, 0]) || startsWith(data, [0, 0, 2, 0])) throw new ImageFormatNotSupportedError('ICO and CUR');
  if (startsWith(data, [0x42, 0x4d])) {
    // A bitmap the PDF writer did not read itself: its header is short (Skia fails too) or
    // longer than the 32000 bytes BitmapUtil accepts
    if (bmpHeaderSize(data) > 32000) throw new ImageFormatNotSupportedError('BMP (with a header of more than 32000 bytes)');
    return null;
  }
  if (isWbmp(data)) throw new ImageFormatNotSupportedError('WBMP');
  return null;
}

/** The pixels of an image as GetBitmapInfo reads the 32 bit bitmap Skia encodes. */
export interface DecodedBitmap {
  width: number;
  height: number;
  /** RGB rows, top down. */
  rgb: Uint8Array;
  /** The alpha of each pixel (the soft mask). */
  alpha: Uint8Array;
}

/**
 * EncodeImageStreamAsBitmapStream read back by GetBitmapInfo: the RGB pixels and the alpha of an
 * image (the 32 bit bitmap of SkiaBitmapInfoProvider, bottom up BGRA, is flipped back and split
 * by GetBitmapInfo, so the round trip changes nothing). Null when Skia decodes nothing (C#: an
 * empty stream).
 */
export function decodeImageForPdf(data: Uint8Array): DecodedBitmap | null {
  const image = decodeImage(data);
  if (image === null || image.width <= 0 || image.height <= 0) return null;
  const n = image.width * image.height;
  const rgb = new Uint8Array(n * 3);
  const alpha = new Uint8Array(n);
  const px = image.pixels;
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = px[i * 4] as number;
    rgb[i * 3 + 1] = px[i * 4 + 1] as number;
    rgb[i * 3 + 2] = px[i * 4 + 2] as number;
    alpha[i] = px[i * 4 + 3] as number;
  }
  return { width: image.width, height: image.height, rgb, alpha };
}

/**
 * PrintOutPDFStandard.GetBitmapInfo (the size the Crop draw style fits): the size of the image
 * Skia decodes; bytes it cannot decode fail with the NullReferenceException of the C# code.
 *
 * C# decodes the JPEG and the BMP with Skia; here their size is read from their headers (the
 * first SOFn marker; the bitmap header as the BMP codec of Skia validates it), which is what Skia
 * reads, without checking that the rest of the image decodes.
 */
export function bitmapInfoOf(data: Uint8Array): { width: number; height: number } {
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    let info;
    try {
      info = getJpegInfo(data);
    } catch {
      throw new Error(NULL_REFERENCE);
    }
    if (info.width <= 0 || info.height <= 0) throw new Error(NULL_REFERENCE);
    return { width: info.width, height: info.height };
  }
  if (!isPngSignature(data) && startsWith(data, [0x42, 0x4d])) {
    const size = bmpHeaderInfo(data);
    if (size === null) throw new Error(NULL_REFERENCE);
    return size;
  }
  const image = decodeImage(data);
  if (image === null) throw new Error(NULL_REFERENCE);
  return { width: image.width, height: image.height };
}
