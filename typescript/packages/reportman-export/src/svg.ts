// SVG output of a metafile: a port of the SVG driver of the Delphi engine (rpsvgdriver.pas,
// ExportMetafileToSVG), which the C# engine does not have. One document per page: the page
// background, every text as a <text> at its top left corner (no wrapping, alignment or style but
// the color, the Linux font name and the size) and every image as an <image> that refers to a file
// with its bytes; the shapes are not drawn. The text goes into the document as it is, without XML
// escaping, as Delphi writes it.
//
// Also the parts the HTML driver (html.ts) shares with it: the pixels of a twips position, the
// names of the files, and what rppdffile tells of an image (GetJPegInfo, GetBitmapInfo) with the
// errors it raises.

import {
  MetaObjectType,
  type MetaFile,
  type MetaObject,
  type MetaObjectImage,
  type MetaObjectText,
  type MetaPage,
} from '@reportman/metafile';
import { unicodeToWin1252 } from '@reportman/text';

/** Options of metafileToSvg. */
export interface SvgOptions {
  /** The pages, 1-based and inclusive; all of them by default. */
  fromPage?: number;
  toPage?: number;
  /** The caption of the document, written into the <desc> of each page ('' by default). */
  caption?: string;
  /**
   * The file name the Delphi driver is given ('report.svg' by default). Each page is named after
   * it, its page index (0 based) before the extension (report0.svg, report1.svg...), and so is each
   * image (reportpage0obj3.jpg: page and object index), whose name the page refers to: a folder in
   * the name is kept in the references.
   */
  fileName?: string;
}

/** A document of a page. */
export interface ExportedPage {
  /** The index of the page in the metafile, 0 based. */
  index: number;
  /** The name Delphi writes the page with (see SvgOptions.fileName). */
  fileName: string;
  /** The document. Delphi writes it in the ANSI code page: windows1252Bytes gives those bytes. */
  text: string;
}

/** The documents of the pages and the files they refer to. */
export interface ExportedPages {
  pages: ExportedPage[];
  /** The image files the documents refer to, by the name they use for them. */
  files: Map<string, Uint8Array>;
}

/** The line ending of the drivers (LINE_FEED, #13#10 on every system). */
export const CRLF = '\r\n';

// ---------------------------------------------------------------------------------------------
// Numbers

/** n / d rounded half to even (Delphi's Round), exactly, for an integer n and a positive integer d. */
function divRoundHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const twice = 2 * (n - q * d);
  if (twice > d) return q + 1;
  if (twice < d) return q;
  return q % 2 === 0 ? q : q + 1;
}

