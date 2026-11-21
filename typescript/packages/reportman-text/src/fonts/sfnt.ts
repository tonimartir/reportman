// Reading TrueType / OpenType files the way FreeType sees them: the faces of a file (a collection
// holds several), the family and style names FreeType reports, the style flags and the face
// metrics, and the glyph of a character in the Unicode charmap FreeType selects. Only the tables
// needed are read, through ranged reads: a scan of the system fonts never loads a whole file.

import type { FontFileSource } from './sources.js';

const CHUNK = 16384;

/** Random access to the bytes of a font file, in cached chunks. */
export class ByteReader {
  private readonly chunks = new Map<number, Uint8Array>();
  private whole: Uint8Array | null = null;
  readonly source: FontFileSource;

  constructor(source: FontFileSource, whole?: Uint8Array) {
    this.source = source;
    if (whole !== undefined) this.whole = whole;
  }

  /** The whole file (read once). */
  all(): Uint8Array {
    if (this.whole === null) this.whole = this.source.readAll();
    return this.whole;
  }

  private chunk(index: number): Uint8Array {
    let c = this.chunks.get(index);
    if (c === undefined) {
      c = this.source.read(index * CHUNK, CHUNK);
      this.chunks.set(index, c);
    }
    return c;
  }

  /** A byte, or -1 past the end of the file. */
  u8(offset: number): number {
    if (offset < 0) return -1;
    if (this.whole !== null) return offset < this.whole.length ? (this.whole[offset] as number) : -1;
    const c = this.chunk(Math.floor(offset / CHUNK));
    const k = offset % CHUNK;
    return k < c.length ? (c[k] as number) : -1;
  }

  /** Whether the file has at least `length` bytes at `offset`. */
  has(offset: number, length: number): boolean {
    return length <= 0 || this.u8(offset + length - 1) >= 0;
  }

  u16(offset: number): number {
    const a = this.u8(offset);
    const b = this.u8(offset + 1);
    if (a < 0 || b < 0) throw new RangeError('Font file too short');
    return (a << 8) | b;
  }

