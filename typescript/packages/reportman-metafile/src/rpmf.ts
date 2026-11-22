// The binary metafile format of the C# engine (.rpmf): MetaFile.SaveToStream / LoadFromStream,
// MetaPage.SaveToStream / LoadFromStream and the fixed size records of MetaObject*.SaveToStream /
// FillFromBuf (Reportman.Drawing). Numbers are little endian (StreamUtil.IntToByteArray and
// friends), strings of the file header are a 4 byte length and UTF-8, the strings of a page are a
// pool of UTF-16 code units the objects point into. A compressed file is the same bytes in a zlib
// stream; a reader tells them apart by the first byte ('x').
//
// Layout (version 4.1 shown; each part says which versions have it):
//
//   "RPMETAFILE09\0" (07, 09, 30, 40, 41)  int32 FileHeader separator (0)
//   3.0 and later: byte PDFConformance, byte PDFCompressed, 9 strings (author, creator, producer,
//     creation date, modification date, subject, title, keywords, XMP), int32 embedded file
//     count and, for each one, 4 strings (name, MIME type, description, modification date),
//     byte AFRelationship, int64 size and the bytes; 4.1 only: byte PrinterFonts
//   int32 PageSizeIndex, CustomX, CustomY, Orientation, BackColor; int16 PaperSource, Copies,
//     LinesPerInch; byte CollateCopies, Duplex; int32 PrinterSelect, AutoScale, PreviewWindow;
//     byte OpenDrawerBefore, OpenDrawerAfter; int32 PreviewAbout, PreviewMargins; int32 page count
//   before the first page, when it is not empty: int32 StreamHeader (3), int64 size and the
//     shared image stream
//   each page: int32 PageHeader (1), int32 ObjectHeader (2), int32 0, then (not in 07) int32
//     Orientation, int32 Index, byte Custom, int32 CustomWidth, CustomHeight, PhysicWidth,
//     PhysicHeight, PaperSource, 61 bytes ForcePaperName, int32 Duplex, 3 bytes 0, byte
//     UpdatedPageSize; int32 object count and the records (66 bytes up to 3.0, 74 from 4.0, which
//     adds the annotation); int32 pool size in bytes and the pool; int64 size and the page stream

import { unzlibSync, zlibSync } from 'fflate';
import { ByteBuffer } from './bytebuffer.js';
import { MetaFileVersion, MetaObjectType, MetaSeparator, PrinterFontsType } from './enums.js';
import { EmbeddedFile, MetaFile } from './metafile.js';
import {
  MetaObject,
  MetaObjectBarcode,
  MetaObjectDraw,
  MetaObjectExport,
  MetaObjectImage,
  MetaObjectPolygon,
  MetaObjectText,
} from './metaobject.js';
import { MetaPage } from './metapage.js';
import { codeUnitsToString } from './numeric.js';

/** Record size and offset of the first field after the type byte, by record version (MetaObject). */
const RECORD_SIZE_3 = 66;
const RECORD_SIZE_4 = 74;
const RECORD_OFFSET_3 = 17;
const RECORD_OFFSET_4 = 25;
/** Length of the paper name in the page header. */
const FORCE_PAPER_NAME_LENGTH = 61;

/** The two characters after "RPMETAFILE" in the signature of each version. */
const SIGNATURES: readonly (readonly [MetaFileVersion, string])[] = [
  [MetaFileVersion.MetaVersion2_2, '07'],
  [MetaFileVersion.MetaVersion2_4, '09'],
  [MetaFileVersion.MetaVersion3_0, '30'],
  [MetaFileVersion.MetaVersion4_0, '40'],
  [MetaFileVersion.MetaVersion4_1, '41'],
];
const SIGNATURE_PREFIX = 'RPMETAFILE';
const SIGNATURE_LENGTH = 13;

// The messages of the C# engine (Translator.TranslateStr, English resources)
const MSG_BAD_SIGNATURE = 'Bad report metafile signature'; // 520
const MSG_BAD_HEADER = 'Bad report metafile file header'; // 521
const MSG_PAGE_SEPARATOR = 'Page separator expected in report metafile'; // 522
const MSG_OBJECT_SEPARATOR = 'Object separator expected in report metafile'; // 523

