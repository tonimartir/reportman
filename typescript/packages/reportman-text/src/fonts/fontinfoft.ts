// The TrueType font provider of the C# engine without native code (FontInfoFt.cs, its directory
// scan path: the way it finds fonts where there is no fontconfig): the faces of the font files are
// enumerated once, a font is chosen by its family and style (aliases, defaults, coverage of the text),
// its metrics follow the OS/2 rules of the C# provider, widths and glyphs are read as FreeType reads
// them, the text is laid out shaped with fontkit (bidi, scripts, fallback by coverage) and the font
// program embedded is a fontkit subset.

import type { LineInfo } from '@reportman/metafile';
import { PrintStepType } from '@reportman/metafile';
import { PDFFont } from '../pdffont.js';
import { BidiParagraph, UBIDI_DEFAULT_LTR, UBIDI_DEFAULT_RTL } from '../bidi.js';
import { HtmlTextParser, type HtmlFormatRun } from '../html/htmltextparser.js';
import {
  ByteReader,
  describeFace,
  faceCount,
  readCodePages,
  readFace,
  readFvar,
  readOs2Metrics,
  unicodeCharIndexer,
  type CharIndexer,
  type FvarInfo,
  type SfntFace,
} from './sfnt.js';
import { memoryFontFile, type FontFileSource, type FontPlatform } from './sources.js';
import { isWoff, woffToSfnt } from './woff.js';
import { openFontkitFace, type FkFont } from './fontkitfont.js';
import { shapeText } from './shaper.js';
import { compareCulture } from './culturemap.js';
import { subsetFont } from './subset.js';
import {
  LineGlyphs,
  breakChunksLTR,
  breakChunksRTL,
  dividesIntoLines,
  fillPossibleLineBreaksString,
  isWhiteSpaceNet,
} from './htmllayout.js';
import { SortedNumberMap, TTFontData, newGlyphPos, type FontInfoProvider, type GlyphInfo, type TGlyphPos } from './ttfontdata.js';

/** String.ToUpper of .NET for the names of fonts: no change of length. */
export function toUpperNet(s: string): string {
  let out = '';
  for (const ch of s) {
    const u = ch.toUpperCase();
    out += u.length === ch.length ? u : ch;
  }
  return out;
}

/** Math.Round of .NET: half to even. */
function roundNet(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}


/** A face of a font file as the provider describes it (LogFontFt). */
export class LogFontFt {
  fixedpitch = false;
  /** The family name without spaces (not the PostScript name of the font). */
  postcriptname = '';
  familyname = '';
  stylename = '';
  italic = false;
  bold = false;
  filename = '';
  ascent = 0;
  descent = 0;
  height = 0;
  weight = 0;
  MaxWidth = 0;
  avCharWidth = 0;
  Capheight = 0;
  ItalicAngle = 0;
  leading = 0;
  BBox = { left: 0, top: 0, width: 0, height: 0 };
  havekerning = false;
  type1 = false;
  widthmult = 1;
  convfactor = 1;
  heightmult = 1;
  keyname = '';
  /** The face inside the file; the upper 16 bits name the instance of a variable font. */
  faceIndex = 0;
  scalable = false;
  unitsPerEM = 0;
  numGlyphs = 0;
  cff = false;
  /** The file. */
  file!: FontFile;
}

/** A font file of the library: its reader and what is read from it once. */
export class FontFile {
  readonly source: FontFileSource;
  readonly reader: ByteReader;
  private readonly faces = new Map<number, SfntFace | null>();
  private readonly indexers = new Map<number, CharIndexer>();
  private readonly fonts = new Map<number, FkFont>();
  private readonly advances = new Map<number, { count: number; hmtx: number; numGlyphs: number }>();

  constructor(source: FontFileSource) {
    this.source = source;
    // A WOFF web font is read as the sfnt it was made from (the faces, the PDF subset)
    this.reader = isWoff(source.read(0, 4)) ? new ByteReader(memoryFontFile(source.path, woffToSfnt(source.readAll()))) : new ByteReader(source);
  }

  get path(): string {
    return this.source.path;
  }

  /** The whole file. */
  bytes(): Uint8Array {
    return this.reader.all();
  }

  face(faceIndex: number): SfntFace | null {
    const key = faceIndex & 0xffff;
    if (!this.faces.has(key)) this.faces.set(key, readFace(this.reader, key));
    return this.faces.get(key) ?? null;
  }

  /** FT_Get_Char_Index of a face. */
  charIndex(faceIndex: number, numGlyphs: number, code: number): number {
    const key = faceIndex & 0xffff;
    let ix = this.indexers.get(key);
    if (ix === undefined) {
      const face = this.face(key);
      ix = face === null ? () => 0 : unicodeCharIndexer(this.reader, face, numGlyphs);
      this.indexers.set(key, ix);
    }
    return ix(code);
  }

  /** The fontkit font of a face (its instance when the index names one). */
  fontkit(faceIndex: number): FkFont {
    let f = this.fonts.get(faceIndex);
    if (f === undefined) {
      let coords: Record<string, number> | null = null;
      const instance = faceIndex >>> 16;
      if (instance > 0) {
        const face = this.face(faceIndex);
        const fvar = face === null ? null : readFvar(this.reader, face);
        const inst = fvar?.instances[instance - 1];
        if (fvar !== null && inst !== undefined) {
          coords = {};
          fvar.axes.forEach((a, i) => {
            (coords as Record<string, number>)[a.tag.trim()] = inst.coords[i] ?? a.def;
          });
        }
      }
      f = openFontkitFace(this.bytes(), faceIndex, coords);
      this.fonts.set(faceIndex, f);
    }
    return f;
  }

  /** The unscaled advance of a glyph (FT_Load_Glyph with FT_LOAD_NO_SCALE, horiAdvance). */
  advance(faceIndex: number, glyph: number): number {
    const key = faceIndex & 0xffff;
    let m = this.advances.get(key);
    const r = this.reader;
    if (m === undefined) {
      const face = this.face(key);
      const hhea = face?.tables.get('hhea');
      const hmtx = face?.tables.get('hmtx');
      const maxp = face?.tables.get('maxp');
      m = {
        count: hhea === undefined ? 0 : r.u16(hhea.offset + 34),
        hmtx: hmtx === undefined ? -1 : hmtx.offset,
        numGlyphs: maxp === undefined ? 0 : r.u16(maxp.offset + 4),
      };
      this.advances.set(key, m);
    }
    let adv = 0;
    if (m.hmtx >= 0 && m.count > 0) adv = r.u16(m.hmtx + 4 * Math.min(glyph, m.count - 1));
    if (faceIndex >>> 16 > 0) {
      // A named instance: the HVAR delta, rounded as FreeType rounds a 16.16 delta
      const f = this.fontkit(faceIndex);
      const varied = f.getGlyph(glyph).advanceWidth;
      if (Number.isFinite(varied)) adv = adv + Math.floor(varied - adv + 0.5);
    }
    return adv;
  }
}

/** The options of a font library. */
export interface FontLibraryOptions {
  /**
   * Whose family names the fonts are chosen by: Windows uses the WFontName of a report, Unix and
   * macOS its LFontName (on macOS the WFontName when the Mac has only that one). 'windows' by default.
   */
  platform?: FontPlatform;
}

