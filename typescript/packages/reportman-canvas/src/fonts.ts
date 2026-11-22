// The fonts of the preview: the browser families that stand for the standard 14 PDF fonts, the
// Windows-1252 bytes of their texts back to characters, and the outlines of the TrueType glyphs
// the PDF embeds.

import { PDFFontType } from '@reportman/metafile';
import type { LogFontFt } from '@reportman/text';
import { DINGBATS_CHARS, DINGBATS_WIDTHS, SYMBOL_CHARS, SYMBOL_WIDTHS } from './symboltables.js';

/** The CSS font families that draw the standard fonts. */
export interface StandardFamilies {
  /** Helvetica; Arial has its widths. */
  helvetica: string;
  /** Times; Times New Roman has its widths. */
  times: string;
  /** Courier; every character 600 thousandths of the em. */
  courier: string;
  /**
   * The characters of Symbol (Greek letters and mathematical signs): no browser has the font, so its
   * bytes are drawn as the characters they stand for, each one where the widths of Symbol put it.
   */
  symbol: string;
  /** The characters of ZapfDingbats (the dingbats of Unicode), drawn as those of Symbol. */
  dingbats: string;
}

/** The families of a PDF viewer without the fonts: the metric compatible ones of each system. */
export const DEFAULT_FAMILIES: StandardFamilies = {
  helvetica: 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans", sans-serif',
  times: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
  courier: '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", monospace',
  symbol: '"Segoe UI Symbol", "Noto Sans Symbols", "Noto Sans Math", "DejaVu Sans", Symbola, "Times New Roman", serif',
  dingbats: '"Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Symbols", "DejaVu Sans", Symbola, "Zapf Dingbats", sans-serif',
};

/** The family of a standard font. */
export function standardFamily(families: StandardFamilies, font: PDFFontType): string | null {
  switch (font) {
    case PDFFontType.Helvetica:
      return families.helvetica;
    case PDFFontType.TimesRoman:
      return families.times;
    case PDFFontType.Courier:
      return families.courier;
    case PDFFontType.Symbol:
      return families.symbol;
    case PDFFontType.ZafDingbats:
      return families.dingbats;
    default:
      return null;
  }
}

/**
 * The character a viewer draws for a byte of a standard font: WinAnsi for Helvetica, Times and
 * Courier; the built-in encodings for Symbol and ZapfDingbats.
 */
export function standardChar(font: PDFFontType, byte: number): string {
  if (font === PDFFontType.Symbol) return SYMBOL_CHARS[byte & 0xff] ?? '';
  if (font === PDFFontType.ZafDingbats) return DINGBATS_CHARS[byte & 0xff] ?? '';
  return winAnsiChar(byte);
}

/**
 * The width, in thousandths of the em, a viewer advances by after a byte of Symbol or ZapfDingbats
 * (their AFM files); null for the other fonts, whose widths are those the layout measured. The
 * layout measures Symbol and ZapfDingbats with 600, as the engine of C# does, and their PDF draws
 * them with these widths: the preview places them where the viewer does.
 */
export function standardWidth(font: PDFFontType, byte: number): number | null {
  if (font === PDFFontType.Symbol) return SYMBOL_WIDTHS[byte & 0xff] ?? 0;
  if (font === PDFFontType.ZafDingbats) return DINGBATS_WIDTHS[byte & 0xff] ?? 0;
  return null;
}

// The characters of the bytes 0x80 to 0x9F in WinAnsiEncoding, the encoding the PDF gives the
// standard fonts; the five bytes it leaves undefined draw nothing.
const WIN_ANSI_80: readonly string[] = [
  '€', '', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '',
  '', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ',
];

/**
 * The character a viewer draws for a byte of a standard font: the control codes draw nothing (the
 * .notdef of the font), 0x80 to 0x9F their WinAnsi characters, the rest Latin-1.
 */
export function winAnsiChar(byte: number): string {
  if (byte < 0x20) return '';
  if (byte >= 0x80 && byte < 0xa0) return WIN_ANSI_80[byte - 0x80] as string;
  return String.fromCharCode(byte);
}

/** A command of a fontkit path, in font units, y up. */
export interface OutlineCommand {
  command: string;
  args: number[];
}

/** An outline of a glyph and the units per em it is drawn with. */
export interface GlyphOutline {
  commands: readonly OutlineCommand[];
  unitsPerEm: number;
}

/** What the preview reads of a fontkit font (its glyphs are those of the PDF subset). */
interface OutlineFont {
  readonly unitsPerEm: number;
  readonly directory: { tables: Record<string, unknown> };
  getGlyph(id: number): { path: { commands: OutlineCommand[] } } | null;
  _getBaseGlyph?(id: number): { path: { commands: OutlineCommand[] } } | null;
  _glyphs?: Record<number, unknown>;
}

/**
 * The outline glyph of a font. A color font (COLR, sbix) gives fontkit color glyphs without an
 * outline; the PDF embeds the outlines of its glyf table, so they are read the way fontkit reads a
 * plain font, keeping its cache as it was (the shaper put the color glyph there).
 */
function outlineGlyph(font: OutlineFont, id: number): { path: { commands: OutlineCommand[] } } | null {
  const t = font.directory.tables;
  if (!((t['COLR'] !== undefined && t['CPAL'] !== undefined) || t['sbix'] !== undefined) || font._getBaseGlyph === undefined || font._glyphs === undefined)
    return font.getGlyph(id);
  const cache = font._glyphs;
  const saved = cache[id];
  delete cache[id];
  try {
    return font._getBaseGlyph(id);
  } finally {
    if (saved !== undefined) cache[id] = saved;
    else delete cache[id];
  }
}

/** The outlines of the glyphs drawn so far, by face and glyph. */
export class OutlineCache {
  private readonly faces = new Map<string, Map<number, GlyphOutline | null>>();

  /** The outline of a glyph of a face of the font library; null when it has none (a Type 1 face). */
  outline(face: LogFontFt, glyph: number): GlyphOutline | null {
    const key = face.filename + '|' + String(face.faceIndex);
    let glyphs = this.faces.get(key);
    if (glyphs === undefined) {
      glyphs = new Map();
      this.faces.set(key, glyphs);
    }
    let outline = glyphs.get(glyph);
    if (outline === undefined) {
      outline = null;
      // fontkit reads TrueType and CFF outlines, not Type 1 ones
      if (!face.type1) {
        const font = face.file.fontkit(face.faceIndex) as unknown as OutlineFont;
        const g = outlineGlyph(font, glyph);
        if (g !== null) outline = { commands: g.path.commands, unitsPerEm: font.unitsPerEm };
      }
      glyphs.set(glyph, outline);
    }
    return outline;
  }
}