/** The record version of a page: 4 (with annotations) from metafile version 4.0, else 3. */
function recordVersion(version: MetaFileVersion): number {
  return version >= MetaFileVersion.MetaVersion4_0 ? 4 : 3;
}

// ---------------------------------------------------------------------------------------------
// UTF-8 (Encoding.UTF8 of .NET; the core has no TextEncoder)

/** Encoding.UTF8.GetBytes: no byte order mark, a lone surrogate becomes U+FFFD. */
function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
      continue;
    }
    if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
        continue;
      }
      c = 0xfffd;
    }
    out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/**
 * Encoding.UTF8.GetString: an invalid sequence becomes U+FFFD, one for each maximal invalid
 * subpart (the Unicode recommended practice .NET follows); a byte order mark is kept.
 */
function utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  const units: number[] = [];
  let i = start;
  while (i < end) {
    const b0 = bytes[i] as number;
    if (b0 < 0x80) {
      units.push(b0);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lower = 0x80;
    let upper = 0xbf;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      cp = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      cp = b0 & 0x0f;
      if (b0 === 0xe0) lower = 0xa0;
      if (b0 === 0xed) upper = 0x9f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      cp = b0 & 0x07;
      if (b0 === 0xf0) lower = 0x90;
      if (b0 === 0xf4) upper = 0x8f;
    } else {
      units.push(0xfffd);
      i++;
      continue;
    }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const b = j < end ? (bytes[j] as number) : -1;
      if (b < lower || b > upper) {
        ok = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
    }
    if (!ok) {
      units.push(0xfffd);
      i = j;
      continue;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else units.push(cp);
    i = j;
  }
  return codeUnitsToString(units, 0, units.length);
}

// ---------------------------------------------------------------------------------------------
// Writing

/** The StreamUtil conversions of the C# writer, appended to a growing buffer. */
class RpmfWriter {
  readonly out = new ByteBuffer(64 * 1024);

  byte(value: number): void {
    this.out.writeByte(value);
  }

  bool(value: boolean): void {
    this.out.writeByte(value ? 1 : 0);
  }

  /** ShortToByteArray: the low 16 bits of the value. */
  int16(value: number): void {
    this.out.writeByte(value);
    this.out.writeByte(value >> 8);
  }

  /** IntToByteArray. */
  int32(value: number): void {
    const v = value | 0;
    this.out.writeByte(v);
    this.out.writeByte(v >> 8);
    this.out.writeByte(v >> 16);
    this.out.writeByte(v >> 24);
  }

  /** LongToByteArray / Int64ToByteArray: two's complement, little endian. */
  int64(value: number): void {
    const v = Math.trunc(value);
    const hi = Math.floor(v / 4294967296);
    const lo = v - hi * 4294967296; // 0 <= lo < 2^32
    this.int32(lo);
    this.int32(hi);
  }

  zeros(count: number): void {
    for (let i = 0; i < count; i++) this.out.writeByte(0);
  }

  bytes(data: Uint8Array): void {
    this.out.write(data);
  }

  /** MetaFile.WriteStringToStream: int32 byte count and the UTF-8 bytes; null is "". */
  string(value: string | null): void {
    const bytes = utf8Encode(value ?? '');
    this.int32(bytes.length);
    this.out.write(bytes);
  }

  /** StringToByteArray(value, length): the low byte of each character, cut or padded with 0. */
  ansi(value: string | null, length: number): void {
    const n = value === null ? 0 : Math.min(value.length, length);
    for (let i = 0; i < n; i++) this.out.writeByte((value as string).charCodeAt(i));
    this.zeros(length - n);
  }
}

/**
 * MetaObject.SaveToStream and the overrides: the layout follows the class of the object, the type
 * byte is its MetaType field (as the C# virtual methods do; the two normally agree).
 */