/**
 * The fonts a provider chooses from: the faces of the font files, enumerated once in the order the
 * files are given (the static state of FontInfoFt: its list of faces, the default fonts, the
 * fallbacks already found). One library can serve many reports; clone() gives one with the same
 * faces and none of the state the reports leave behind.
 */
export class FontLibrary {
  readonly platform: FontPlatform;
  private readonly files: FontFile[];
  private readonly byPath = new Map<string, FontFile>();
  private scanned = false;
  /** The faces by key (FAMILY____B?I?), and the aliases resolved. */
  readonly fontlist = new Map<string, LogFontFt>();
  private sortedKeys: string[] = [];
  /** The fallback found for a set of code points and a style. */
  readonly reservaporcobertura = new Map<string, LogFontFt | null>();
  readonly logfontsbyfile = new Map<string, LogFontFt>();
  defaultfont: LogFontFt | null = null;
  defaultfontb: LogFontFt | null = null;
  defaultfontit: LogFontFt | null = null;
  defaultfontbit: LogFontFt | null = null;
  /** The shaping font of each face, with the scale it was made with (FuenteHarfBuzzDe). */
  readonly shapingFonts = new Map<string, { font: FkFont; scale: number }>();
  private base: { fontlist: [string, LogFontFt][]; defaults: (LogFontFt | null)[]; byFile: [string, LogFontFt][] } | null = null;

  constructor(sources: readonly FontFileSource[], options: FontLibraryOptions = {}) {
    this.platform = options.platform ?? 'windows';
    this.files = [];
    for (const s of sources) {
      const f = new FontFile(s);
      this.files.push(f);
      if (!this.byPath.has(s.path)) this.byPath.set(s.path, f);
    }
  }

  /** A library with the same faces (scanned once) and a clean state. */
  clone(): FontLibrary {
    this.ensureScanned();
    const lib = Object.create(FontLibrary.prototype) as FontLibrary;
    const base = this.base as NonNullable<FontLibrary['base']>;
    Object.assign(lib, {
      platform: this.platform,
      files: this.files,
      byPath: this.byPath,
      scanned: true,
      fontlist: new Map(base.fontlist),
      sortedKeys: base.fontlist.map((e) => e[0]),
      reservaporcobertura: new Map(),
      logfontsbyfile: new Map(base.byFile),
      defaultfont: base.defaults[0],
      defaultfontb: base.defaults[1],
      defaultfontit: base.defaults[2],
      defaultfontbit: base.defaults[3],
      shapingFonts: new Map(),
      base,
    });
    return lib;
  }

  /** The font file of a path, or null. */
  fileOf(path: string): FontFile | null {
    return this.byPath.get(path) ?? null;
  }

  /** The keys of the list of faces, in the order of the C# SortedList. */
  keys(): readonly string[] {
    this.ensureScanned();
    return this.sortedKeys;
  }

  /** Adds an entry to the list of faces (an alias resolved); fails when the key is there. */
  addFont(key: string, font: LogFontFt | null): void {
    if (this.fontlist.has(key)) throw new Error('An item with the same key has already been added. Key: ' + key);
    this.fontlist.set(key, font as LogFontFt);
    // Sorted insertion
    let lo = 0;
    let hi = this.sortedKeys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareCulture(this.sortedKeys[mid] as string, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.sortedKeys.splice(lo, 0, key);
  }

  /** Describes a face of a file (FillLogFont); throws when it cannot be opened. */
  fillLogFont(file: FontFile, faceIndex: number): LogFontFt {
    const info = describeFace(file.reader, faceIndex);
    const aobj = new LogFontFt();
    aobj.file = file;
    aobj.filename = file.path;
    aobj.faceIndex = faceIndex;
    aobj.scalable = info.scalable;
    aobj.type1 = !info.sfnt;
    aobj.unitsPerEM = info.unitsPerEM;
    aobj.numGlyphs = info.numGlyphs;
    aobj.cff = info.cff;
    aobj.convfactor = info.unitsPerEM === 0 ? 1 : 1000.0 / info.unitsPerEM;
    aobj.widthmult = 1;
    aobj.heightmult = 1;
    const familyName = info.familyName;
    aobj.postcriptname = familyName.replaceAll(' ', '');
    aobj.familyname = familyName;
    aobj.fixedpitch = info.fixedWidth;
    aobj.havekerning = info.kerning;
    aobj.ascent = roundNet(aobj.convfactor * info.ascender);
    aobj.descent = roundNet(aobj.convfactor * info.descender);
    aobj.height = roundNet(aobj.convfactor * info.height);
    aobj.leading = roundNet(aobj.convfactor * info.height) - (aobj.ascent - aobj.descent);
    aobj.MaxWidth = roundNet(aobj.convfactor * info.maxAdvanceWidth);
    aobj.Capheight = roundNet(aobj.convfactor * info.ascender);
    aobj.stylename = info.styleName;
    aobj.bold = info.bold;
    aobj.italic = info.italic;
    if (!aobj.bold)
      aobj.bold =
        toUpperNet(aobj.stylename).indexOf('BOLD') >= 0 ||
        toUpperNet(aobj.postcriptname).indexOf('BOLD') >= 0 ||
        toUpperNet(aobj.filename).indexOf('BOLD') >= 0;
    if (!aobj.italic)
      aobj.italic =
        toUpperNet(aobj.stylename).indexOf('ITALIC') >= 0 ||
        toUpperNet(aobj.stylename).indexOf('OBLIQUE') >= 0 ||
        toUpperNet(aobj.postcriptname).indexOf('ITALIC') >= 0 ||
        toUpperNet(aobj.postcriptname).indexOf('OBLIQUE') >= 0 ||
        toUpperNet(aobj.filename).indexOf('ITALIC') >= 0 ||
        toUpperNet(aobj.filename).indexOf('OBLIQUE') >= 0;
    aobj.keyname = toUpperNet(familyName + '____' + (aobj.bold ? 'B1' : 'B0') + (aobj.italic ? 'I1' : 'I0'));
    return aobj;
  }

  /** The face of a file and index, read the first time only (GetOrAddLogFont). */
  getOrAddLogFont(path: string, faceIndex: number): LogFontFt {
    const key = path + '|' + String(faceIndex);
    const found = this.logfontsbyfile.get(key);
    if (found !== undefined) return found;
    const file = this.fileOf(path);
    if (file === null) throw new Error('Freetype function call error: the font file ' + path + ' is not in the font library');
    const nfont = this.fillLogFont(file, faceIndex);
    this.logfontsbyfile.set(key, nfont);
    return nfont;
  }

  /** The face indexes of a file worth enumerating: its faces and the style instances of a variable font. */
  private facesOf(file: FontFile): number[] {
    let n = 1;
    try {
      n = faceCount(file.reader);
    } catch {
      n = 1;
    }
    if (n < 1) n = 1;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      result.push(i);
      // InstanciasDeEstilo: the named instances "Bold", "Italic" and "Bold Italic"
      try {
        const info = describeFace(file.reader, i);
        for (let j = 1; j <= info.namedInstances; j++) {
          const index = (j << 16) | i;
          let style = '';
          try {
            style = describeFace(file.reader, index).styleName;
          } catch {
            continue;
          }
          if (style === 'Bold' || style === 'Italic' || style === 'Bold Italic') result.push(index);
        }
      } catch {
        // FT_New_Face failed: no instances
      }
    }
    return result;
  }

