// The images of a page: what the PDF device makes of their bytes (the format, the size in pixels
// the draw styles are computed with, the pixels it embeds, the errors that stop it), and how a
// browser turns them into something a context draws.

import { cropSizeOf as pdfCropSizeOf, decodeImage, getBitmapInfo, getJpegInfo, isGifSignature, isPngSignature } from '@reportman/pdf';
import type { BitmapInfoResult } from '@reportman/pdf';
import type { CanvasImage } from './context.js';

/** An image as the loader gets it: the bytes of a JPEG, or the pixels the PDF embeds. */
export type ImageInput =
  | {
      kind: 'encoded';
      /** The PDF embeds a JPEG as it is (DCTDecode): the browser decodes it. */
      format: 'jpeg';
      bytes: Uint8Array;
    }
  | {
      kind: 'rgba';
      /**
       * A PNG or a GIF decoded as the PDF writer decodes it, a bitmap as it embeds it (its palette,
       * its color key mask, the fourth byte of 32 bits as alpha): RGBA, unpremultiplied, top down.
       */
      format: 'png' | 'gif' | 'bmp';
      width: number;
      height: number;
      pixels: Uint8Array;
    };

/**
 * Turns an image into something the context draws: an ImageBitmap in a browser. Null (or a
 * failure) leaves the image out of the page.
 */
export type ImageLoader = (image: ImageInput) => Promise<CanvasImage | null>;

/** An image of the metafile ready to draw: the input of the loader and the sizes of the PDF. */
export interface PreparedImage {
  /** Null when the PDF draws an image of 0 x 0 (bytes no decoder reads). */
  input: ImageInput | null;
  /** The size in pixels the PDF canvas draws the image with (DrawImage). */
  width: number;
  height: number;
  /** The size the Crop style fits (the size Skia decodes in C#); null when it decodes nothing; or an error. */
  cropSize: { width: number; height: number } | null | Error;
}

function cropSizeOf(bytes: Uint8Array): PreparedImage['cropSize'] {
  try {
    return pdfCropSizeOf(bytes);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** The integers of a PDF array as a reader reads them ("[ 0 01 1 ]" is 0, 1, 1). */
function pdfIntegers(text: string): number[] {
  return (text.match(/-?\d+/g) ?? []).map((n) => parseInt(n, 10));
}

/**
 * The pixels of a Windows bitmap as the PDF embeds them (BitmapUtil): RGB rows and the fourth byte
 * of a 32 bit bitmap as a soft mask; or palette indexes (1, 4 or 8 bits, rows of whole bytes) of
 * an /Indexed color space, limited to its highest index, with the color key /Mask of the entries
 * whose fourth byte is 0. C# writes those ranges without separators ("[ 0 01 12 2 ]"); a reader
 * takes the first pair of the array as the range of a one component image, so that is the range
 * masked here.
 */
function bitmapPixels(info: BitmapInfoResult): Uint8Array {
  const { width, height } = info;
  const out = new Uint8Array(width * height * 4);
  const bits = info.bits ?? new Uint8Array(0);
  if (info.indexed) {
    const palette: number[] = [];
    const hex = info.palette.replace(/[<>\s]/g, '');
    for (let i = 0; i + 6 <= hex.length; i += 6) palette.push(parseInt(hex.substring(i, i + 6), 16));
    const hival = info.usedColors;
    const bpc = info.bitsPerPixel;
    const rowBytes = Math.ceil((width * bpc) / 8);
    const mask = pdfIntegers(info.mask);
    const masked = mask.length >= 2 ? [mask[0] as number, mask[1] as number] : null;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const bit = x * bpc;
        const byte = bits[y * rowBytes + (bit >> 3)] ?? 0;
        let index = bpc === 8 ? byte : (byte >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1);
        if (index > hival) index = hival;
        const color = palette[index] ?? 0;
        const o = (y * width + x) * 4;
        out[o] = (color >> 16) & 0xff;
        out[o + 1] = (color >> 8) & 0xff;
        out[o + 2] = color & 0xff;
        out[o + 3] = masked !== null && index >= masked[0] && index <= masked[1] ? 0 : 255;
      }
  } else {
    const alpha = info.smask;
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = bits[i * 3] ?? 0;
      out[i * 4 + 1] = bits[i * 3 + 1] ?? 0;
      out[i * 4 + 2] = bits[i * 3 + 2] ?? 0;
      out[i * 4 + 3] = alpha === null ? 255 : (alpha[i] ?? 0);
    }
  }
  return out;
}