function writeObject(w: RpmfWriter, obj: MetaObject, ver: number): void {
  const recordOffset = ver === 4 ? RECORD_OFFSET_4 : RECORD_OFFSET_3;
  const recordSize = ver === 4 ? RECORD_SIZE_4 : RECORD_SIZE_3;
  w.int32(obj.top);
  w.int32(obj.left);
  w.int32(obj.width);
  w.int32(obj.height);
  if (ver >= 4) {
    w.int32(obj.annotationP);
    w.int32(obj.annotationS);
  }
  w.byte(obj.metaType);
  let used: number;
  if (obj instanceof MetaObjectText) {
    w.int32(obj.textP);
    w.int32(obj.textS);
    w.int32(obj.lFontNameP);
    w.int32(obj.lFontNameS);
    w.int32(obj.wFontNameP);
    w.int32(obj.wFontNameS);
    w.int16(obj.fontSize);
    w.int16(obj.fontRotation);
    w.int16(obj.fontStyle);
    w.int16(obj.type1Font);
    w.int32(obj.fontColor);
    w.int32(obj.backColor);
    w.bool(obj.transparent);
    w.bool(obj.cutText);
    w.int16(obj.alignment);
    w.bool(obj.wordWrap);
    w.bool(obj.rightToLeft);
    w.byte(obj.printStep);
    w.bool(obj.isHtml);
    used = 48;
  } else if (obj instanceof MetaObjectDraw) {
    w.int32(obj.drawStyle);
    w.int32(obj.brushStyle);
    w.int32(obj.brushColor);
    w.int32(obj.penStyle);
    w.int32(obj.penWidth);
    w.int32(obj.penColor);
    used = 24;
  } else if (obj instanceof MetaObjectImage) {
    w.int32(obj.copyMode);
    w.int32(obj.drawImageStyle);
    w.int32(obj.dpiRes);
    w.bool(obj.previewOnly);
    w.int64(obj.streamPos);
    w.int64(obj.streamSize);
    w.bool(obj.sharedImage);
    used = 30;
  } else if (obj instanceof MetaObjectPolygon) {
    // C# parity: MetaObjectPolygon.SaveToStream writes the pen color where the reader expects the
    // pen width, and the brush style where it expects the pen color
    w.int32(obj.polyBrushStyle);
    w.int32(obj.polyBrushColor);
    w.int32(obj.polyPenStyle);
    w.int32(obj.polyPenColor);
    w.int32(obj.polyBrushStyle);
    w.int32(obj.polyPointCount);
    w.int64(obj.polyStreamPos);
    w.int64(obj.polyStreamSize);
    used = 40;
  } else if (obj instanceof MetaObjectExport) {
    // C# parity: MetaObjectExport.SaveToStream writes the text position where the reader expects
    // the text length
    w.int32(obj.textExpP);
    w.int32(obj.textExpP);
    w.int32(obj.line);
    w.int32(obj.position);
    w.int32(obj.size);
    w.bool(obj.doNewLine);
    used = 21;
  } else if (obj instanceof MetaObjectBarcode) {
    w.int32(obj.textP);
    w.int32(obj.textS);
    w.int32(obj.symbology);
    w.int32(obj.ecc);
    w.int32(obj.modules);
    w.int32(obj.rows);
    w.int32(obj.columns);
    w.int32(obj.flags);
    used = 32;
  } else {
    throw new TypeError('writeRpmf: an object of a page is not a metafile object: ' + String(obj?.constructor?.name));
  }
  w.zeros(recordSize - used - recordOffset);
}

/** MetaPage.SaveToStream. */
function writePage(w: RpmfWriter, page: MetaPage): void {
  const ver = recordVersion(page.version);
  w.int32(MetaSeparator.ObjectHeader);
  w.int32(0);
  w.int32(page.orientation);
  const d = page.pageDetail;
  w.int32(d.index);
  w.bool(d.custom);
  w.int32(d.customWidth);
  w.int32(d.customHeight);
  w.int32(d.physicWidth);
  w.int32(d.physicHeight);
  w.int32(d.paperSource);
  w.ansi(d.forcePaperName, FORCE_PAPER_NAME_LENGTH);
  w.int32(d.duplex);
  // Record alignment
  w.zeros(3);
  w.bool(page.updatedPageSize);
  w.int32(page.objects.length);
  for (const obj of page.objects) writeObject(w, obj, ver);
  const poolPos = page.poolPos;
  w.int32(poolPos * 2);
  const pool = page.pool;
  for (let i = 0; i < poolPos; i++) w.int16(pool[i] as number);
  const stream = page.memStream;
  w.int64(stream.length);
  w.bytes(stream.view());
}