  /** Enumerates the faces once (InitLibrary, the directory scan). */
  ensureScanned(): void {
    if (this.scanned) return;
    this.scanned = true;
    for (const file of this.files) {
      for (const ncara of this.facesOf(file)) {
        let aobj: LogFontFt;
        try {
          aobj = this.fillLogFont(file, ncara);
        } catch {
          continue;
        }
        if (!aobj.scalable) continue;
        const up = toUpperNet(aobj.familyname);
        if (!aobj.italic && !aobj.bold) {
          if (this.defaultfont === null) this.defaultfont = aobj;
          else if (up === 'LUXI SANS') this.defaultfont = aobj;
          else if (up === 'DEJAVU SANS') this.defaultfont = aobj;
        } else if (!aobj.italic && aobj.bold) {
          if (this.defaultfontb === null) this.defaultfontb = aobj;
          else if (up === 'LUXI SANS') this.defaultfontb = aobj;
        } else if (aobj.italic && !aobj.bold) {
          if (this.defaultfontit === null) this.defaultfontit = aobj;
          else if (up === 'LUXI SANS') this.defaultfontit = aobj;
        } else {
          if (this.defaultfontbit === null) this.defaultfontbit = aobj;
          else if (up === 'LUXI SANS') this.defaultfontbit = aobj;
        }
        if (!this.fontlist.has(aobj.keyname)) this.fontlist.set(aobj.keyname, aobj);
      }
    }
    this.sortedKeys = [...this.fontlist.keys()].sort(compareCulture);
    if (this.fontlist.size === 0) throw new Error('No fonts detected');
    for (const preferida of ['LUXI SANS', 'DEJAVU SANS', 'LIBERATION SANS', 'ROBOTO', 'NOTO SANS', 'ARIAL']) {
      const regular = this.fontlist.get(preferida + '____B0I0');
      if (regular === undefined) continue;
      if (this.defaultfont === null || toUpperNet(this.defaultfont.familyname) !== preferida) {
        const elected =
          this.defaultfont !== null &&
          (toUpperNet(this.defaultfont.familyname) === 'LUXI SANS' || toUpperNet(this.defaultfont.familyname) === 'DEJAVU SANS');
        if (!elected) {
          this.defaultfont = regular;
          const b = this.fontlist.get(preferida + '____B1I0');
          if (b !== undefined) this.defaultfontb = b;
          const i = this.fontlist.get(preferida + '____B0I1');
          if (i !== undefined) this.defaultfontit = i;
          const bi = this.fontlist.get(preferida + '____B1I1');
          if (bi !== undefined) this.defaultfontbit = bi;
        }
      }
      break;
    }
    if (this.defaultfont === null) this.defaultfont = this.fontlist.get(this.sortedKeys[0] as string) ?? null;
    this.base = {
      fontlist: this.sortedKeys.map((k) => [k, this.fontlist.get(k) as LogFontFt]),
      defaults: [this.defaultfont, this.defaultfontb, this.defaultfontit, this.defaultfontbit],
      byFile: [...this.logfontsbyfile],
    };
  }
}

/** The face key of a font: "file|faceIndex" (ClaveDeCara). */
export function faceKeyOf(f: LogFontFt | null): string | null {
  return f === null ? null : f.filename + '|' + String(f.faceIndex);
}

/** The code points of a text without blanks and controls (Codigos). */
function codePointsOf(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (cp <= 32 || cp === 0xa0) continue;
    out.push(cp);
  }
  return out;
}

/** The OS/2 code page bit that is the idiomatic choice for some characters, -1 when they say nothing. */
function codePageFor(cps: number[]): number {
  let han = false;
  for (const cp of cps) {
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) return 17;
    if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff)) return 19;
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff)) han = true;
  }
  if (han) return 18;
  return -1;
}

/** How many of those code points the face has a glyph for (CuantosCubre). */
function coverageOf(f: LogFontFt, cps: number[]): number {
  let n = 0;
  try {
    for (const cp of cps) if (f.file.charIndex(f.faceIndex, f.numGlyphs, cp) !== 0) n++;
  } catch {
    return 0;
  }
  return n;
}

/** Whether every visible character is an emoji (EsSoloEmoji). */
export function isOnlyEmoji(text: string): boolean {
  let any = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x20 || cp === 0x200d || cp === 0x20e3 || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if ((cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0x1f000 && cp <= 0x1faff)) {
      any = true;
      continue;
    }
    return false;
  }
  return any;
}

/**
 * The script of a text from its first significant character (DetectScript): digits and
 * punctuation do not decide it; Latin when nothing does.
 */
export function detectScript(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp <= 0x20) continue;
    if (cp < 0x41 || (cp > 0x5a && cp < 0x61) || (cp > 0x7a && cp < 0xc0) || cp === 0xd7 || cp === 0xf7) continue;
    if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff))
      return 'Arab';
    if ((cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f)) return 'Hebr';
    if (cp >= 0x0e00 && cp <= 0x0e7f) return 'Thai';
    if (cp >= 0x0900 && cp <= 0x097f) return 'Deva';
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x3000 && cp <= 0x303f)) return 'Hani';
    if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) return 'Hang';
    if (cp >= 0x0020 && cp <= 0x024f) return 'Latn';
  }
  return 'Latn';
}

/** The OpenType script tags HarfBuzz tries for a script, in order. */
function openTypeScripts(script: string): string[] {
  switch (script) {
    case 'Arab':
      return ['arab'];
    case 'Hebr':
      return ['hebr'];
    case 'Thai':
      return ['thai'];
    case 'Deva':
      return ['dev3', 'dev2', 'deva'];
    case 'Hani':
      return ['hani'];
    case 'Hang':
      return ['hang'];
    default:
      return ['latn'];
  }
}

/** A stretch of a chunk drawn with one font (Tramo). */
interface Stretch {
  start: number;
  length: number;
  needsFallback: boolean;
}

/** A measured text: its lines and the extent (the Rect of the C# call). */
export interface ProviderTextExtent {
  lines: LineInfo[];
  width: number;
  height: number;
}

/**
 * The TrueType provider (FontInfoFt): font choice, metrics, widths, glyphs, the shaped layout and
 * the font programs, over a FontLibrary.
 */
export class FontInfoFt implements FontInfoProvider {
  readonly providerName = 'FontInfoFt';
  readonly unixFamilyNames: boolean;
  readonly library: FontLibrary;
  private currentfont: LogFontFt | null = null;
  /** The metrics of each font variant this provider measured with (fontDataCache). */
  private readonly fontDataCache = new Map<string, TTFontData>();

  constructor(library: FontLibrary) {
    this.library = library;
    this.unixFamilyNames = library.platform !== 'windows';
    library.ensureScanned();
  }

