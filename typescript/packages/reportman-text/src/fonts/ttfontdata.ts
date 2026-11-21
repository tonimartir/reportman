// The font data of the PDF writer and of the shaper (FontInfoProvider.cs): the metrics of a face,
// its widths and glyphs as they are used, and the positioned glyphs of a shaped text.

import type { PDFFont } from '../pdffont.js';

/** The width and glyph of a character (GlyphInfo). */
export interface GlyphInfo {
  /** Advance width in thousandths of the em. */
  width: number;
  /** Glyph index. */
  glyph: number;
  /** The character (C# parity: never assigned, always 0). */
  char: number;
}

/** A positioned glyph of a shaped text (TGlyphPos), in twips. */
export interface TGlyphPos {
  glyphIndex: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  yAdvance: number;
  /** The UTF-16 code unit at the cluster of the glyph. */
  charCode: number;
  /** The cluster: the index in the shaped text where the glyph's text starts. */
  cluster: number;
  /** The cluster as an index in the text of the line. */
  lineCluster: number;
  fontFamily: string | null;
  /** The face the glyph was shaped with: "file|faceIndex". */
  faceKey: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  /** Font size in points (a float in C#). */
  fontSize: number;
  hasFontSize: boolean;
  color: number;
  hasColor: boolean;
}

/** A new TGlyphPos (the default of the C# struct). */
export function newGlyphPos(): TGlyphPos {
  return {
    glyphIndex: 0,
    xOffset: 0,
    yOffset: 0,
    xAdvance: 0,
    yAdvance: 0,
    charCode: 0,
    cluster: 0,
    lineCluster: 0,
    fontFamily: null,
    faceKey: null,
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    fontSize: 0,
    hasFontSize: false,
    color: 0,
    hasColor: false,
  };
}

/** A map sorted by its keys as numbers (the SortedList of C# with char or int keys). */
export class SortedNumberMap<V> {
  private readonly map = new Map<number, V>();
  private sorted: number[] | null = [];