/**
 * The metafile in the .rpmf format: the bytes MetaFile.SaveToStream writes for it, uncompressed
 * by default, or as a zlib stream with `compressed` (not the bytes of the C# Deflater, which
 * deflates its own way; any zlib reader, the C# engine too, reads it).
 *
 * The version written is the version of the metafile: 2.4 (RPMETAFILE09) for a new one, 3.0 when
 * it has PDF/A conformance or embedded files, 4.0 when an object has an annotation; 2.2 is written
 * as 2.4, the C# engine writes no 07 files.
 * C# parity: as IntSaveToStream, PrinterFonts = Recalculate raises the version of the metafile to
 * 4.1 (the only version that carries it) and every page gets the version of the metafile.
 */
export function writeRpmf(meta: MetaFile, options: { compressed?: boolean } = {}): Uint8Array {
  if (meta.printerFonts === PrinterFontsType.Recalculate && meta.version < MetaFileVersion.MetaVersion4_1)
    meta.version = MetaFileVersion.MetaVersion4_1;
  const version = meta.version;
  const w = new RpmfWriter();
  let code = '09';
  if (version === MetaFileVersion.MetaVersion4_1) code = '41';
  else if (version === MetaFileVersion.MetaVersion4_0) code = '40';
  else if (version === MetaFileVersion.MetaVersion3_0) code = '30';
  w.ansi(SIGNATURE_PREFIX + code, SIGNATURE_LENGTH);
  w.int32(MetaSeparator.FileHeader);
  if (version >= MetaFileVersion.MetaVersion3_0) {
    w.byte(meta.pdfConformance);
    w.bool(meta.pdfCompressed);
    // Metadata
    w.string(meta.docAuthor);
    w.string(meta.docCreator);
    w.string(meta.docProducer);
    w.string(meta.docCreationDate);
    w.string(meta.docModificationDate);
    w.string(meta.docSubject);
    w.string(meta.docTitle);
    w.string(meta.docKeywords);
    w.string(meta.docXMPContent);
    // Embedded files. C# parity: the creation date of a file is not written.
    w.int32(meta.embeddedFiles.length);
    for (const efile of meta.embeddedFiles) {
      // C# would fail on a file without content; it is written empty
      const content = efile.stream ?? new Uint8Array(0);
      w.string(efile.fileName);
      w.string(efile.mimeType);
      w.string(efile.description);
      w.string(efile.modificationDate);
      w.byte(efile.afRelationShip);
      w.int64(content.length);
      w.bytes(content);
    }
    if (version >= MetaFileVersion.MetaVersion4_1) w.byte(meta.printerFonts);
  }
  // Report header
  w.int32(meta.pageSizeIndex);
  w.int32(meta.customX);
  w.int32(meta.customY);
  w.int32(meta.orientation);
  w.int32(meta.backColor);
  w.int16(meta.paperSource);
  w.int16(meta.copies);
  w.int16(meta.linesPerInch);
  w.bool(meta.collateCopies);
  w.byte(meta.duplex);
  w.int32(meta.printerSelect);
  w.int32(meta.autoScale);
  w.int32(meta.previewWindow);
  w.bool(meta.openDrawerBefore);
  w.bool(meta.openDrawerAfter);
  w.int32(meta.previewAbout ? 1 : 0);
  w.int32(meta.previewMargins ? 1 : 0);
  // Pages
  w.int32(meta.pages.count);
  let first = true;
  for (const page of meta.pages) {
    // The shared image stream, before the first page (not written without pages)
    if (first && meta.sharedStream.length > 0) {
      w.int32(MetaSeparator.StreamHeader);
      w.int64(meta.sharedStream.length);
      w.bytes(meta.sharedStream.view());
    }
    first = false;
    w.int32(MetaSeparator.PageHeader);
    page.version = version;
    writePage(w, page);
  }
  const bytes = w.out.toUint8Array();
  // The C# Deflater writes a zlib stream at its default level, 6
  return options.compressed === true ? zlibSync(bytes, { level: 6 }) : bytes;
}