  private get isUnix(): boolean {
    return this.library.platform !== 'windows';
  }

  private get isMacOS(): boolean {
    return this.library.platform === 'macos';
  }

  /** The family of an X11 font name ("adobe-courier"), empty when the name is not one. */
  static x11Family(name: string): string {
    if (name === '') return '';
    let rest = name.startsWith('-') ? name.substring(1) : name;
    let p = rest.indexOf('-');
    if (p <= 0) return '';
    rest = rest.substring(p + 1);
    p = rest.indexOf('-');
    if (p >= 0) rest = rest.substring(0, p);
    return rest.trim();
  }

  private platformFamily(family: string): string {
    if (this.isMacOS && family.toLowerCase() === 'courier') return 'Courier New';
    return family;
  }

  private hasFamily(family: string): boolean {
    for (const key of this.library.keys()) if (key.startsWith(family + '____')) return true;
    return false;
  }

  private baseFamily(pdfFont: PDFFont): string {
    const lname = pdfFont.lFontName ?? '';
    if (!this.isMacOS) return lname;
    const wname = pdfFont.wFontName ?? '';
    if (wname.length > 0 && !(lname !== '' && this.hasFamily(toUpperNet(lname))) && this.hasFamily(toUpperNet(wname))) return wname;
    return lname;
  }

  private static readonly ALIASES: readonly (readonly string[])[] = [
    ['ARIAL', 'HELVETICA', 'LIBERATION SANS', 'ARIMO', 'ROBOTO', 'DEJAVU SANS', 'NOTO SANS', 'OPEN SANS', 'CANTARELL'],
    ['TIMES NEW ROMAN', 'TIMES', 'LIBERATION SERIF', 'TINOS', 'NOTO SERIF', 'DEJAVU SERIF', 'ROBOTO SERIF'],
    ['COURIER NEW', 'COURIER', 'LIBERATION MONO', 'COUSINE', 'ROBOTO MONO', 'DROID SANS MONO', 'DEJAVU SANS MONO', 'NOTO SANS MONO', 'CUTIVE MONO'],
  ];

  private searchByAlias(family: string, suffix: string): LogFontFt | null {
    const lib = this.library;
    for (const group of FontInfoFt.ALIASES) {
      if (group.indexOf(family) < 0) continue;
      for (const alias of group) {
        if (alias === family) continue;
        const f = lib.fontlist.get(alias + suffix);
        if (f !== undefined) return f;
      }
      for (const alias of group) {
        if (alias === family) continue;
        for (const key of lib.keys()) if (key.startsWith(alias + '____')) return lib.fontlist.get(key) ?? null;
      }
      return null;
    }
    return null;
  }

  /** Chooses the face of a request from the list, by family and style (SelectFontPorNombre). */
  private selectFontByName(pdfFont: PDFFont): void {
    const lib = this.library;
    let fontname: string;
    if (this.isUnix) fontname = toUpperNet(this.baseFamily(pdfFont));
    else {
      if (pdfFont.wFontName === null) throw new TypeError('Object reference not set to an instance of an object.');
      fontname = toUpperNet(pdfFont.wFontName);
    }
    const x11 = FontInfoFt.x11Family(fontname);
    if (x11.length > 0 && !this.hasFamily(fontname)) fontname = x11;
    fontname = toUpperNet(this.platformFamily(fontname));
    const familyname = fontname;
    const isbold = (pdfFont.style & 1) > 0;
    const isitalic = (pdfFont.style & 2) > 0;
    let suffix = isbold ? '____B1' : '____B0';
    suffix = suffix + (isitalic ? 'I1' : 'I0');
    fontname = fontname + suffix;
    const exact = lib.fontlist.get(fontname);
    if (exact !== undefined || lib.fontlist.has(fontname)) {
      this.currentfont = exact ?? null;
      return;
    }
    // Search similar font
    let familyonly = '';
    for (const fname of lib.keys()) {
      if (fname.indexOf(familyname) >= 0) {
        familyonly = fname;
        if (fname.indexOf(suffix) >= 0) {
          this.currentfont = lib.fontlist.get(fname) ?? null;
          return;
        }
      }
    }
    if (familyonly.length > 0) {
      this.currentfont = lib.fontlist.get(familyonly) ?? null;
      return;
    }
    const byAlias = this.searchByAlias(familyname, suffix);
    if (byAlias !== null) {
      this.currentfont = byAlias;
      lib.addFont(fontname, this.currentfont);
      return;
    }
    if (isbold && isitalic) this.currentfont = lib.defaultfontbit;
    else if (isbold && !isitalic) this.currentfont = lib.defaultfontb;
    else if (!isbold && isitalic) this.currentfont = lib.defaultfontit;
    else this.currentfont = lib.defaultfont;
    lib.addFont(fontname, this.currentfont);
  }

  /** The distinct code points of a text a face has no glyph for (CodigosSinGlifo). */
  private missingCodePoints(afont: LogFontFt | null, content: string): number[] {
    if (afont === null || content === '') return [];
    const missing: number[] = [];
    try {
      for (const cp of codePointsOf(content)) {
        if (missing.includes(cp)) continue;
        if (afont.file.charIndex(afont.faceIndex, afont.numGlyphs, cp) === 0) missing.push(cp);
      }
    } catch {
      return [];
    }
    return missing;
  }

  /** A face of the list that covers the code points the chosen one misses, same style first (BuscaPorCobertura). */
  private searchByCoverage(missing: number[], bold: boolean, italic: boolean): LogFontFt | null {
    const lib = this.library;
    const sorted = [...missing].sort((a, b) => a - b);
    let nkey = '';
    for (const cp of sorted) nkey += String(cp) + ',';
    nkey += (bold ? 'B1' : 'B0') + (italic ? 'I1' : 'I0');
    if (lib.reservaporcobertura.has(nkey)) return lib.reservaporcobertura.get(nkey) ?? null;
    const bit = codePageFor(missing);
    let best: LogFontFt | null = null;
    let bestCover = 0;
    let bestIdiomatic = false;
    const keys = lib.keys();
    for (let pass = 0; pass < 2; pass++) {
      for (const key of keys) {
        const candidate = lib.fontlist.get(key);
        if (candidate === undefined || candidate === null) continue;
        const sameStyle = candidate.bold === bold && candidate.italic === italic;
        if ((pass === 0) !== sameStyle) continue;
        if (!candidate.scalable || candidate.type1) continue;
        const cover = coverageOf(candidate, missing);
        if (cover === 0) continue;
        const idiomatic =
          bit >= 0 && cover === missing.length && (readCodePages(candidate.file.reader, candidate.faceIndex) & (1 << bit)) !== 0;
        let wins: boolean;
        if (idiomatic !== bestIdiomatic) wins = idiomatic;
        else wins = cover > bestCover;
        if (wins) {
          bestCover = cover;
          best = candidate;
          bestIdiomatic = idiomatic;
          if (cover === missing.length && (bit < 0 || idiomatic)) break;
        }
      }
      if (bestCover === missing.length && (bit < 0 || bestIdiomatic)) break;
    }
    lib.reservaporcobertura.set(nkey, best);
    return best;
  }