/** Delphi's Round: half to even. */
export function roundHalfEven(value: number): number {
  const f = Math.floor(value);
  const diff = value - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * TwipsToPX: twips as points (twips*72/1440) by 1.3, rounded, so 13*twips/200 rounded half to
 * even. Delphi computes it in floating point, where 1.3 is not exact; that could only change the
 * result at the halves (twips = 100 + 200k), and there its product, stored in a Double, is the
 * exact half again: the integer computation gives what Delphi gives.
 */
export function twipsToPx(twips: number): number {
  if (Number.isInteger(twips)) return divRoundHalfEven(13 * twips, 200);
  return roundHalfEven(((twips * 72) / 1440) * 1.3);
}

/** TwipsToPoints of the HTML driver: twips*72/1440 rounded half to even. */
export function twipsToPoints(twips: number): number {
  if (Number.isInteger(twips)) return divRoundHalfEven(twips, 20);
  return roundHalfEven((twips * 72) / 1440);
}

/** The RRGGBB of a Delphi color (BBGGRR), as Format('%.8x') of the integer, two's complement. */
export function colorToRgbHex(color: number): string {
  const hex = (color >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return hex.substring(6, 8) + hex.substring(4, 6) + hex.substring(2, 4);
}

// ---------------------------------------------------------------------------------------------
// Pages and file names

/** The indexes of the pages to export (ExportMetafileToSVG / ExportMetafileToHtml). */
export function pageRange(meta: MetaFile, fromPage: number | undefined, toPage: number | undefined): number[] {
  const count = meta.pages.currentCount;
  let first = 0;
  let last = count - 1;
  if (fromPage !== undefined || toPage !== undefined) {
    // As Delphi: the last page is limited to the metafile, the first one is not checked
    first = (fromPage ?? 1) - 1;
    last = Math.min((toPage ?? count) - 1, count - 1);
  }
  const result: number[] = [];
  for (let i = first; i <= last; i++) result.push(i);
  return result;
}

/**
 * Where the extension of a file name starts, -1 if it has none: SysUtils' LastDelimiter of '.'
 * and the folder and drive delimiters, / and \ both (Delphi on Linux and on Windows).
 */
function extensionStart(fileName: string): number {
  for (let i = fileName.length - 1; i >= 0; i--) {
    const c = fileName[i];
    if (c === '.') return i;
    if (c === '/' || c === '\\' || c === ':') return -1;
  }
  return -1;
}

/** SysUtils.ChangeFileExt: the extension replaced, or the new one added when there is none. */
export function changeFileExt(fileName: string, extension: string): string {
  const start = extensionStart(fileName);
  return (start < 0 ? fileName : fileName.substring(0, start)) + extension;
}

/** SysUtils.ExtractFileExt: the extension with its dot, '' if there is none. */
export function extractFileExt(fileName: string): string {
  const start = extensionStart(fileName);
  return start < 0 ? '' : fileName.substring(start);
}

/**
 * The name of the file of a page: the page index added to the name without its extension, then
 * the extension of the name. As in Delphi a name with a dot before its extension (my.report.svg)
 * gives every page the same name (my.svg).
 */
export function pageFileName(fileName: string, index: number): string {
  return changeFileExt(changeFileExt(fileName, '') + String(index), extractFileExt(fileName));
}

/** The name of the file of an image before its extension: <name>page<P>obj<O>. */
export function imageBaseName(fileName: string, pageIndex: number, objectIndex: number): string {
  return changeFileExt(fileName, '') + 'page' + String(pageIndex) + 'obj' + String(objectIndex);
}

/**
 * The bytes Delphi writes a document with: AnsiString in the ANSI code page of Windows,
 * Windows-1252 in the Americas and Western Europe, with its best fit (Ā is A, ő is o) and ? for
 * what has no equivalent (each half of a surrogate pair too).
 */
export function windows1252Bytes(text: string): Uint8Array {
  const ansi = unicodeToWin1252(text);
  const bytes = new Uint8Array(ansi.length);
  for (let i = 0; i < ansi.length; i++) bytes[i] = ansi.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// Images: GetJPegInfo and GetBitmapInfo of rppdffile, as far as the drivers use them

// The messages of rpmdconsts, in English
const MSG_INVALID_JPEG = 'Invalid JPEG/PNG stream'; // SRpSInvalidJPEG
const MSG_BAD_BITMAP_FILE_HEADER = 'Bad bitmap file header'; // SRpBadBitmapFileHeader
const MSG_INVALID_BITMAP_HEADER_SIZE = 'Invalid Bitmap Header Size'; // SRpInvalidBitmapHeaderSize
const MSG_BAD_BITMAP_STREAM = 'Bad bitmap stream'; // SRpBadBitmapStream
const MSG_BITMAP_BIT_COUNT = 'Invalid bit depth in bitmap'; // SRpBitMapInfoHeaderBitCount
const MSG_INVALID_BITMAP_PALETTE = 'Invalid bitmap palette'; // SRpInvalidBitmapPalette
const MSG_RLE_BITMAP = 'Compressed RLE bitmaps not supported in PDF Export'; // SRpRLECompBitmapPDF

/** An error the Delphi engine raises reading an image: the drivers write its message, or stop. */
export class DelphiImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelphiImageError';
  }
}

/** What GetJPegInfo tells of an image: its format and, for a JPEG, its size in pixels. */
export interface ImageFormatInfo {
  /** 'JPEG', 'BMP', 'GIF', 'PNG' or '' (any other format). */
  format: string;
  /**
   * The size of a JPEG (0 when the frame comes after the scan). GetJPegInfo leaves its size
   * variables untouched for the other formats, and the drivers do not initialize them: Delphi
   * gives 0 in practice, so 0 here.
   */
  width: number;
  height: number;
}

const M_SOS = 0xda;
const M_EOI = 0xd9;
const M_SOI = 0xd8;
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** GetJPegInfo: the format from the first two bytes and, for a JPEG, its frame size. */
export function getJpegInfo(data: Uint8Array): ImageFormatInfo {
  const result: ImageFormatInfo = { format: 'JPEG', width: 0, height: 0 };
  if (data.length < 1) return { format: '', width: 0, height: 0 };
  const c1 = data[0] as number;
  if (c1 !== 0xff) result.format = '';
  if (data.length < 2) return { format: '', width: 0, height: 0 };
  const c2 = data[1] as number;
  if (c2 !== M_SOI) {
    result.format = '';
    if (c1 === 0x42 && c2 === 0x4d) result.format = 'BMP';
    else if (c1 === 0x47 && c2 === 0x49) result.format = 'GIF';
    else if (c1 === 137 && c2 === 0x50) result.format = 'PNG';
    return result;
  }
  if (result.format !== 'JPEG') return result;
  let pos = 2;
  const readByte = (): number => {
    if (pos >= data.length) throw new DelphiImageError(MSG_INVALID_JPEG);
    return data[pos++] as number;
  };
  // A big endian word (Hi(w)+(Lo(w) shl 8) of a little endian read)
  const readWord = (): number => {
    if (pos + 2 > data.length) throw new DelphiImageError(MSG_INVALID_JPEG);
    const w = ((data[pos] as number) << 8) | (data[pos + 1] as number);
    pos += 2;
    return w;
  };
  const nextMarker = (): number => {
    let c = readByte();
    while (c !== 0xff) c = readByte();
    do c = readByte();
    while (c === 0xff);
    return c;
  };
  // skip_variable and process_COM: a length that counts itself, then the bytes
  const skipVariable = (): void => {
    let length = readWord();
    if (length < 2) throw new DelphiImageError(MSG_INVALID_JPEG);
    length -= 2;
    while (length > 0) {
      readByte();
      length--;
    }
  };
  // The segments until the scan
  let marker: number;
  do {
    marker = nextMarker();
    if (SOF_MARKERS.has(marker)) {
      // process_SOFn: the length, the precision, the height and the width; nothing else is needed
      readWord();
      readByte();
      result.height = readWord();
      result.width = readWord();
      marker = M_SOS;
    } else if (marker !== M_SOS && marker !== M_EOI) {
      // process_COM (a comment) and skip_variable (anything else, even a marker without a
      // length): the same reading
      skipVariable();
    }
  } while (marker !== M_SOS && marker !== M_EOI);
  return result;
}

/** What GetBitmapInfo reads of the headers of a BMP. */
export interface BitmapHeaderInfo {
  width: number;
  height: number;
  bitCount: number;
  /** Colors of the palette by the bit count (0 for 15 bits and more). */
  numColors: number;
  /** Colors of the palette to read: the header's or numColors. */
  usedColors: number;
  /** An OS/2 core header (a header size below 15). */
  coreHeader: boolean;
  /** Size of the header after the file header. */
  headerSize: number;
}

const int32At = (d: Uint8Array, o: number): number =>
  ((d[o] ?? 0) | ((d[o + 1] ?? 0) << 8) | ((d[o + 2] ?? 0) << 16) | ((d[o + 3] ?? 0) << 24)) | 0;
const uint16At = (d: Uint8Array, o: number): number => (d[o] ?? 0) | ((d[o + 1] ?? 0) << 8);

const FILE_HEADER_SIZE = 14;
const MAX_BITMAPHEADERSIZE = 32000;

/**
 * GetBitmapInfo without the pixels (the HTML driver passes no stream for them): the checks of the
 * file header and the bitmap header, with their errors, and the size of the image. A field past
 * the header size the file gives is read as 0.
 */
export function getBitmapInfo(data: Uint8Array): BitmapHeaderInfo {
  if (data.length < FILE_HEADER_SIZE) throw new DelphiImageError(MSG_BAD_BITMAP_FILE_HEADER);
  if (uint16At(data, 0) !== 19778) throw new DelphiImageError(MSG_BAD_BITMAP_FILE_HEADER);
  if (data.length < FILE_HEADER_SIZE + 4) throw new DelphiImageError(MSG_BAD_BITMAP_FILE_HEADER);
  const bsize = int32At(data, FILE_HEADER_SIZE) >>> 0;
  if (bsize < 2 || bsize > MAX_BITMAPHEADERSIZE) throw new DelphiImageError(MSG_INVALID_BITMAP_HEADER_SIZE);
  if (data.length - FILE_HEADER_SIZE < bsize) throw new DelphiImageError(MSG_BAD_BITMAP_STREAM);
  // The header as Delphi reads it: bsize bytes, zeros after them
  const header = new Uint8Array(Math.max(bsize, 40));
  header.set(data.subarray(FILE_HEADER_SIZE, FILE_HEADER_SIZE + bsize));
  const coreHeader = bsize < 15;
  let width: number;
  let height: number;
  let bitCount: number;
  let numColors: number;
  let usedColors = 0;
  if (coreHeader) {
    width = uint16At(header, 4);
    height = uint16At(header, 6);
    bitCount = uint16At(header, 10);
    switch (bitCount) {
      case 1:
        numColors = 2;
        break;
      case 4:
        numColors = 16;
        break;
      case 8:
        numColors = 256;
        break;
      case 24:
      case 32:
        numColors = 0;
        break;
      default:
        throw new DelphiImageError(MSG_BITMAP_BIT_COUNT + String(bitCount));
    }
    if (bitCount < 24) usedColors = numColors;
  } else {
    width = int32At(header, 4);
    height = int32At(header, 8);
    bitCount = uint16At(header, 14);
    const compression = int32At(header, 16) >>> 0;
    // BI_RGB or BI_BITFIELDS; BI_RLE4 and BI_RLE8 are not supported
    if (compression !== 0 && compression !== 3) throw new DelphiImageError(MSG_RLE_BITMAP);
    switch (bitCount) {
      case 1:
        numColors = 2;
        break;
      case 4:
        numColors = 16;
        break;
      case 8:
        numColors = 256;
        break;
      case 15:
      case 16:
      case 24:
      case 32:
        numColors = 0;
        break;
      default:
        throw new DelphiImageError(MSG_BITMAP_BIT_COUNT + String(bitCount));
    }
    if (bitCount < 15) {
      usedColors = int32At(header, 32);
      if (usedColors === 0) usedColors = numColors;
    }
  }
  return { width, height, bitCount, numColors, usedColors, coreHeader, headerSize: bsize };
}

/**
 * The error GetBitmapInfo raises in the SVG driver, which passes the image stream itself as the
 * stream for the pixels: GetDIBBits empties the stream before it reads the rows from it. A palette
 * that is not complete raises its error; a true color image of more than one row (or one row with
 * padding) runs out of data on the second row and raises "Bad bitmap stream", so the page gets
 * the message instead of the image. An indexed image gives no error.
 */
function svgBitmapError(data: Uint8Array): DelphiImageError | null {
  let info: BitmapHeaderInfo;
  try {
    info = getBitmapInfo(data);
  } catch (e) {
    if (e instanceof DelphiImageError) return e;
    throw e;
  }
  const { width, height, bitCount, numColors, usedColors, coreHeader } = info;
  if (numColors > 0) {
    // The palette is read before the stream is emptied
    const paletteBytes = coreHeader ? 3 * numColors : 4 * usedColors;
    if (data.length - FILE_HEADER_SIZE - info.headerSize < paletteBytes) return new DelphiImageError(MSG_INVALID_BITMAP_PALETTE);
    return null;
  }
  // The emptied stream is width*height*3 bytes; each row reads scanwidth bytes and the first one
  // writes its pixels at the end of the stream
  let scanWidth = width * (bitCount === 32 ? 4 : bitCount === 24 ? 3 : 2);
  if (bitCount !== 32) {
    let toRead = 4 - (scanWidth % 4);
    if (toRead === 4) toRead = 0;
    scanWidth += toRead;
  }
  if (height <= 0 || scanWidth === 0) return null;
  if (width * height * 3 < scanWidth || height > 1) return new DelphiImageError(MSG_BAD_BITMAP_STREAM);
  return null;
}

// ---------------------------------------------------------------------------------------------
// The SVG driver

/** ObjectToSVGText: the element of an object, its line ending included. */
function objectToSvgText(
  page: MetaPage,
  pageIndex: number,
  obj: MetaObject,
  fileName: string,
  index: number,
  files: Map<string, Uint8Array>,
): string {
  switch (obj.metaType) {
    case MetaObjectType.Text: {
      const text = obj as MetaObjectText;
      return (
        '<text x="' +
        twipsToPx(text.left) +
        'px" ' +
        ' y="' +
        twipsToPx(text.top) +
        'px" ' +
        ' fill="#' +
        colorToRgbHex(text.fontColor) +
        '" font-family="' +
        page.getLFontNameText(text) +
        '" font-size="' +
        String(text.fontSize) +
        '"' +
        '>' +
        page.getText(text) +
        '</text>' +
        CRLF
      );
    }
    case MetaObjectType.Image: {
      const image = obj as MetaObjectImage;
      try {
        let imageName = imageBaseName(fileName, pageIndex, index);
        const data = page.getStream(image);
        const info = getJpegInfo(data);
        if (info.format === 'JPEG') imageName = changeFileExt(imageName, '.jpg');
        else if (info.format === 'BMP') {
          const error = svgBitmapError(data);
          if (error !== null) throw error;
          imageName = changeFileExt(imageName, '.bmp');
        }
        // Delphi parity: for an indexed BMP Delphi saves what GetDIBBits left in the stream (as
        // many bytes as the rows of pixels, from memory it did not initialize); here the image.
        files.set(imageName, data);
        return (
          '<image x="' +
          twipsToPx(image.left) +
          'px" y="' +
          twipsToPx(image.top) +
          'px" width="' +
          twipsToPx(image.width) +
          'px" ' +
          ' height="' +
          twipsToPx(image.height) +
          'px" ' +
          'xlink:href="' +
          imageName +
          '">' +
          '</image>' +
          CRLF
        );
      } catch (e) {
        // The message of the error instead of the image, without a line ending
        if (e instanceof DelphiImageError) return e.message;
        throw e;
      }
    }
    default:
      // Shapes, polygons, export texts and barcodes are not drawn
      return '';
  }
}

/** ExportPageToSVG. */
function exportPageToSvg(meta: MetaFile, page: MetaPage, pageIndex: number, caption: string, fileName: string, files: Map<string, Uint8Array>): string {
  const width = twipsToPx(meta.customX);
  const height = twipsToPx(meta.customY);
  // encoding="windows-1252" is not supported by Adobe SVG (the Delphi comment): the bytes are
  // Windows-1252 all the same
  let s = '<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>' + CRLF;
  s += '<!DOCTYPE svg PUBLIC "-//W3C/DTD SVG 1.1//EN"' + CRLF;
  s += ' "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + CRLF;
  s += '<svg width="' + width + 'px" ' + 'height="' + height + 'px" version="1.1"' + CRLF;
  s += 'xmlns="http://www.w3.org/2000/svg">' + CRLF;
  s += '<desc>' + caption + '</desc>' + CRLF;
  // The background color of the page first
  s += '<rect x="0" y="0" width="' + width + 'px" ' + ' height="' + height + 'px" ' + ' fill="#' + colorToRgbHex(meta.backColor) + '"></rect>' + CRLF;
  const objects = page.objects;
  for (let i = 0; i < objects.length; i++) s += objectToSvgText(page, pageIndex, objects[i] as MetaObject, fileName, i, files);
  s += '</svg>';
  return s;
}

/**
 * The pages of a metafile as SVG documents (ExportMetafileToSVG): one document per page, with
 * the image files they refer to. The size of every page is the page size of the metafile.
 */
export function metafileToSvg(meta: MetaFile, options: SvgOptions = {}): ExportedPages {
  const caption = options.caption ?? '';
  const fileName = options.fileName ?? 'report.svg';
  const files = new Map<string, Uint8Array>();
  const pages: ExportedPage[] = [];
  for (const index of pageRange(meta, options.fromPage, options.toPage)) {
    const text = exportPageToSvg(meta, meta.pages.get(index), index, caption, fileName, files);
    pages.push({ index, fileName: pageFileName(fileName, index), text });
  }
  return { pages, files };
}