// ---------------------------------------------------------------------------------------------
// Reading

/** The reads of the C# loader over the bytes of the file: each one fails with its own message. */
class RpmfReader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.pos;
  }

  /** The position of the next `count` bytes, which are consumed; fewer bytes fail with `message`. */
  take(count: number, message: string): number {
    if (count < 0 || count > this.remaining) throw new Error(message);
    const at = this.pos;
    this.pos += count;
    return at;
  }

  byte(message: string): number {
    return this.data[this.take(1, message)] as number;
  }

  /** ByteArrayToInt(buf, 4): a signed 32 bit integer. */
  int32(message: string): number {
    return int32At(this.data, this.take(4, message));
  }

  /** ByteArrayToInt(buf, 2): an unsigned 16 bit integer. */
  uint16(message: string): number {
    const at = this.take(2, message);
    return (this.data[at] as number) | ((this.data[at + 1] as number) << 8);
  }

  /** ByteArrayToLong: two signed 32 bit halves (a low half of 2^31 or more comes out negative). */
  long(message: string): number {
    return longAt(this.data, this.take(8, message));
  }

  /** ByteArrayToInt64(buf, 0, 8): a 64 bit integer. */
  int64(message: string): number {
    const at = this.take(8, message);
    return (int32At(this.data, at) >>> 0) + int32At(this.data, at + 4) * 4294967296;
  }

  /** A copy of the next `count` bytes. */
  bytes(count: number, message: string): Uint8Array {
    const at = this.take(count, message);
    return this.data.slice(at, at + count);
  }

  /** MetaFile.ReadStringFromStream. */
  string(): string {
    const count = this.int32(MSG_BAD_HEADER);
    if (count === 0) return '';
    // C# fails allocating a negative length
    if (count < 0) throw new Error('Arithmetic operation resulted in an overflow.');
    const at = this.take(count, MSG_BAD_HEADER);
    return utf8Decode(this.data, at, at + count);
  }
}

function int32At(buf: Uint8Array, at: number): number {
  return (
    (buf[at] as number) |
    ((buf[at + 1] as number) << 8) |
    ((buf[at + 2] as number) << 16) |
    ((buf[at + 3] as number) << 24)
  );
}

function int16At(buf: Uint8Array, at: number): number {
  return (((buf[at] as number) | ((buf[at + 1] as number) << 8)) << 16) >> 16;
}

function longAt(buf: Uint8Array, at: number): number {
  return int32At(buf, at) + int32At(buf, at + 4) * 4294967296;
}