  /** Chooses the face of a request (SelectFont): by name, then by coverage of the content. */
  private selectFont(pdfFont: PDFFont, content = ''): void {
    this.selectFontByName(pdfFont);
    if (content.length > 0) {
      const missing = this.missingCodePoints(this.currentfont, content);
      if (missing.length > 0) {
        const covers = this.searchByCoverage(missing, (pdfFont.style & 1) > 0, (pdfFont.style & 2) > 0);
        if (covers !== null) this.currentfont = covers;
      }
    }
  }

  /** Fills the metrics of the font a request resolves to (FillFontData). */
  fillFontData(pdfFont: PDFFont, data: TTFontData, content = ''): void {
    this.selectFont(pdfFont, content);
    if (this.currentfont === null) throw new Error('No font available for ' + String(pdfFont.getFontFamily()));
    this.fillMetrics(pdfFont, data, this.currentfont);
  }

  /** Fills the metrics of a named face, "file|faceIndex" (FillFontDataForFace); false when it names none. */
  fillFontDataForFace(pdfFont: PDFFont, data: TTFontData, faceKey: string): boolean {
    const face = this.faceOfKey(faceKey);
    if (face === null) return false;
    this.fillMetrics(pdfFont, data, face);
    return true;
  }

  private faceOfKey(faceKey: string | null): LogFontFt | null {
    if (faceKey === null || faceKey === '') return null;
    const cut = faceKey.lastIndexOf('|');
    if (cut <= 0) return null;
    const text = faceKey.substring(cut + 1);
    if (!/^[+-]?\d+$/.test(text.trim())) return null;
    const index = parseInt(text, 10);
    return this.library.getOrAddLogFont(faceKey.substring(0, cut), index);
  }

  /** The metrics of a chosen face (RellenarLasMetricas), with the OS/2 rules of DirectWrite / GDI. */
  private fillMetrics(pdfFont: PDFFont, data: TTFontData, face: LogFontFt): void {
    data.isUnicode = true;
    if (!face.type1 && data.fontData === null) data.fontData = face.file.bytes();
    data.postcriptName = face.postcriptname;
    data.faceKey = faceKeyOf(face);
    data.fontFamily = face.familyname;
    data.faceName = face.familyname;
    data.ascent = face.ascent;
    data.descent = face.descent;
    data.leading = face.leading;
    data.height = face.height > 0 ? face.height : face.ascent - face.descent + face.leading;
    if (data.fontData !== null) {
      const os2 = readOs2Metrics(face.file.reader);
      if (os2.found) {
        const cf = face.convfactor;
        if ((os2.fsSelection & 0x0080) !== 0) {
          const dwAscent = os2.sTypoAscender;
          const dwDescent = -os2.sTypoDescender;
          const dwLineGap = os2.sTypoLineGap;
          data.ascent = roundNet(cf * dwAscent);
          data.descent = -roundNet(cf * dwDescent);
          data.height = roundNet(cf * (dwAscent + dwDescent + dwLineGap));
          data.leading = data.height - data.ascent + data.descent;
        } else {
          data.ascent = roundNet(cf * os2.usWinAscent);
          data.descent = -roundNet(cf * os2.usWinDescent);
          data.leading = data.height - data.ascent + data.descent;
        }
      }
    }
    data.capHeight = face.Capheight;
    data.encoding = 'WinAnsiEncoding';
    data.fontWeight = 0;
    data.maxWidth = face.MaxWidth;
    data.avgWidth = face.avCharWidth;
    data.haveKerning = face.havekerning;
    data.stemV = 0;
    data.fontStretch = '/Normal';
    data.fontBBox = { ...face.BBox };
    data.logFont = face;
    data.italicAngle = face.italic ? -15 : 0;
    data.styleName = face.stylename;
    data.flags = 32;
    if (face.fixedpitch) data.flags = data.flags + 1;
    if (pdfFont.bold) data.postcriptName = data.postcriptName + ',Bold';
    if (pdfFont.italic) {
      if (pdfFont.bold) data.postcriptName = data.postcriptName + 'Italic';
      else data.postcriptName = data.postcriptName + ',Italic';
    }
    data.type1 = face.type1;
    data.cacheWidths = new SortedNumberMap<GlyphInfo>();
  }

  /** The width of a character (a UTF-16 code unit) in thousandths of the em, registering it (GetCharWidth). */
  getCharWidth(_pdfFont: PDFFont, data: TTFontData, charCode: number): number {
    const cached = data.cacheWidths.get(charCode);
    if (cached !== undefined) return cached.width;
    const known = data.widths.get(charCode);
    if (known !== undefined) return known;
    const cfont = data.logFont as LogFontFt;
    data.unitsPerEM = cfont.unitsPerEM;
    const glyphIndex = cfont.file.charIndex(cfont.faceIndex, cfont.numGlyphs, charCode);
    const advanceWidth = cfont.file.advance(cfont.faceIndex, glyphIndex);
    const awidth = advanceWidth * (1000.0 / cfont.unitsPerEM);
    data.widths.set(charCode, awidth);
    data.glyphs.set(charCode, glyphIndex);
    if (data.firstLoaded > charCode) data.firstLoaded = charCode;
    if (data.lastLoaded < charCode) data.lastLoaded = charCode;
    if (!data.cacheWidths.has(charCode)) data.cacheWidths.add(charCode, { width: awidth, glyph: glyphIndex, char: 0 });
    return awidth;
  }

  /**
   * The width of a glyph of the shaping, registering it (GetGlyphWidth): a glyph that is not the
   * nominal one of its character (a ligature, a contextual form) gets a private use character so
   * it is subset and declared.
   */
  getGlyphWidth(pdfFont: PDFFont, data: TTFontData, glyph: number, charC: number, faceKey: string | null): number {
    this.getCharWidth(pdfFont, data, charC);
    const known = data.glyphsInfo.get(glyph);
    if (known !== undefined) return known.width;
    const nominal = data.cacheWidths.get(charC);
    if (nominal !== undefined && nominal.glyph === glyph) {
      data.glyphsInfo.add(glyph, nominal);
      return nominal.width;
    }
    let puaChar = 0xe000 + data.glyphsInfo.size;
    let cfont = data.logFont as LogFontFt;
    if (faceKey !== null && faceKey !== '' && faceKey !== faceKeyOf(cfont)) {
      const own = this.faceOfKey(faceKey);
      if (own !== null) cfont = own;
    }
    if (glyph < 0 || glyph >= cfont.numGlyphs)
      throw new Error(
        'El glifo ' + String(glyph) + ' no es de esta cara: «' + cfont.filename + '» (cara ' + String(cfont.faceIndex & 0xffff) +
          ', familia «' + cfont.familyname + '») sólo tiene ' + String(cfont.numGlyphs) + ' glifos. Viene del caracter U+' +
          charC.toString(16).toUpperCase().padStart(4, '0') + '. Cara pedida por el conformado: «' + (faceKey ?? '(ninguna)') +
          '»; cara de las métricas: «' + (data.faceKey ?? '(ninguna)') + '». Un índice de glifo sólo vale para la cara que lo ' +
          'produjo, y un NOMBRE de familia no basta para volver a ella: ver TGlyphPos.FaceKey.',
      );
    const advanceWidth = cfont.file.advance(cfont.faceIndex, glyph);
    const awidth = roundNet(advanceWidth * cfont.convfactor * cfont.widthmult);
    const ninfo: GlyphInfo = { width: awidth, glyph, char: 0 };
    while (data.cacheWidths.has(puaChar)) puaChar++;
    data.cacheWidths.add(puaChar, ninfo);
    data.widths.add(puaChar, awidth);
    data.glyphs.add(puaChar, glyph);
    data.glyphsInfo.add(glyph, ninfo);
    return awidth;
  }