  i16(offset: number): number {
    const v = this.u16(offset);
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u32(offset: number): number {
    return this.u16(offset) * 65536 + this.u16(offset + 2);
  }

  i32(offset: number): number {
    return this.u32(offset) | 0;
  }

  tag(offset: number): string {
    let s = '';
    for (let i = 0; i < 4; i++) {
      const b = this.u8(offset + i);
      if (b < 0) return '';
      s += String.fromCharCode(b);
    }
    return s;
  }

  bytes(offset: number, length: number): Uint8Array {
    if (this.whole !== null) return this.whole.subarray(offset, Math.min(offset + length, this.whole.length));
    const out = new Uint8Array(length);
    let n = 0;
    while (n < length) {
      const pos = offset + n;
      const c = this.chunk(Math.floor(pos / CHUNK));
      const k = pos % CHUNK;
      if (k >= c.length) break;
      const take = Math.min(c.length - k, length - n);
      out.set(c.subarray(k, k + take), n);
      n += take;
    }
    return n === length ? out : out.subarray(0, n);
  }
}

/** A table of a face: where it is in the file and its length. */
export interface SfntTable {
  offset: number;
  length: number;
}

/** A face of a font file: the offset of its table directory and its tables. */
export interface SfntFace {
  directory: number;
  /** The sfnt version: 0x00010000, 'true' or 'OTTO'. */
  version: number;
  tables: Map<string, SfntTable>;
}

const TAG_TTCF = 0x74746366;
const TAG_OTTO = 0x4f54544f;
const TAG_TRUE = 0x74727565;

/** The number of faces of a file (FT_New_Face with index -1): the count of a collection, else 1. */
export function faceCount(r: ByteReader): number {
  try {
    if (r.u32(0) === TAG_TTCF) return r.u32(8);
  } catch {
    return 1;
  }
  return 1;
}

/** The table directory of a face (the lower 16 bits of the index in a collection); null when the file is not an sfnt. */
export function readFace(r: ByteReader, faceIndex: number): SfntFace | null {
  try {
    let dir = 0;
    if (r.u32(0) === TAG_TTCF) {
      const n = r.u32(8);
      const index = faceIndex & 0xffff;
      if (index >= n) return null;
      dir = r.u32(12 + 4 * index);
    } else if ((faceIndex & 0xffff) !== 0) return null;
    const version = r.u32(dir);
    if (version !== 0x00010000 && version !== TAG_OTTO && version !== TAG_TRUE) return null;
    const numTables = r.u16(dir + 4);
    const tables = new Map<string, SfntTable>();
    for (let i = 0; i < numTables; i++) {
      const rec = dir + 12 + i * 16;
      const tag = r.tag(rec);
      tables.set(tag, { offset: r.u32(rec + 8), length: r.u32(rec + 12) });
    }
    return { directory: dir, version, tables };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Names, as FreeType's tt_face_get_name picks and converts them

interface NameRecord {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  length: number;
  offset: number;
}

/** The records of the name table of a face, cached on the face. */
function nameRecords(r: ByteReader, face: SfntFace): { records: NameRecord[]; strings: number } | null {
  const cached = (face as SfntFace & { names?: { records: NameRecord[]; strings: number } | null }).names;
  if (cached !== undefined) return cached;
  let result: { records: NameRecord[]; strings: number } | null = null;
  const t = face.tables.get('name');
  if (t !== undefined) {
    try {
      const count = r.u16(t.offset + 2);
      const strings = t.offset + r.u16(t.offset + 4);
      const records: NameRecord[] = [];
      for (let i = 0; i < count; i++) {
        const p = t.offset + 6 + i * 12;
        records.push({
          platformID: r.u16(p),
          encodingID: r.u16(p + 2),
          languageID: r.u16(p + 4),
          nameID: r.u16(p + 6),
          length: r.u16(p + 8),
          offset: r.u16(p + 10),
        });
      }
      result = { records, strings };
    } catch {
      result = null;
    }
  }
  (face as SfntFace & { names?: unknown }).names = result;
  return result;
}

/**
 * A name of a face the way FreeType reads it (tt_face_get_name): an English Windows name first,
 * then an Apple one, then a Unicode one; converted to ASCII, any other character as '?'. Null when
 * the face has no such name.
 */
export function ftName(r: ByteReader, face: SfntFace, nameId: number): string | null {
  const names = nameRecords(r, face);
  if (names === null) return null;
  const recs = names.records;
  let foundAppleRoman = -1;
  let foundAppleEnglish = -1;
  let foundWin = -1;
  let foundUnicode = -1;
  let isEnglish = false;
  for (let n = 0; n < recs.length; n++) {
    const rec = recs[n] as NameRecord;
    if (rec.nameID !== nameId || rec.length <= 0) continue;
    switch (rec.platformID) {
      case 0: // Apple Unicode
      case 2: // ISO
        foundUnicode = n;
        break;
      case 1: // Macintosh
        if (rec.languageID === 0) foundAppleEnglish = n;
        else if (rec.encodingID === 0) foundAppleRoman = n;
        break;
      case 3: // Microsoft
        if (foundWin === -1 || (rec.languageID & 0x3ff) === 0x009) {
          switch (rec.encodingID) {
            case 0:
            case 1:
            case 10:
              isEnglish = (rec.languageID & 0x3ff) === 0x009;
              foundWin = n;
              break;
          }
        }
        break;
    }
  }
  let foundApple = foundAppleRoman;
  if (foundAppleEnglish >= 0) foundApple = foundAppleEnglish;
  let rec: NameRecord | undefined;
  let utf16 = false;
  if (foundWin >= 0 && !(foundApple >= 0 && !isEnglish)) {
    rec = recs[foundWin];
    utf16 = true;
  } else if (foundApple >= 0) {
    rec = recs[foundApple];
    utf16 = false;
  } else if (foundUnicode >= 0) {
    rec = recs[foundUnicode];
    utf16 = true;
  }
  if (rec === undefined) return null;
  const bytes = r.bytes(names.strings + rec.offset, rec.length);
  let s = '';
  if (utf16) {
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      let code = ((bytes[k] as number) << 8) | (bytes[k + 1] as number);
      if (code === 0) break;
      if (code < 32 || code > 127) code = 0x3f;
      s += String.fromCharCode(code);
    }
  } else {
    for (let k = 0; k < bytes.length; k++) {
      let code = bytes[k] as number;
      if (code === 0) break;
      if (code < 32 || code > 127) code = 0x3f;
      s += String.fromCharCode(code);
    }
  }
  return s;
}

/** A name of a face in Unicode (the first English Windows record), for messages and checks. */
export function unicodeName(r: ByteReader, face: SfntFace, nameId: number): string | null {
  const names = nameRecords(r, face);
  if (names === null) return null;
  for (const rec of names.records) {
    if (rec.nameID === nameId && rec.platformID === 3 && (rec.languageID & 0x3ff) === 0x009 && rec.length > 0) {
      const bytes = r.bytes(names.strings + rec.offset, rec.length);
      let s = '';
      for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode(((bytes[k] as number) << 8) | (bytes[k + 1] as number));
      return s;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The face as FreeType describes it (the fields FillLogFont reads)

/** What FreeType reports of a face (FT_FaceRec), the part the engine reads. */
export interface FtFaceInfo {
  familyName: string;
  styleName: string;
  scalable: boolean;
  /** An sfnt (TrueType / OpenType) face; false for Type 1. */
  sfnt: boolean;
  fixedWidth: boolean;
  /** The face has a kerning table (FT_FACE_FLAG_KERNING). */
  kerning: boolean;
  unitsPerEM: number;
  ascender: number;
  descender: number;
  height: number;
  maxAdvanceWidth: number;
  /** FT_STYLE_FLAG_BOLD. */
  bold: boolean;
  /** FT_STYLE_FLAG_ITALIC. */
  italic: boolean;
  /** The named instances of a variable font (the upper bits of style_flags). */
  namedInstances: number;
  numGlyphs: number;
  /** Outlines in CFF (an OpenType font with PostScript outlines). */
  cff: boolean;
}

interface Os2 {
  version: number;
  fsSelection: number;
  sTypoAscender: number;
  sTypoDescender: number;
  sTypoLineGap: number;
  usWinAscent: number;
  usWinDescent: number;
}

function readOs2(r: ByteReader, face: SfntFace): Os2 | null {
  const t = face.tables.get('OS/2');
  if (t === undefined || t.length < 78) return null;
  try {
    const o = t.offset;
    return {
      version: r.u16(o),
      fsSelection: r.u16(o + 62),
      sTypoAscender: r.i16(o + 68),
      sTypoDescender: r.i16(o + 70),
      sTypoLineGap: r.i16(o + 72),
      usWinAscent: r.u16(o + 74),
      usWinDescent: r.u16(o + 76),
    };
  } catch {
    return null;
  }
}

/** The fvar of a face: the axes and the named instances (their style name ID and coordinates). */
export interface FvarInfo {
  axes: { tag: string; min: number; def: number; max: number }[];
  instances: { subfamilyNameID: number; coords: number[] }[];
}

/** The fvar table of a face, null when it has none or FreeType would reject it. */
export function readFvar(r: ByteReader, face: SfntFace): FvarInfo | null {
  const t = face.tables.get('fvar');
  if (t === undefined) return null;
  try {
    const o = t.offset;
    const version = r.u32(o);
    const axesOffset = r.u16(o + 4);
    const axisCount = r.u16(o + 8);
    const axisSize = r.u16(o + 10);
    const instanceCount = r.u16(o + 12);
    const instanceSize = r.u16(o + 14);
    if (
      version !== 0x00010000 ||
      axisSize !== 20 ||
      axisCount === 0 ||
      axisCount > 0x3ffe ||
      !(instanceSize === 4 + 4 * axisCount || instanceSize === 6 + 4 * axisCount) ||
      instanceCount > 0x7eff ||
      axesOffset + axisSize * axisCount + instanceSize * instanceCount > t.length
    )
      return { axes: [], instances: [] };
    const fixed = (p: number): number => r.i32(p) / 65536;
    const axes: FvarInfo['axes'] = [];
    for (let i = 0; i < axisCount; i++) {
      const p = o + axesOffset + i * axisSize;
      axes.push({ tag: r.tag(p), min: fixed(p + 4), def: fixed(p + 8), max: fixed(p + 12) });
    }
    const instances: FvarInfo['instances'] = [];
    for (let i = 0; i < instanceCount; i++) {
      const p = o + axesOffset + axisCount * axisSize + i * instanceSize;
      const coords: number[] = [];
      for (let k = 0; k < axisCount; k++) coords.push(fixed(p + 4 + 4 * k));
      instances.push({ subfamilyNameID: r.u16(p), coords });
    }
    return { axes, instances };
  } catch {
    return null;
  }
}

/** Whether a kern table has a horizontal format 0 subtable, as FreeType's kern_avail_bits. */
function hasKerning(r: ByteReader, face: SfntFace): boolean {
  const t = face.tables.get('kern');
  if (t === undefined || t.length < 4) return false;
  try {
    const o = t.offset;
    const version = r.u16(o);
    if (version !== 0) return false;
    const n = r.u16(o + 2);
    let p = o + 4;
    for (let i = 0; i < n && p + 6 <= o + t.length; i++) {
      const length = r.u16(p + 2);
      const coverage = r.u16(p + 4);
      // Horizontal (bit 0), format 0 (high byte), not minimum, not cross stream
      if ((coverage & 0xff07) === 0x0001) return true;
      if (length < 6) break;
      p += length;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Describes a face as FreeType's FT_New_Face would (sfnt_load_face): names (the WWS or typographic
 * family first, unless the face says it is WWS only), style flags, metrics. Throws when the face
 * cannot be opened, as FT_New_Face fails.
 */
export function describeFace(r: ByteReader, faceIndex: number): FtFaceInfo {
  const face = readFace(r, faceIndex);
  if (face === null) throw new Error('Not a TrueType / OpenType face');
  const head = face.tables.get('head');
  const hhea = face.tables.get('hhea');
  const maxp = face.tables.get('maxp');
  if (head === undefined || maxp === undefined) throw new Error('A table the face needs is missing');
  const unitsPerEM = r.u16(head.offset + 18);
  const macStyle = r.u16(head.offset + 44);
  const os2 = readOs2(r, face);
  const hasOs2 = os2 !== null;
  // Names
  let family: string | null = null;
  let style: string | null = null;
  if (hasOs2 && (os2.fsSelection & 256) !== 0) {
    family = ftName(r, face, 16);
    if (family === null) family = ftName(r, face, 1);
    style = ftName(r, face, 17);
    if (style === null) style = ftName(r, face, 2);
  } else {
    family = ftName(r, face, 21);
    if (family === null) family = ftName(r, face, 16);
    if (family === null) family = ftName(r, face, 1);
    style = ftName(r, face, 22);
    if (style === null) style = ftName(r, face, 17);
    if (style === null) style = ftName(r, face, 2);
  }
  const cff = face.tables.has('CFF ') || face.tables.has('CFF2');
  const hasOutline = face.tables.has('glyf') || cff;
  // Style flags
  let bold = false;
  let italic = false;
  if (hasOutline && hasOs2) {
    if ((os2.fsSelection & 512) !== 0) italic = true;
    else if ((os2.fsSelection & 1) !== 0) italic = true;
    if ((os2.fsSelection & 32) !== 0) bold = true;
  } else {
    if ((macStyle & 1) !== 0) bold = true;
    if ((macStyle & 2) !== 0) italic = true;
  }
  // Metrics
  let ascender = 0;
  let descender = 0;
  let lineGap = 0;
  let maxAdvanceWidth = 0;
  if (hhea !== undefined) {
    ascender = r.i16(hhea.offset + 4);
    descender = r.i16(hhea.offset + 6);
    lineGap = r.i16(hhea.offset + 8);
    maxAdvanceWidth = r.u16(hhea.offset + 10);
  }
  let height = ascender - descender + lineGap;
  if (hasOs2 && (os2.fsSelection & 128) !== 0) {
    // USE_TYPO_METRICS: FreeType takes the typographic metrics of OS/2
    ascender = os2.sTypoAscender;
    descender = os2.sTypoDescender;
    height = ascender - descender + os2.sTypoLineGap;
  } else if (!(ascender !== 0 || descender !== 0) && hasOs2) {
    if (os2.sTypoAscender !== 0 || os2.sTypoDescender !== 0) {
      ascender = os2.sTypoAscender;
      descender = os2.sTypoDescender;
      height = ascender - descender + os2.sTypoLineGap;
    } else {
      ascender = os2.usWinAscent;
      descender = -os2.usWinDescent;
      height = ascender - descender;
    }
  }
  let fixedWidth = false;
  const post = face.tables.get('post');
  if (post !== undefined && post.length >= 16) fixedWidth = r.u32(post.offset + 12) !== 0;
  let namedInstances = 0;
  const fvar = readFvar(r, face);
  if (fvar !== null) namedInstances = fvar.instances.length;
  const instance = faceIndex >>> 16;
  if (instance > 0) {
    if (fvar === null || instance > fvar.instances.length) throw new Error('No such named instance');
    const named = ftName(r, face, (fvar.instances[instance - 1] as FvarInfo['instances'][number]).subfamilyNameID);
    if (named !== null) style = named;
  }
  return {
    familyName: family ?? '',
    styleName: style ?? '',
    scalable: hasOutline,
    sfnt: true,
    fixedWidth,
    kerning: hasKerning(r, face),
    unitsPerEM,
    ascender,
    descender,
    height,
    maxAdvanceWidth,
    bold,
    italic,
    namedInstances,
    numGlyphs: r.u16(maxp.offset + 4),
    cff,
  };
}

// ---------------------------------------------------------------------------------------------
// The raw table readings of the C# engine (they read the file bytes, not the face)

/** OS/2 metrics as ReadOS2Metrics reads them: from the table directory at the start of the file. */
export interface Os2Metrics {
  found: boolean;
  sTypoAscender: number;
  sTypoDescender: number;
  sTypoLineGap: number;
  usWinAscent: number;
  usWinDescent: number;
  fsSelection: number;
}

/**
 * FontInfoFt.ReadOS2Metrics: the OS/2 table found in the directory at the start of the file data.
 * C# parity: a collection starts with its own header, not a table directory, so its faces never
 * find their OS/2 table this way.
 */
export function readOs2Metrics(r: ByteReader): Os2Metrics {
  const result: Os2Metrics = {
    found: false,
    sTypoAscender: 0,
    sTypoDescender: 0,
    sTypoLineGap: 0,
    usWinAscent: 0,
    usWinDescent: 0,
    fsSelection: 0,
  };
  if (!r.has(0, 12)) return result;
  const numTables = (r.u8(4) << 8) | r.u8(5);
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16;
    if (!r.has(recordOffset, 16)) break;
    if (r.tag(recordOffset) === 'OS/2') {
      const tableOffset = r.u32(recordOffset + 8);
      if (!r.has(0, tableOffset + 78)) return result;
      const off = tableOffset;
      const s16 = (p: number): number => {
        const v = (r.u8(p) << 8) | r.u8(p + 1);
        return v >= 0x8000 ? v - 0x10000 : v;
      };
      result.fsSelection = (r.u8(off + 62) << 8) | r.u8(off + 63);
      result.sTypoAscender = s16(off + 68);
      result.sTypoDescender = s16(off + 70);
      result.sTypoLineGap = s16(off + 72);
      result.usWinAscent = (r.u8(off + 74) << 8) | r.u8(off + 75);
      result.usWinDescent = (r.u8(off + 76) << 8) | r.u8(off + 77);
      result.found = true;
      return result;
    }
  }
  return result;
}

/**
 * FontInfoFt.LeePaginasDeCodigo: ulCodePageRange1 of the OS/2 table of a face (a collection is
 * understood); 0 when the file has nothing to say.
 */
export function readCodePages(r: ByteReader, faceIndex: number): number {
  try {
    if (!r.has(0, 12)) return 0;
    let start = 0;
    if (r.tag(0) === 'ttcf') {
      const n = r.u32(8);
      if (faceIndex >= n) return 0;
      if (!r.has(12 + 4 * faceIndex, 4)) return 0;
      start = r.u32(12 + 4 * faceIndex);
      if (!r.has(start, 12)) return 0;
    }
    const numTables = r.u16(start + 4);
    for (let i = 0; i < numTables; i++) {
      const rec = start + 12 + i * 16;
      if (!r.has(rec, 16)) return 0;
      if (r.tag(rec) !== 'OS/2') continue;
      const where = r.u32(rec + 8);
      if (!r.has(where, 2)) return 0;
      if (r.u16(where) < 1) return 0;
      if (!r.has(where + 78, 4)) return 0;
      return r.u32(where + 78);
    }
  } catch {
    return 0;
  }
  return 0;
}

/**
 * PDFCanvas.SfntGlyphCount: the number of glyphs of a font file (of a collection, the largest of
 * its fonts) and whether its outlines are CFF (any of them); 0 when it cannot be read.
 */
export function sfntGlyphCount(data: Uint8Array | null): { count: number; cff: boolean } {
  if (data === null || data.length < 12) return { count: 0, cff: false };
  const U16 = (pos: number): number => (pos >= 0 && pos + 2 <= data.length ? ((data[pos] as number) << 8) | (data[pos + 1] as number) : 0);
  const U32 = (pos: number): number =>
    pos >= 0 && pos + 4 <= data.length
      ? (data[pos] as number) * 16777216 + ((data[pos + 1] as number) << 16) + ((data[pos + 2] as number) << 8) + (data[pos + 3] as number)
      : -1;
  let result = 0;
  let anyCff = false;
  const font = (dir: number): void => {
    const tables = U16(dir + 4);
    for (let t = 0; t < tables; t++) {
      const rec = dir + 12 + t * 16;
      const tag = U32(rec);
      if (tag === 0x6d617870) {
        const n = U16(U32(rec + 8) + 4);
        if (n > result) result = n;
      } else if (tag === 0x43464620 || tag === 0x43464632) anyCff = true;
    }
  };
  if (U32(0) === 0x74746366) {
    const fonts = U32(8);
    for (let f = 0; f < fonts && f < 4096; f++) font(U32(12 + f * 4));
  } else font(0);
  return { count: result, cff: anyCff };
}

/** PDFCanvas.SfntIsCFF: the font at an offset has CFF outlines (sfnt version 'OTTO'). */
export function sfntIsCFF(data: Uint8Array | null, baseOffset: number): boolean {
  return (
    data !== null &&
    baseOffset >= 0 &&
    baseOffset + 4 <= data.length &&
    data[baseOffset] === 0x4f &&
    data[baseOffset + 1] === 0x54 &&
    data[baseOffset + 2] === 0x54 &&
    data[baseOffset + 3] === 0x4f
  );
}

/** FontInfoFt.DirectorioDeCara: the offset of the table directory of a face, -1 when it cannot be read. */
export function faceDirectory(data: Uint8Array | null, faceIndex: number): number {
  if (data === null || data.length < 16) return -1;
  let dir = 0;
  if (data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66) {
    const rec = 12 + (faceIndex & 0xffff) * 4;
    if (rec + 4 > data.length) return -1;
    dir = (data[rec] as number) * 16777216 + ((data[rec + 1] as number) << 16) + ((data[rec + 2] as number) << 8) + (data[rec + 3] as number);
  }
  return dir;
}

/** PDFCanvas.SfntCFFTable: the 'CFF ' table of the font at an offset, alone; null when it has none. */
export function sfntCFFTable(data: Uint8Array | null, baseOffset: number): Uint8Array | null {
  if (data === null || baseOffset < 0 || baseOffset + 12 > data.length) return null;
  const tables = ((data[baseOffset + 4] as number) << 8) | (data[baseOffset + 5] as number);
  for (let i = 0; i < tables; i++) {
    const rec = baseOffset + 12 + i * 16;
    if (rec + 16 > data.length) return null;
    if (data[rec] === 0x43 && data[rec + 1] === 0x46 && data[rec + 2] === 0x46 && data[rec + 3] === 0x20) {
      const u32 = (p: number): number =>
        (data[p] as number) * 16777216 + ((data[p + 1] as number) << 16) + ((data[p + 2] as number) << 8) + (data[p + 3] as number);
      const offset = u32(rec + 8);
      const len = u32(rec + 12);
      if (len <= 0 || offset + len > data.length) return null;
      return data.slice(offset, offset + len);
    }
  }
  return null;
}

/**
 * PDFCanvas.CFFGlyphsAreCIDs: whether the glyph numbers of the CFF font at an offset are its CIDs,
 * as a CIDFontType0 reads them: a CFF that is not CID-keyed takes the CID as the glyph number, a
 * CID-keyed one maps it through its charset, which must then be the identity. Also whether the
 * font is CID-keyed (ROS in its Top DICT).
 */
export function cffGlyphsAreCIDs(data: Uint8Array | null, baseOffset: number): { result: boolean; cidKeyed: boolean } {
  if (data === null) return { result: false, cidKeyed: false };
  let size = data.length;
  const U8 = (pos: number): number => {
    if (pos < 0 || pos >= size) throw new RangeError('CFF');
    return data[pos] as number;
  };
  const U16 = (pos: number): number => (U8(pos) << 8) | U8(pos + 1);
  const U32 = (pos: number): number => U16(pos) * 65536 + U16(pos + 2);
  const offsetAt = (pos: number, osize: number): number => {
    let r = 0;
    for (let k = 0; k < osize; k++) r = r * 256 + U8(pos + k);
    return r;
  };
  const readIndex = (pos: number): { count: number; first: number; end: number; next: number } => {
    const count = U16(pos);
    if (count === 0) return { count, first: pos + 2, end: pos + 2, next: pos + 2 };
    const osz = U8(pos + 2);
    const dataBase = pos + 3 + (count + 1) * osz - 1;
    return {
      count,
      first: dataBase + offsetAt(pos + 3, osz),
      end: dataBase + offsetAt(pos + 3 + osz, osz),
      next: dataBase + offsetAt(pos + 3 + count * osz, osz),
    };
  };
  let cidKeyedFont = false;
  try {
    let cff = -1;
    let cffEnd = 0;
    const tables = U16(baseOffset + 4);
    for (let i = 0; i < tables; i++)
      if (U32(baseOffset + 12 + i * 16) === 0x43464620) {
        cff = U32(baseOffset + 12 + i * 16 + 8);
        cffEnd = cff + U32(baseOffset + 12 + i * 16 + 12);
        break;
      }
    if (cff < 0) return { result: false, cidKeyed: false };
    if (cffEnd < size) size = cffEnd;
    const nameIndex = readIndex(cff + U8(cff + 2));
    const top = readIndex(nameIndex.next);
    if (top.count < 1) return { result: false, cidKeyed: false };
    let cidKeyed = false;
    let charset = 0;
    let charStrings = -1;
    let operand = 0;
    let p = top.first;
    while (p < top.end) {
      const b0 = U8(p);
      if (b0 <= 21) {
        let op = b0;
        p++;
        if (b0 === 12) {
          op = 1200 + U8(p);
          p++;
        }
        if (op === 1230) cidKeyed = true;
        else if (op === 15) charset = operand;
        else if (op === 17) charStrings = operand;
      } else if (b0 === 28) {
        const v = U16(p + 1);
        operand = v >= 0x8000 ? v - 0x10000 : v;
        p += 3;
      } else if (b0 === 29) {
        operand = U32(p + 1) | 0;
        p += 5;
      } else if (b0 === 30) {
        p++;
        while ((U8(p) & 0x0f) !== 0x0f && U8(p) >> 4 !== 0x0f) p++;
        p++;
      } else if (b0 >= 32 && b0 <= 246) {
        operand = b0 - 139;
        p++;
      } else if (b0 >= 247 && b0 <= 250) {
        operand = (b0 - 247) * 256 + U8(p + 1) + 108;
        p += 2;
      } else if (b0 >= 251 && b0 <= 254) {
        operand = -(b0 - 251) * 256 - U8(p + 1) - 108;
        p += 2;
      } else p++;
    }
    cidKeyedFont = cidKeyed;
    if (!cidKeyed) return { result: true, cidKeyed };
    if (charStrings < 0 || charset <= 2) return { result: false, cidKeyed };
    const nGlyphs = U16(cff + charStrings);
    p = cff + charset;
    const format = U8(p);
    p++;
    let gid = 1;
    while (gid < nGlyphs) {
      if (format === 0) {
        if (U16(p) !== gid) return { result: false, cidKeyed };
        p += 2;
        gid++;
      } else if (format === 1 || format === 2) {
        const first = U16(p);
        let left: number;
        if (format === 1) {
          left = U8(p + 2);
          p += 3;
        } else {
          left = U16(p + 2);
          p += 4;
        }
        if (first !== gid) return { result: false, cidKeyed };
        gid += left + 1;
      } else return { result: false, cidKeyed };
    }
    return { result: true, cidKeyed };
  } catch {
    return { result: false, cidKeyed: cidKeyedFont };
  }
}

// ---------------------------------------------------------------------------------------------
// The Unicode charmap FreeType selects, and FT_Get_Char_Index

/** A character to glyph lookup. */
export type CharIndexer = (code: number) => number;

interface CmapSubtable {
  platformID: number;
  encodingID: number;
  offset: number;
}

function isUnicodeEncoding(platformID: number, encodingID: number): boolean {
  if (platformID === 0 || platformID === 2) return true;
  if (platformID === 3) return encodingID === 1 || encodingID === 10;
  return false;
}

function isUcs4(platformID: number, encodingID: number): boolean {
  return (platformID === 3 && encodingID === 10) || (platformID === 0 && encodingID === 4);
}

/**
 * FT_Get_Char_Index of a face: the glyph of a character in the Unicode charmap FreeType selects
 * (find_unicode_charmap: the last UCS-4 one, else the last Unicode one); 0 when the face has none
 * (a symbol font) or the glyph is past numGlyphs.
 */
export function unicodeCharIndexer(r: ByteReader, face: SfntFace, numGlyphs: number): CharIndexer {
  const t = face.tables.get('cmap');
  if (t === undefined) return () => 0;
  let subtables: CmapSubtable[] = [];
  try {
    const n = r.u16(t.offset + 2);
    for (let i = 0; i < n; i++) {
      const p = t.offset + 4 + i * 8;
      const sub = { platformID: r.u16(p), encodingID: r.u16(p + 2), offset: t.offset + r.u32(p + 4) };
      // Variation sequences (format 14) are not a charmap of characters
      if (r.u16(sub.offset) === 14) continue;
      subtables.push(sub);
    }
  } catch {
    subtables = [];
  }
  let chosen: CmapSubtable | undefined;
  for (let i = subtables.length - 1; i >= 0 && chosen === undefined; i--) {
    const s = subtables[i] as CmapSubtable;
    if (isUnicodeEncoding(s.platformID, s.encodingID) && isUcs4(s.platformID, s.encodingID)) chosen = s;
  }
  for (let i = subtables.length - 1; i >= 0 && chosen === undefined; i--) {
    const s = subtables[i] as CmapSubtable;
    if (isUnicodeEncoding(s.platformID, s.encodingID)) chosen = s;
  }
  if (chosen === undefined) return () => 0;
  const lookup = cmapLookup(r, chosen.offset);
  return (code: number) => {
    if (code < 0 || code > 0xffffffff) return 0;
    let g: number;
    try {
      g = lookup(code);
    } catch {
      g = 0;
    }
    return g >= numGlyphs ? 0 : g;
  };
}

function cmapLookup(r: ByteReader, offset: number): CharIndexer {
  const format = r.u16(offset);
  switch (format) {
    case 0: {
      const glyphs = r.bytes(offset + 6, 256);
      return (c) => (c < 256 ? (glyphs[c] ?? 0) : 0);
    }
    case 4: {
      const segX2 = r.u16(offset + 6);
      const segCount = segX2 / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segX2 + 2;
      const idDeltas = startCodes + segX2;
      const idRangeOffsets = idDeltas + segX2;
      const ends: number[] = [];
      const starts: number[] = [];
      const deltas: number[] = [];
      const ranges: number[] = [];
      for (let i = 0; i < segCount; i++) {
        ends.push(r.u16(endCodes + 2 * i));
        starts.push(r.u16(startCodes + 2 * i));
        deltas.push(r.i16(idDeltas + 2 * i));
        ranges.push(r.u16(idRangeOffsets + 2 * i));
      }
      return (c) => {
        if (c > 0xffff) return 0;
        // Binary search on the end codes
        let lo = 0;
        let hi = segCount - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((ends[mid] as number) < c) lo = mid + 1;
          else hi = mid;
        }
        if (lo >= segCount) return 0;
        const start = starts[lo] as number;
        if (c < start || c > (ends[lo] as number)) return 0;
        const ro = ranges[lo] as number;
        if (ro === 0) return (c + (deltas[lo] as number)) & 0xffff;
        const p = idRangeOffsets + 2 * lo + ro + 2 * (c - start);
        const g = r.u16(p);
        if (g === 0) return 0;
        return (g + (deltas[lo] as number)) & 0xffff;
      };
    }
    case 6: {
      const first = r.u16(offset + 6);
      const count = r.u16(offset + 8);
      return (c) => (c >= first && c < first + count ? r.u16(offset + 10 + 2 * (c - first)) : 0);
    }
    case 10: {
      const first = r.u32(offset + 12);
      const count = r.u32(offset + 16);
      return (c) => (c >= first && c < first + count ? r.u16(offset + 20 + 2 * (c - first)) : 0);
    }
    case 12:
    case 13: {
      const n = r.u32(offset + 12);
      const groups: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = offset + 16 + 12 * i;
        groups.push(r.u32(p), r.u32(p + 4), r.u32(p + 8));
      }
      return (c) => {
        let lo = 0;
        let hi = n - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const s = groups[3 * mid] as number;
          const e = groups[3 * mid + 1] as number;
          if (c < s) hi = mid - 1;
          else if (c > e) lo = mid + 1;
          else {
            const g0 = groups[3 * mid + 2] as number;
            return format === 12 ? g0 + (c - s) : g0;
          }
        }
        return 0;
      };
    }
    default:
      return () => 0;
  }
}