/** MetaObject.CreateFromBuf and FillFromBuf. */
function readObject(buf: Uint8Array, index: number, ver: number): MetaObject {
  const off = index + (ver === 4 ? RECORD_OFFSET_4 : RECORD_OFFSET_3);
  const obj = MetaObject.create(buf[off - 1] as MetaObjectType);
  obj.top = int32At(buf, index);
  obj.left = int32At(buf, index + 4);
  obj.width = int32At(buf, index + 8);
  obj.height = int32At(buf, index + 12);
  if (ver >= 4) {
    obj.annotationP = int32At(buf, index + 16);
    obj.annotationS = int32At(buf, index + 20);
  }
  obj.metaType = buf[off - 1] as MetaObjectType;
  if (obj instanceof MetaObjectText) {
    obj.textP = int32At(buf, off);
    obj.textS = int32At(buf, off + 4);
    obj.lFontNameP = int32At(buf, off + 8);
    obj.lFontNameS = int32At(buf, off + 12);
    obj.wFontNameP = int32At(buf, off + 16);
    obj.wFontNameS = int32At(buf, off + 20);
    obj.fontSize = int16At(buf, off + 24);
    obj.fontRotation = int16At(buf, off + 26);
    obj.fontStyle = int16At(buf, off + 28);
    obj.type1Font = int16At(buf, off + 30);
    obj.fontColor = int32At(buf, off + 32);
    obj.backColor = int32At(buf, off + 36);
    obj.transparent = buf[off + 40] !== 0;
    obj.cutText = buf[off + 41] !== 0;
    obj.alignment = int16At(buf, off + 42);
    obj.wordWrap = buf[off + 44] !== 0;
    obj.rightToLeft = buf[off + 45] !== 0;
    obj.printStep = buf[off + 46] as number;
    obj.isHtml = buf[off + 47] !== 0;
  } else if (obj instanceof MetaObjectDraw) {
    obj.drawStyle = int32At(buf, off);
    obj.brushStyle = int32At(buf, off + 4);
    obj.brushColor = int32At(buf, off + 8);
    obj.penStyle = int32At(buf, off + 12);
    obj.penWidth = int32At(buf, off + 16);
    obj.penColor = int32At(buf, off + 20);
  } else if (obj instanceof MetaObjectImage) {
    obj.copyMode = int32At(buf, off);
    obj.drawImageStyle = int32At(buf, off + 4);
    obj.dpiRes = int32At(buf, off + 8);
    obj.previewOnly = buf[off + 12] !== 0;
    obj.streamPos = longAt(buf, off + 13);
    obj.streamSize = longAt(buf, off + 21);
    obj.sharedImage = buf[off + 29] !== 0;
  } else if (obj instanceof MetaObjectPolygon) {
    obj.polyBrushStyle = int32At(buf, off);
    obj.polyBrushColor = int32At(buf, off + 4);
    obj.polyPenStyle = int32At(buf, off + 8);
    obj.polyPenWidth = int32At(buf, off + 12);
    obj.polyPenColor = int32At(buf, off + 16);
    obj.polyPointCount = int32At(buf, off + 20);
    obj.polyStreamPos = longAt(buf, off + 24);
    obj.polyStreamSize = longAt(buf, off + 32);
  } else if (obj instanceof MetaObjectExport) {
    obj.textExpP = int32At(buf, off);
    obj.textExpS = int32At(buf, off + 4);
    obj.line = int32At(buf, off + 8);
    obj.position = int32At(buf, off + 12);
    obj.size = int32At(buf, off + 16);
    obj.doNewLine = buf[off + 20] !== 0;
  } else if (obj instanceof MetaObjectBarcode) {
    obj.textP = int32At(buf, off);
    obj.textS = int32At(buf, off + 4);
    obj.symbology = int32At(buf, off + 8);
    obj.ecc = int32At(buf, off + 12);
    obj.modules = int32At(buf, off + 16);
    obj.rows = int32At(buf, off + 20);
    obj.columns = int32At(buf, off + 24);
    obj.flags = int32At(buf, off + 28);
  }
  return obj;
}