  /** The kerning of a pair of characters (GetKerning); unused by the shaped output. */
  getKerning(_pdfFont: PDFFont, data: TTFontData, leftChar: number, rightChar: number): number {
    const cfont = data.logFont as LogFontFt;
    if (!cfont.havekerning) return 0;
    const key = String(leftChar) + ':' + String(rightChar);
    const known = data.kernings.get(key);
    if (known !== undefined) return known;
    const w1 = cfont.file.charIndex(cfont.faceIndex, cfont.numGlyphs, leftChar);
    const w2 = w1 > 0 ? cfont.file.charIndex(cfont.faceIndex, cfont.numGlyphs, rightChar) : 0;
    if (w1 > 0 && w2 > 0) {
      const kp = cfont.file.fontkit(cfont.faceIndex)._layoutEngine.kernProcessor;
      const v = kp === null ? 0 : kp.getKerning(w1, w2);
      return roundNet(cfont.widthmult * -v);
    }
    data.kernings.set(key, 0);
    return 0;
  }

  /** The font program to embed: a subset with the glyphs used (GetFontStream). */
  getFontStream(data: TTFontData): Uint8Array {
    const face = data.logFont as LogFontFt;
    return subsetFont(face.file.fontkit(face.faceIndex), data, face.faceIndex);
  }

  // -------------------------------------------------------------------------------------------
  // Layout

  /** The shaping font of a face, made once with the units per em its metrics had then (FuenteHarfBuzzDe). */
  private shapingFont(adata: TTFontData, face: LogFontFt): { font: FkFont; scale: number } {
    const key = faceKeyOf(face) as string;
    let sf = this.library.shapingFonts.get(key);
    if (sf === undefined) {
      sf = { font: face.file.fontkit(face.faceIndex), scale: Math.trunc(adata.unitsPerEM) };
      this.library.shapingFonts.set(key, sf);
    }
    return sf;
  }

  /** Shapes a chunk with the font of a variant (CalcGlyphPositions + DarForma), in twips. */
  private calcGlyphPositions(text: string, rightToLeft: boolean, script: string, fontSize: number, adata: TTFontData, pdfFont: PDFFont): TGlyphPos[] {
    if (text === '') return [];
    if (adata.fontData === null) this.fillFontData(pdfFont, adata);
    const face = adata.logFont as LogFontFt;
    const sf = this.shapingFont(adata, face);
    const language = script === 'Arab' ? 'ARA ' : null;
    const shaped = shapeText(sf.font, text, rightToLeft, openTypeScripts(script), language, sf.scale);
    const scaleFactor = (fontSize * 20.0) / adata.unitsPerEM;
    return shaped.map((s) => {
      const g = newGlyphPos();
      g.glyphIndex = s.glyph & 0xffff;
      g.xAdvance = roundNet(s.xAdvance * scaleFactor);
      g.xOffset = roundNet(s.xOffset * scaleFactor);
      g.yOffset = roundNet(s.yOffset * scaleFactor);
      g.cluster = s.cluster;
      if (g.cluster < text.length) g.charCode = text.charCodeAt(g.cluster);
      return g;
    });
  }