  get size(): number {
    return this.map.size;
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  get(key: number): V | undefined {
    return this.map.get(key);
  }

  /** Sets a value (the indexer of SortedList). */
  set(key: number, value: V): void {
    if (!this.map.has(key)) this.sorted = null;
    this.map.set(key, value);
  }

  /** Adds a value; fails when the key is there (SortedList.Add). */
  add(key: number, value: V): void {
    if (this.map.has(key)) throw new Error('An item with the same key has already been added. Key: ' + String(key));
    this.set(key, value);
  }

  /** The keys in ascending order. */
  keys(): number[] {
    if (this.sorted === null) this.sorted = [...this.map.keys()].sort((a, b) => a - b);
    return this.sorted;
  }

  /** The entries in ascending key order. */
  entries(): [number, V][] {
    return this.keys().map((k) => [k, this.map.get(k) as V]);
  }

  /** The values in ascending key order. */
  values(): V[] {
    return this.keys().map((k) => this.map.get(k) as V);
  }

  clear(): void {
    this.map.clear();
    this.sorted = [];
  }
}

/**
 * The metrics, widths and glyphs of a font as the PDF writer uses it (TTFontData): filled by the
 * provider (FillFontData), extended as characters and glyphs are drawn, written as a font of the
 * PDF at the end.
 */
export class TTFontData {
  /** The face (a LogFontFt of the FreeType provider). */
  logFont: unknown = null;
  embedded = false;
  /** Set by getFontStream: the font program holds only the glyphs used. */
  fontProgramIsSubset = false;
  /** The subset tag ("ABCDEF+") before the name of a subset. */
  subsetTag = '';
  /** The bytes of the font file. */
  fontData: Uint8Array | null = null;
  postcriptName = '';
  encoding = '';
  /** The face these metrics came from: "file|faceIndex". */
  faceKey: string | null = null;
  ascent = 0;
  descent = 0;
  leading = 0;
  capHeight = 0;
  flags = 32;
  fontWeight = 0;
  height = 0;
  lineSpacing = 0;
  emHeight = 0;
  maxWidth = 0;
  avgWidth = 0;
  stemV = 0;
  fontFamily = '';
  fontStretch = '';
  italicAngle = 0;
  /** FontBBox (left, top, width, height of a C# Rectangle). */
  fontBBox = { left: 0, top: 0, width: 0, height: 0 };
  faceName = '';
  styleName = '';
  type1 = false;
  haveKerning = false;
  /** The resource name of the font in the PDF (/F + it). */
  objectName = '';
  objectIndex = 0;
  objectIndexParent = 0;
  descriptorIndex = 0;
  toUnicodeIndex = 0;
  /** Units per em; 1024 until a width of a character is read (C# parity). */
  unitsPerEM = 1024;
  firstLoaded = 65536;
  lastLoaded = -1;
  isUnicode = false;
  /** The glyph of each character (code unit) drawn. */
  readonly glyphs = new SortedNumberMap<number>();
  /** The old glyph number to the new one of a compact subset; null means identity. */
  glyphMap: SortedNumberMap<number> | null = null;
  /** The text a glyph came from, for the glyphs no character points at. */
  readonly glyphText = new Map<number, string>();
  /** The first text each glyph was drawn for (it keeps its glyph number as its code). */
  readonly cidClaim = new Map<number, string>();
  /** The code of its own of each "glyph|text" that is not the first text of its glyph. */
  readonly cidExtra = new Map<string, number>();
  readonly cidExtraGlyph: number[] = [];
  readonly cidExtraText: string[] = [];
  /** The number of glyphs of the font, -1 until read; 0 when it cannot be. */
  glyphCount = -1;
  /** The font program is an OpenType font with CFF outlines declared as such (CIDFontType0). */
  cffOpenType = false;
  /** The subset of a CID-keyed CFF whose CIDs are its glyph numbers, renumbered keeping its CIDs. */
  cffKeepsCIDs = false;
  /**
   * The font program is a bare CID-keyed CFF (a fontkit CFF subset whose charset keeps the glyph
   * numbers as CIDs): embedded as /FontFile3 /CIDFontType0C.
   */
  cffProgram = false;
  /** The width of each character (code unit) drawn, thousandths of the em. */
  readonly widths = new SortedNumberMap<number>();
  /** Kerning pairs (unused by the shaped output). */
  readonly kernings = new Map<string, number>();
  /** The glyph and width of each character drawn (and of the private use stand-ins of shaped glyphs). */
  cacheWidths = new SortedNumberMap<GlyphInfo>();
  isBold = false;
  isItalic = false;
  /** The shaped glyphs no character points at, by glyph. */
  readonly glyphsInfo = new SortedNumberMap<GlyphInfo>();
}

/**
 * A font provider (FontInfoProvider): the metrics, widths, glyphs, layout and embeddable program
 * of the fonts of a canvas.
 */
export interface FontInfoProvider {
  /** The name of the provider class (the C# engine tests for "FontInfoFt"). */
  readonly providerName: string;
  /** The family names are the Linux ones (LFontName), as on Unix and macOS. */
  readonly unixFamilyNames: boolean;
  fillFontData(pdfFont: PDFFont, data: TTFontData): void;
  getCharWidth(pdfFont: PDFFont, data: TTFontData, charCode: number): number;
  getGlyphWidth(pdfFont: PDFFont, data: TTFontData, glyph: number, charCode: number, faceKey: string | null): number;
  fillFontDataForFace(pdfFont: PDFFont, data: TTFontData, faceKey: string): boolean;
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
  ): import('reportman-metafile').LineInfo[];
  getKerning(pdfFont: PDFFont, data: TTFontData, leftChar: number, rightChar: number): number;
  getFontStream(data: TTFontData): Uint8Array;
}