/** MetaPage.LoadFromStream. */
function readPage(r: RpmfReader, page: MetaPage): void {
  const fail = MSG_PAGE_SEPARATOR;
  if (r.int32(fail) !== MetaSeparator.ObjectHeader) throw new Error(MSG_OBJECT_SEPARATOR);
  // Mark begin
  r.int32(fail);
  if (page.version !== MetaFileVersion.MetaVersion2_2) {
    page.orientation = r.int32(fail);
    const d = page.pageDetail;
    d.index = r.int32(fail);
    d.custom = r.byte(fail) !== 0;
    d.customWidth = r.int32(fail);
    d.customHeight = r.int32(fail);
    d.physicWidth = r.int32(fail);
    d.physicHeight = r.int32(fail);
    d.paperSource = r.int32(fail);
    // C# parity: ByteArrayToString makes a character of every byte of the field, the zeros after
    // the name too, so the name read is always 61 characters long
    const at = r.take(FORCE_PAPER_NAME_LENGTH, fail);
    d.forcePaperName = codeUnitsToString(r.data, at, FORCE_PAPER_NAME_LENGTH);
    d.duplex = r.int32(fail);
    // Record alignment
    r.take(3, fail);
    page.updatedPageSize = r.byte(fail) !== 0;
  }
  const ver = recordVersion(page.version);
  const recordSize = ver === 4 ? RECORD_SIZE_4 : RECORD_SIZE_3;
  const objcount = r.int32(fail);
  if (objcount < 0) throw new Error(MSG_OBJECT_SEPARATOR);
  const records = r.take(objcount * recordSize, fail);
  page.objects = [];
  for (let i = 0; i < objcount; i++) page.objects.push(readObject(r.data, records + i * recordSize, ver));

  // String pool
  const wsize = r.int32(fail);
  if (wsize < 0) throw new Error(MSG_OBJECT_SEPARATOR);
  const at = r.take(wsize, fail);
  // C# parity: the capacity, as C# compares the char array with the size in bytes
  const pool = new Uint16Array(Math.max(page.pool.length, wsize));
  const count = wsize >> 1;
  for (let i = 0; i < count; i++) pool[i] = (r.data[at + i * 2] as number) | ((r.data[at + i * 2 + 1] as number) << 8);
  // The C# reader sets the pool position one character past the pool (wsize / 2 + 1), so a page
  // it reads and saves again grows by a zero character; here the pool written back is the one read
  page.loadPool(pool, count);

  // The strings of the objects, so adding one of them again gives its position
  const list = page.stringList;
  for (const obj of page.objects) {
    if (obj.metaType === MetaObjectType.Text && obj instanceof MetaObjectText) {
      const wFontName = page.getWFontNameText(obj);
      if (!list.has(wFontName)) list.set(wFontName, obj.wFontNameP);
      // C# parity: the Linux font name is looked up with GetWFontNameText too, so it is always
      // already in the list and the Linux font name is never added
      const text = page.getText(obj);
      if (!list.has(text)) list.set(text, obj.textP);
    } else if (obj.metaType === MetaObjectType.Barcode && obj instanceof MetaObjectBarcode) {
      const data = page.getText(obj);
      if (!list.has(data)) list.set(data, obj.textP);
    }
  }

  // The stream of the page (its images that are not shared)
  const asize = r.long(fail);
  if (asize < 0) throw new Error(MSG_OBJECT_SEPARATOR);
  if (asize > 0) page.memStream.write(r.bytes(asize, fail));
}

/**
 * Reads a metafile in the .rpmf format, as MetaFile.LoadFromStream does: every version the C#
 * engine reads (RPMETAFILE07, 09, 30, 40 and 41), plain or zlib compressed (a file that starts
 * with 'x'). The metafile is finished; its version is the version of the file.
 *
 * Writing the result again with writeRpmf gives the bytes read (for a file with an even pool
 * size, as every writer makes them), except a 07 file, which is written as 09, and a polygon
 * object, whose record C# writes with two fields out of place (see writeObject).
 */