  /** Cuts a chunk in stretches by coverage of a face (TroceaPorCobertura); a right to left run is never cut. */
  private stretchesByCoverage(text: string, face: LogFontFt | null, rToL: boolean): Stretch[] {
    const list: Stretch[] = [];
    if (rToL || face === null || text.length === 0) {
      list.push({ start: 0, length: text.length, needsFallback: true });
      return list;
    }
    let current = false;
    let started = false;
    let start = 0;
    let i = 0;
    while (i < text.length) {
      let len = 1;
      let cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (d - 0xdc00);
          len = 2;
        }
      }
      if (cp > 32 && cp !== 0xa0) {
        const missing = coverageOf(face, [cp]) === 0;
        if (!started) {
          current = missing;
          started = true;
        } else if (missing !== current) {
          list.push({ start, length: i - start, needsFallback: current });
          start = i;
          current = missing;
        }
      }
      i += len;
    }
    list.push({ start, length: text.length - start, needsFallback: current });
    return list;
  }

  private dataFor(font: PDFFont): { key: string; data: TTFontData } {
    const key = font.getFontFamilyKey() + String(font.style);
    let data = this.fontDataCache.get(key);
    if (data === undefined) {
      data = new TTFontData();
      this.fillFontData(font, data);
      this.fontDataCache.set(key, data);
    }
    return { key, data };
  }

  /** Measures a text (TextExtent): every text goes through the shaped layout. */
  textExtent(
    text: string,
    rect: { left: number; top: number; width: number; height: number },
    pdfFont: PDFFont,
    data: TTFontData | null,
    wordwrap: boolean,
    singleline: boolean,
    fontSize: number,
    isHtml: boolean,
    rightToLeft: boolean,
  ): LineInfo[] {
    const r = this.textExtentHtml(text, rect.width, data, pdfFont, wordwrap, singleline, fontSize, isHtml, rightToLeft);
    rect.width = r.width;
    rect.height = r.height;
    return r.lines;
  }

  /**
   * The shaped layout of a text (TextExtentHtml): paragraphs, bidi runs, HTML segments, fallback by
   * coverage, line breaking, visual order and the metrics of each line.
   */
  textExtentHtml(
    text: string,
    rectWidth: number,
    adataIn: TTFontData | null,
    pdfFont: PDFFont,
    wordwrap: boolean,
    _singleline: boolean,
    fontSize: number,
    isHtml: boolean,
    rightToLeft: boolean,
  ): ProviderTextExtent {
    if (adataIn === null) throw new TypeError('Object reference not set to an instance of an object.');
    const adata = adataIn;
    const result: LineInfo[] = [];
    this.selectFont(pdfFont);
    const originalFont = this.currentfont;
    let rectTop = 0;
    const segments: HtmlFormatRun[] = isHtml ? HtmlTextParser.parse(text, pdfFont.wFontName ?? '') : [plainRun(text)];
    let plainText = '';
    for (const seg of segments) plainText += seg.text;
    const lineSubTexts = dividesIntoLines(plainText);
    let maxWidth = 0;
    const lineWidthLimit = rectWidth;
    const tempFont = new PDFFont();
    tempFont.unixFamilyNames = pdfFont.unixFamilyNames;
    tempFont.name = pdfFont.name;
    tempFont.size = pdfFont.size;
    tempFont.color = pdfFont.color;
    tempFont.wFontName = pdfFont.wFontName;
    tempFont.lFontName = pdfFont.lFontName;
    const usedData: { key: string; data: TTFontData }[] = [];
    const bidi = new BidiParagraph();
    for (const lineSubText of lineSubTexts) {
      const line = plainText.substring(lineSubText.position, lineSubText.position + lineSubText.length);
      const possibleBreaksCharIdx = fillPossibleLineBreaksString(line);
      const calculatedLines: LineGlyphs[] = [];
      bidi.setPara(line, rightToLeft ? UBIDI_DEFAULT_RTL : UBIDI_DEFAULT_LTR);
      const remaining = { value: lineWidthLimit };
      const textOffset = lineSubText.position;
      let currentChunk = new LineGlyphs(textOffset);
      // The logical runs of one level
      const logicalRuns: { start: number; length: number; rtl: boolean }[] = [];
      let startLog = 0;
      while (startLog < line.length) {
        const lvl = bidi.getLevelAt(startLog);
        let rLen = 1;
        while (startLog + rLen < line.length && bidi.getLevelAt(startLog + rLen) === lvl) rLen++;
        logicalRuns.push({ start: startLog, length: rLen, rtl: lvl % 2 === 1 });
        startLog += rLen;
      }
      for (const logicalRun of logicalRuns) {
        const runAbsStart = lineSubText.position + logicalRun.start;
        const runLen = logicalRun.length;
        let segStartAbs = 0;
        for (const seg of segments) {
          const segLen = seg.text.length;
          const segEndAbs = segStartAbs + segLen;
          const intStart = Math.max(runAbsStart, segStartAbs);
          const intEnd = Math.min(runAbsStart + runLen, segEndAbs);
          if (intStart < intEnd) {
            tempFont.bold = pdfFont.bold || seg.bold;
            tempFont.italic = pdfFont.italic || seg.italic;
            tempFont.wFontName = seg.fontFamily !== null && seg.fontFamily !== '' ? seg.fontFamily : pdfFont.wFontName;
            tempFont.lFontName = seg.fontFamily !== null && seg.fontFamily !== '' ? seg.fontFamily : pdfFont.lFontName;
            const activeSize = seg.hasFontSize ? seg.fontSize : fontSize;
            tempFont.style = 0;
            if (tempFont.bold) tempFont.style |= 1;
            if (tempFont.italic) tempFont.style |= 2;
            const temp = this.dataFor(tempFont);
            const tempAdata = temp.data;
            if (!usedData.some((u) => u.key === temp.key)) usedData.push(temp);
            this.selectFont(tempFont);
            const runFont = this.currentfont;
            const rToL = logicalRun.rtl;
            const chunkText = plainText.substring(intStart, intEnd);
            const scriptStr = detectScript(chunkText);
            let positions = this.calcGlyphPositions(chunkText, rToL, scriptStr, activeSize, tempAdata, tempFont);
            const hasMissingGlyphs = positions.some((p) => p.glyphIndex === 0);
            const positionsFamily = tempFont.wFontName;
            if (hasMissingGlyphs) {
              const fallbackFor = (part: string): { font: PDFFont; data: TTFontData; family: string } | null => {
                const fallbackFont = new PDFFont();
                fallbackFont.unixFamilyNames = pdfFont.unixFamilyNames;
                fallbackFont.name = pdfFont.name;
                fallbackFont.size = roundNet(activeSize);
                fallbackFont.color = pdfFont.color;
                fallbackFont.bold = tempFont.bold;
                fallbackFont.italic = tempFont.italic;
                fallbackFont.style = tempFont.style;
                fallbackFont.wFontName = tempFont.wFontName;
                fallbackFont.lFontName = tempFont.lFontName;
                this.selectFont(fallbackFont, part);
                const found = this.currentfont;
                if (found === null || found.familyname === '') return null;
                if (runFont !== null && found.filename === runFont.filename && found.faceIndex === runFont.faceIndex) return null;
                const byName = new PDFFont();
                byName.unixFamilyNames = pdfFont.unixFamilyNames;
                byName.name = fallbackFont.name;
                byName.size = fallbackFont.size;
                byName.color = fallbackFont.color;
                byName.bold = fallbackFont.bold;
                byName.italic = fallbackFont.italic;
                byName.style = fallbackFont.style;
                byName.wFontName = found.familyname;
                byName.lFontName = found.familyname;
                this.selectFont(byName);
                const back = this.currentfont as LogFontFt | null;
                if (back === null || back.filename !== found.filename || back.faceIndex !== found.faceIndex) return null;
                const fb = this.dataFor(byName);
                return { font: byName, data: fb.data, family: found.familyname };
              };
              const accumulated: TGlyphPos[] = [];
              for (const stretch of this.stretchesByCoverage(chunkText, runFont, rToL)) {
                if (stretch.length <= 0) continue;
                const part = chunkText.substring(stretch.start, stretch.start + stretch.length);
                const fallback = stretch.needsFallback ? fallbackFor(part) : null;
                let pos: TGlyphPos[];
                let family: string | null;
                if (fallback !== null) {
                  pos = this.calcGlyphPositions(part, rToL, detectScript(part), activeSize, fallback.data, fallback.font);
                  family = fallback.family;
                } else {
                  pos = this.calcGlyphPositions(part, rToL, detectScript(part), activeSize, tempAdata, tempFont);
                  family = tempFont.wFontName;
                }
                for (const p of pos) {
                  p.cluster += stretch.start;
                  p.fontFamily = family;
                  p.faceKey = fallback !== null ? fallback.data.faceKey : tempAdata.faceKey;
                }
                accumulated.push(...pos);
              }
              if (accumulated.length > 0) positions = accumulated;
            }
            let runWidth = 0;
            for (const p of positions) {
              runWidth += p.xAdvance;
              p.lineCluster = p.cluster + (intStart - lineSubText.position);
              p.bold = tempFont.bold;
              p.italic = tempFont.italic;
              p.underline = seg.underline;
              p.strikeOut = seg.strikeOut;
              if (p.fontFamily === null || p.fontFamily === '') p.fontFamily = positionsFamily;
              if (p.faceKey === null || p.faceKey === '') p.faceKey = tempAdata.faceKey;
              p.fontSize = Math.fround(activeSize);
              p.hasFontSize = seg.hasFontSize;
              p.color = seg.color;
              p.hasColor = seg.hasColor;
            }
            if (runWidth <= remaining.value || !wordwrap) {
              for (const g of positions) currentChunk.addGlyph(g, logicalRun.start);
              remaining.value -= runWidth;
            } else {
              const lineHasContent = currentChunk.glyphs.length > 0;
              const chunksList = rToL
                ? breakChunksRTL([...positions], remaining, lineWidthLimit, possibleBreaksCharIdx, line, lineHasContent)
                : breakChunksLTR([...positions], remaining, lineWidthLimit, possibleBreaksCharIdx, line, lineHasContent);
              for (let j = 0; j < chunksList.length; j++) {
                const chunk = chunksList[j] as TGlyphPos[];
                if (j === 0) {
                  for (const g of chunk) currentChunk.addGlyph(g, logicalRun.start);
                  calculatedLines.push(currentChunk);
                  currentChunk = new LineGlyphs(textOffset);
                  remaining.value = lineWidthLimit;
                } else if (j === chunksList.length - 1) {
                  remaining.value = lineWidthLimit;
                  for (const g of chunk) {
                    currentChunk.addGlyph(g, logicalRun.start);
                    remaining.value -= g.xAdvance;
                  }
                } else {
                  for (const g of chunk) currentChunk.addGlyph(g, logicalRun.start);
                  remaining.value = lineWidthLimit;
                  calculatedLines.push(currentChunk);
                  currentChunk = new LineGlyphs(textOffset);
                }
              }
            }
          }
          segStartAbs = segEndAbs;
        }
      }
      // An empty paragraph is a line too
      if (currentChunk.glyphs.length > 0 || calculatedLines.length === 0) calculatedLines.push(currentChunk);
      for (let lineIdx = 0; lineIdx < calculatedLines.length; lineIdx++) {
        const calculatedLine = calculatedLines[lineIdx] as LineGlyphs;
        let minCluster = calculatedLine.minClusterText;
        let maxCluster = calculatedLine.maxClusterText;
        let visualGlyphs: TGlyphPos[] = [];
        const vCount = bidi.countRuns();
        for (let i = 0; i < vCount; i++) {
          const run = bidi.getVisualRun(i);
          const vStart = run.logicalStart;
          const vLength = run.length;
          if (run.rtl) {
            for (let k = vStart + vLength - 1; k >= vStart; k--) {
              const lst = calculatedLine.clusterMap.get(k);
              if (lst !== undefined) for (const idx of lst) visualGlyphs.push({ ...(calculatedLine.glyphs[idx] as TGlyphPos) });
            }
          } else {
            for (let k = vStart; k < vStart + vLength; k++) {
              const lst = calculatedLine.clusterMap.get(k);
              if (lst !== undefined) for (const idx of lst) visualGlyphs.push({ ...(calculatedLine.glyphs[idx] as TGlyphPos) });
            }
          }
        }
        // Whitespace at the edges of the line (AdjustLineSpaces of DirectWrite / GDI)
        const isParaRTL = bidi.getParaLevel() % 2 === 1;
        const isTrailingWs = (c: number): boolean => c === 0x20 || c === 9 || c === 10 || c === 13;
        const isLeadingWs = (c: number): boolean => c === 0x20 || c === 9;
        if (!isParaRTL) {
          while (visualGlyphs.length > 0 && isTrailingWs((visualGlyphs[visualGlyphs.length - 1] as TGlyphPos).charCode)) visualGlyphs.pop();
          if (lineIdx > 0) while (visualGlyphs.length > 0 && isLeadingWs((visualGlyphs[0] as TGlyphPos).charCode)) visualGlyphs.shift();
        } else {
          while (visualGlyphs.length > 0 && isTrailingWs((visualGlyphs[0] as TGlyphPos).charCode)) visualGlyphs.shift();
          if (lineIdx > 0)
            while (visualGlyphs.length > 0 && isLeadingWs((visualGlyphs[visualGlyphs.length - 1] as TGlyphPos).charCode)) visualGlyphs.pop();
        }
        const lineInfo: LineInfo = {
          position: 0,
          size: 0,
          width: 0,
          height: 0,
          topPos: 0,
          step: PrintStepType.BySize,
          lastLine: false,
          lineHeight: 0,
          glyphs: null,
          text: null,
        };
        if (visualGlyphs.length > 0) {
          minCluster = Number.MAX_SAFE_INTEGER;
          maxCluster = Number.MIN_SAFE_INTEGER;
          for (const g of visualGlyphs) {
            if (g.lineCluster < minCluster) minCluster = g.lineCluster;
            if (g.lineCluster > maxCluster) maxCluster = g.lineCluster;
          }
          let lineEnd = maxCluster + 1;
          let next = line.length;
          const nextLine = calculatedLines[lineIdx + 1];
          if (nextLine !== undefined && nextLine.glyphs.length > 0) next = Math.min(next, nextLine.minClusterText);
          while (lineEnd < next && !isWhiteSpaceNet(line.charCodeAt(lineEnd))) lineEnd++;
          lineEnd = Math.min(lineEnd, line.length);
          lineInfo.position = lineSubText.position + minCluster;
          lineInfo.size = Math.max(0, lineEnd - minCluster);
          if (minCluster < 0 || minCluster + lineInfo.size > line.length)
            throw new RangeError('Index and length must refer to a location within the string.');
          lineInfo.text = line.substring(minCluster, minCluster + lineInfo.size);
          for (const g of visualGlyphs) g.lineCluster -= minCluster;
        } else {
          lineInfo.position = lineSubText.position;
          lineInfo.size = 0;
          lineInfo.text = '';
        }
        lineInfo.glyphs = visualGlyphs;
        let lw = 0;
        for (const g of visualGlyphs) lw += g.xAdvance;
        lineInfo.width = roundNet(lw);
        let maxLineHeight = (adata.height / 1000.0) * fontSize * 20.0;
        let maxBaselineTwips = ((adata.ascent + Math.max(0, adata.leading)) / 1000.0) * fontSize * 20.0;
        for (const g of visualGlyphs) {
          const gFontSize = g.hasFontSize ? g.fontSize : fontSize;
          const gFontFamily = g.fontFamily ?? (pdfFont.wFontName as string);
          let gFontData: TTFontData | null = null;
          const upperFamily = toUpperNet(gFontFamily);
          for (const kvp of usedData) {
            if (toUpperNet(kvp.key).includes(upperFamily)) {
              gFontData = kvp.data;
              break;
            }
          }
          const src = gFontData ?? adata;
          const gHeightTwips = (src.height / 1000.0) * gFontSize * 20.0;
          const gBaselineTwips = ((src.ascent + Math.max(0, src.leading)) / 1000.0) * gFontSize * 20.0;
          if (gBaselineTwips > maxBaselineTwips) maxBaselineTwips = gBaselineTwips;
          if (gHeightTwips > maxLineHeight) maxLineHeight = gHeightTwips;
        }
        const currentLineSpacing = roundNet(maxLineHeight);
        const lineBaseline = roundNet(maxBaselineTwips);
        lineInfo.topPos = roundNet(rectTop) + lineBaseline;
        lineInfo.height = currentLineSpacing;
        lineInfo.lineHeight = currentLineSpacing;
        lineInfo.lastLine = false;
        result.push(lineInfo);
        if (lw > maxWidth) maxWidth = lw;
        rectTop += currentLineSpacing;
      }
    }
    if (result.length > 0) (result[result.length - 1] as LineInfo).lastLine = true;
    this.currentfont = originalFont;
    return { lines: result, width: roundNet(maxWidth), height: roundNet(rectTop) };
  }
}

function plainRun(text: string): HtmlFormatRun {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    fontFamily: null,
    fontSize: 0,
    hasFontSize: false,
    color: 0,
    hasColor: false,
  };
}

/** The OS/2 code pages of a face, for diagnostics. */
export function faceCodePages(f: LogFontFt): number {
  return readCodePages(f.file.reader, f.faceIndex);
}

export type { FvarInfo };