/**
 * A JPEG without its Exif segments: the PDF embeds the bytes as they are and a PDF viewer ignores
 * the orientation they give, which a browser applies (createImageBitmap cannot be told not to).
 */
function withoutExif(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let pos = 2;
  let removed = false;
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1] as number;
    // The scan and what follows go as they are
    if (marker === 0xda || marker === 0xd9) break;
    const length = ((bytes[pos + 2] as number) << 8) | (bytes[pos + 3] as number);
    if (length < 2 || pos + 2 + length > bytes.length) break;
    const exif = marker === 0xe1 && bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78 && bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66;
    if (exif) removed = true;
    else parts.push(bytes.subarray(pos, pos + 2 + length));
    pos += 2 + length;
  }
  if (!removed) return bytes;
  parts.push(bytes.subarray(pos));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * The image as the PDF canvas reads it (PDFCanvas.DrawImage): a JPEG by its header, a Windows
 * bitmap by BitmapUtil, anything else decoded (PNG, GIF; other bytes give an image of 0 x 0).
 * Throws what the PDF device throws: a bitmap BitmapUtil rejects, a format the PDF writer does not
 * decode (WebP, ICO, WBMP).
 */
export function prepareImage(bytes: Uint8Array): PreparedImage {
  const jpeg = getJpegInfo(bytes);
  if (jpeg.isJpeg)
    return { input: { kind: 'encoded', format: 'jpeg', bytes: withoutExif(bytes) }, width: jpeg.width, height: jpeg.height, cropSize: cropSizeOf(bytes) };
  // With the pixels, as the PDF device asks for them: the errors of BitmapUtil are the PDF's
  const info = getBitmapInfo(bytes, true, true);
  if (info.isBitmap && !info.isGif) {
    const input: ImageInput | null =
      info.width > 0 && info.height > 0 ? { kind: 'rgba', format: 'bmp', width: info.width, height: info.height, pixels: bitmapPixels(info) } : null;
    return { input, width: info.width, height: info.height, cropSize: cropSizeOf(bytes) };
  }
  const decoded = decodeImage(bytes);
  if (decoded === null || decoded.width <= 0 || decoded.height <= 0) return { input: null, width: 0, height: 0, cropSize: cropSizeOf(bytes) };
  const signature = isPngSignature(bytes) || isGifSignature(bytes);
  return {
    input: { kind: 'rgba', format: isGifSignature(bytes) ? 'gif' : 'png', width: decoded.width, height: decoded.height, pixels: decoded.pixels },
    width: decoded.width,
    height: decoded.height,
    // bitmapInfoOf decodes a PNG or a GIF again for its size
    cropSize: signature ? { width: decoded.width, height: decoded.height } : cropSizeOf(bytes),
  };
}

/**
 * The loader of a browser (or a worker): createImageBitmap of the JPEG bytes or of the pixels,
 * without the color management of the browser, since the PDF declares its images DeviceRGB.
 */
export const browserImageLoader: ImageLoader = async (image) => {
  const options: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'default' };
  if (image.kind === 'encoded') return await createImageBitmap(new Blob([new Uint8Array(image.bytes)], { type: 'image/jpeg' }), options);
  const data = new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height);
  return await createImageBitmap(data, options);
};