export function readRpmf(bytes: Uint8Array): MetaFile {
  let data = bytes;
  // MetaStream: compressed when the first byte is 'x' (the zlib header of the C# Deflater)
  if (bytes.length > 0 && bytes[0] === 0x78) {
    try {
      data = unzlibSync(bytes);
    } catch (e) {
      throw new Error('Invalid compressed report metafile: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  const r = new RpmfReader(data);
  const meta = new MetaFile();
  if (r.remaining < SIGNATURE_LENGTH) throw new Error(MSG_BAD_SIGNATURE);
  const at = r.take(SIGNATURE_LENGTH, MSG_BAD_SIGNATURE);
  let version: MetaFileVersion | null = null;
  if (data[at + SIGNATURE_LENGTH - 1] === 0 && codeUnitsToString(data, at, SIGNATURE_PREFIX.length) === SIGNATURE_PREFIX) {
    const code = codeUnitsToString(data, at + SIGNATURE_PREFIX.length, 2);
    for (const [v, c] of SIGNATURES) if (c === code) version = v;
  }
  if (version === null) throw new Error(MSG_BAD_SIGNATURE);
  meta.version = version;
  if (r.int32(MSG_BAD_HEADER) !== MetaSeparator.FileHeader) throw new Error(MSG_BAD_HEADER);
  if (version >= MetaFileVersion.MetaVersion3_0) {
    meta.pdfConformance = r.byte(MSG_BAD_HEADER);
    meta.pdfCompressed = r.byte(MSG_BAD_HEADER) === 1;
    meta.docAuthor = r.string();
    meta.docCreator = r.string();
    meta.docProducer = r.string();
    meta.docCreationDate = r.string();
    meta.docModificationDate = r.string();
    meta.docSubject = r.string();
    meta.docTitle = r.string();
    meta.docKeywords = r.string();
    meta.docXMPContent = r.string();
    // Embedded files
    if (r.remaining < 4) throw new Error('Invalid metafile');
    const fileCount = r.int32('Invalid metafile');
    if (fileCount < 0) throw new Error('Error reading file count');
    for (let i = 0; i < fileCount; i++) {
      const efile = new EmbeddedFile();
      efile.fileName = r.string();
      efile.mimeType = r.string();
      efile.description = r.string();
      efile.modificationDate = r.string();
      efile.afRelationShip = r.byte(MSG_BAD_HEADER);
      const size = r.int64(MSG_BAD_HEADER);
      if (size < 0) throw new Error('Error reading file stream');
      efile.stream = r.bytes(size, 'Error reading embedded file');
      meta.embeddedFiles.push(efile);
    }
    if (version >= MetaFileVersion.MetaVersion4_1) meta.printerFonts = r.byte(MSG_BAD_HEADER);
  }
  const h = MSG_BAD_HEADER;
  meta.pageSizeIndex = r.int32(h);
  meta.customX = r.int32(h);
  meta.customY = r.int32(h);
  meta.orientation = r.int32(h);
  meta.backColor = r.int32(h);
  // C# parity: the 16 bit fields are read unsigned, the lines per inch signed (6 when negative)
  meta.paperSource = r.uint16(h);
  meta.copies = r.uint16(h);
  meta.linesPerInch = (r.uint16(h) << 16) >> 16;
  meta.collateCopies = r.byte(h) !== 0;
  if (meta.linesPerInch < 0) meta.linesPerInch = 6;
  meta.duplex = r.byte(h);
  meta.printerSelect = r.int32(h);
  meta.autoScale = r.int32(h);
  meta.previewWindow = r.int32(h);
  meta.openDrawerBefore = r.byte(h) !== 0;
  meta.openDrawerAfter = r.byte(h) !== 0;
  meta.previewAbout = r.int32(h) !== 0;
  meta.previewMargins = r.int32(h) !== 0;
  // C# parity: the page count only says whether there are pages; the pages are read up to the
  // end of the file
  const pageCount = r.int32(h);
  if (pageCount !== 0) {
    let separator = r.int32(h);
    for (;;) {
      if (separator === MetaSeparator.StreamHeader) {
        // The shared image stream (replaces the one read before, if any)
        const size = r.long(h);
        if (size < 0) throw new Error(MSG_OBJECT_SEPARATOR);
        if (size > 0) {
          const shared = r.bytes(size, h);
          meta.sharedStream.setLength(0);
          meta.sharedStream.write(shared);
        }
        separator = r.int32(h);
      }
      if (separator !== MetaSeparator.PageHeader) throw new Error(MSG_PAGE_SEPARATOR);
      const page = new MetaPage(meta);
      page.version = version;
      page.updatedPageSize = false;
      page.orientation = meta.orientation;
      const d = page.pageDetail;
      d.index = meta.pageSizeIndex;
      d.custom = true;
      d.customWidth = meta.customX;
      d.customHeight = meta.customY;
      d.physicWidth = meta.customX;
      d.physicHeight = meta.customY;
      d.paperSource = 0;
      d.forcePaperName = '';
      d.duplex = 0;
      readPage(r, page);
      meta.pages.add(page);
      if (r.remaining === 0) break;
      if (r.remaining < 4) throw new Error(MSG_PAGE_SEPARATOR);
      separator = r.int32(MSG_PAGE_SEPARATOR);
    }
  }
  meta.finish();
  return meta;
}
