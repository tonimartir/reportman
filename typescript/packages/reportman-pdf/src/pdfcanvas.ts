import { AlignmentFlags, ByteBuffer, PDFConformanceType, PDFFontType, convertToInt32, intDiv, roundHalfEven, toInt32 } from '@reportman/metafile';
import type { LineInfo, Rectangle } from '@reportman/metafile';
import { getBitmapInfo, getJpegInfo } from './bitmaputil.js';
import { decodeImageForPdf } from './imagecodec.js';
import {
  CONS_PDFRES,
  ShaperNotSupportedError,
  TextCanvas,
  sfntGlyphCount,
  type1FontToPdfFontName,
  unicodeToWin1252,
} from '@reportman/text';
import type { FontInfoProvider, TGlyphPos, TTFontData } from '@reportman/text';
import { formatFixed2, intToHex } from './netformat.js';
import { encodePDFText } from './pdfstrings.js';
import type { PDFFile } from './pdffile.js';

/** Underline position factor, relative to the font size (PDFFile.CONS_UNDERLINEPOS). */
export const CONS_UNDERLINEPOS = 1.1;
/** Strikeout position factor (PDFFile.CONS_STRIKEOUTPOS). */
export const CONS_STRIKEOUTPOS = 0.7;
/** Underline and strikeout width factor (PDFFile.CONS_UNDERLINEWIDTH). */
export const CONS_UNDERLINEWIDTH = 0.1;

/** An int negation of C# (no negative zero). */
function neg(x: number): number {
  return -x | 0;
}

/** List.BinarySearch of C#: the index of a value in a sorted list, or a negative number. */
function binarySearch(list: readonly number[], value: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid] as number;
    if (v === value) return mid;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return ~lo;
}

/**
 * The PDF drawing surface (PDFCanvas): it writes the operators of the content stream of the
 * current page of its PDFFile, in twips converted to points. Text is measured and broken in lines
 * by the TextCanvas it extends: with the standard 14 fonts, or shaped with a font provider (the
 * TrueType fonts of the FreeType driver, written glyph by glyph).
 */
export class PDFCanvas extends TextCanvas {
  /** The PDF document the canvas writes to. */
  file!: PDFFile;
  /** Pen color ($00BBGGRR). */
  penColor = 0;
  /** Pen dash style: 0 solid, 1 dash, 2 dot, 3 dash dot, 4 dash dot dot, 5 clear. */
  penStyle = 0;
  /** Pen width in twips. */
  penWidth = 0;
  brushColor = 0;
  /** Brush style: 1 clear, anything else fills. */
  brushStyle = 0;
  /** Last brush color written (to skip repeated operators when the file is Optimized). */
  oldBrushColor = -1;
  /** Last pen color written. */
  oldPenColor = -1;
  savedPenColor = 0;
  savedBrushColor = 0;
  private translatedy = false;

  constructor(infoProvider: FontInfoProvider | null = null) {
    super(infoProvider);
  }

  /** A text as a PDF string (PDFFile.EncodePDFText). */
  static encodePDFText(text: string | null | undefined): string {
    return encodePDFText(text);
  }

  /** The end of line of the conformance level. */
  eol(): string {
    return this.pdfConformance === PDFConformanceType.PDF_1_4 ? '\n\r' : '\n';
  }

  private swl(value: string): void {
    this.file.sWriteLine(this.file.sTempStream, value);
  }

  /** A horizontal coordinate in points (UnitsToTextX). */
  unitsToTextX(value: number): string {
    const nvalue = (value / this.fResolution) * CONS_PDFRES;
    return formatFixed2(nvalue);
  }

  /** A vertical coordinate in points, from the bottom of the page (UnitsToTextY). */
  unitsToTextY(value: number): string {
    let nvalue: number;
    if (this.translatedy) nvalue = (-value / this.fResolution) * CONS_PDFRES;
    else nvalue = ((this.file.pageHeight - value) / this.fResolution) * CONS_PDFRES;
    return formatFixed2(nvalue);
  }

  private unitsToTextText(value: number, fsize: number): string {
    let nvalue: number;
    if (this.translatedy) nvalue = (neg(value) / this.fResolution) * CONS_PDFRES - fsize;
    else nvalue = (((this.file.pageHeight - value) | 0) / this.fResolution) * CONS_PDFRES - fsize;
    return formatFixed2(nvalue);
  }

  /** A number with two decimals and a dot (NumberToText). */
  static numberToText(value: number): string {
    return formatFixed2(value);
  }

  private rgbToFloats(acolor: number): string {
    const r = acolor & 0xff;
    const g = (acolor >> 8) & 0xff;
    const b = (acolor >> 16) & 0xff;
    return formatFixed2(r / 256) + ' ' + formatFixed2(g / 256) + ' ' + formatFixed2(b / 256);
  }

  private setDash(): void {
    switch (this.penStyle) {
      case 1: // Dash
        this.swl('[16 8] 0 d');
        break;
      case 2: // Dot
        this.swl('[1] 0 d');
        break;
      case 3: // Dash dot
        this.swl('[8 7 2 7] 0 d');
        break;
      case 4: // Dash dot dot
        this.swl('[8 4 2 4 2 4] 0 d');
        break;
      case 5: // Clear
        break;
      default:
        this.swl('[] 0 d');
        break;
    }
  }

  /** A line with the current pen (Line). */
  line(x1: number, y1: number, x2: number, y2: number): void {
    if (this.penStyle === 5) return;
    this.setDash();
    let lineWidth = 1;
    if (this.penWidth > 0) lineWidth = this.penWidth;
    this.swl(this.unitsToTextX(lineWidth) + ' w');
    this.writePenColor(this.penColor);
    this.writeBrushColor(this.penColor);
    this.swl(this.unitsToTextX(x1) + ' ' + this.unitsToTextY(y1) + ' m');
    this.swl(this.unitsToTextX(x2) + ' ' + this.unitsToTextY(y2) + ' l');
    this.swl('S');
  }

  /** The stroke color operator, skipped when the file is Optimized and the color did not change. */
  writePenColor(newColor: number): void {
    let dowrite = true;
    if (this.file.optimized) dowrite = this.oldPenColor !== newColor;
    if (dowrite) {
      this.swl(this.rgbToFloats(newColor) + ' RG');
      this.oldPenColor = newColor;
    }
  }

  /** The fill color operator, skipped when the file is Optimized and the color did not change. */
  writeBrushColor(newColor: number): void {
    let dowrite = true;
    if (this.file.optimized) dowrite = this.oldBrushColor !== newColor;
    if (dowrite) {
      this.swl(this.rgbToFloats(newColor) + ' rg');
      this.oldBrushColor = newColor;
    }
  }

  private fillOperator(): void {
    let opfill = 'B';
    if (this.penStyle === 5) opfill = 'f';
    // Clear brush
    if (this.brushStyle === 1) this.swl('S');
    else this.swl(opfill);
  }

  /** An ellipse inscribed in a box, four Bezier curves (Ellipse). */
  ellipse(x1: number, y1: number, x2: number, y2: number): void {
    // Clear pen and clear brush: nothing to paint
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.setDash();
    const W = x2 - x1;
    const H = y2 - y1;
    let lineWidth = 1;
    if (this.penWidth > 0) lineWidth = this.penWidth;
    this.swl(this.unitsToTextX(lineWidth) + ' w');
    this.writePenColor(this.penColor);
    this.writeBrushColor(this.brushColor);
    const h2 = toInt32(H / 2);
    const w2 = toInt32(W / 2);
    const hk = toInt32(roundHalfEven(((H / 2) * 11) / 20));
    const wk = toInt32(roundHalfEven(((W / 2) * 11) / 20));
    const X = (v: number): string => this.unitsToTextX(v | 0);
    const Y = (v: number): string => this.unitsToTextY(v | 0);
    // Draws an ellipse in 4 passes
    this.swl(X(x1) + ' ' + Y(y1 + h2) + ' m');
    this.swl(X(x1) + ' ' + Y(y1 + h2 - hk) + ' ' + X(x1 + w2 - wk) + ' ' + Y(y1) + ' ' + X(x1 + w2) + ' ' + Y(y1) + ' c');
    this.swl(X(x1 + w2 + wk) + ' ' + Y(y1) + ' ' + X(x1 + W) + ' ' + Y(y1 + h2 - hk) + ' ' + X(x1 + W) + ' ' + Y(y1 + h2) + ' c');
    this.swl(X(x1 + W) + ' ' + Y(y1 + h2 + hk) + ' ' + X(x1 + w2 + wk) + ' ' + Y(y1 + H) + ' ' + X(x1 + w2) + ' ' + Y(y1 + H) + ' c');
    this.swl(X(x1 + w2 - wk) + ' ' + Y(y1 + H) + ' ' + X(x1) + ' ' + Y(y1 + h2 + hk) + ' ' + X(x1) + ' ' + Y(y1 + h2) + ' c');
    this.fillOperator();
  }

  /** A rectangle with rounded corners (RoundedRectangle). */
  roundedRectangle(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.setDash();
    let lineWidth = 1;
    if (this.penWidth > 0) lineWidth = this.penWidth;
    this.swl(this.unitsToTextX(lineWidth) + ' w');
    this.writePenColor(this.penColor);
    this.writeBrushColor(this.brushColor);
    const X = (v: number): string => this.unitsToTextX(v | 0);
    const Y = (v: number): string => this.unitsToTextY(v | 0);
    this.swl(X(x1) + ' ' + Y(y2 - radius) + ' m');
    this.swl(X(x1) + ' ' + Y(y1 + radius) + ' l');
    this.swl(X(x1) + ' ' + Y(y1) + ' ' + X(x1 + radius) + ' ' + Y(y1) + ' v');
    this.swl(X(x2 - radius) + ' ' + Y(y1) + ' l');
    this.swl(X(x2) + ' ' + Y(y1) + ' ' + X(x2) + ' ' + Y(y1 + radius) + ' v');
    this.swl(X(x2) + ' ' + Y(y2 - radius) + ' l');
    this.swl(X(x2) + ' ' + Y(y2) + ' ' + X(x2 - radius) + ' ' + Y(y2) + ' v');
    this.swl(X(x1 + radius) + ' ' + Y(y2) + ' l');
    this.swl(X(x1) + ' ' + Y(y2) + ' ' + X(x1) + ' ' + Y(y2 - radius) + ' v');
    this.fillOperator();
  }

  /** A rectangle (Rectangle). */
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.setDash();
    let lineWidth = 1;
    if (this.penWidth > 0) lineWidth = this.penWidth;
    this.swl(this.unitsToTextX(lineWidth) + ' w');
    this.writePenColor(this.penColor);
    this.writeBrushColor(this.brushColor);
    this.swl(
      this.unitsToTextX(x1) + ' ' + this.unitsToTextY(y1) + ' ' + this.unitsToTextX((x2 - x1) | 0) + ' ' +
        this.unitsToTextX(neg(y2 - y1)) + ' re',
    );
    this.fillOperator();
  }

  /** Saves the graphics state (q) and the pen and brush colors (SaveGraph). */
  saveGraph(): void {
    this.swl('q');
    this.savedPenColor = this.oldPenColor;
    this.savedBrushColor = this.oldBrushColor;
  }

  /** Restores the graphics state (Q) and the saved colors (RestoreGraph). */
  restoreGraph(): void {
    this.swl('Q');
    this.translatedy = false;
    this.oldPenColor = this.savedPenColor;
    this.oldBrushColor = this.savedBrushColor;
  }

  /** The characters of a string in reverse order (DoReverseString). */
  static doReverseString(astring: string): string {
    let result = '';
    for (let i = 0; i < astring.length; i++) result = astring.charAt(i) + result;
    return result;
  }

  /** The four digit hexadecimal code of a character (WideCharToHex). */
  static wideCharToHex(achar: string): string {
    return intToHex(achar.charCodeAt(0));
  }

  /** A number as four (or more) hexadecimal digits (IntToHex). */
  static intToHex(nvalue: number): string {
    return intToHex(nvalue);
  }

  /**
   * A text as a PDF string (PDFCompatibleText): with the font data of a Unicode (embedded) font,
   * the hexadecimal glyph numbers of its characters; otherwise a literal string, ( ) and \ escaped,
   * € (U+20AC) as the WinAnsi 0x80.
   */
  static pdfCompatibleText(astring: string, adata: TTFontData | null = null): string {
    const isunicode = adata !== null && adata.isUnicode;
    if (isunicode) {
      let hex = '<';
      for (let i = 0; i < astring.length; i++) {
        const info = adata.cacheWidths.get(astring.charCodeAt(i));
        if (info !== undefined) hex += intToHex(info.glyph);
      }
      return hex + '>';
    }
    let result = '(';
    for (let i = 0; i < astring.length; i++) {
      const c = astring.charAt(i);
      switch (c) {
        case '(':
        case ')':
        case '\\':
          result += '\\' + c;
          break;
        default:
          if (astring.charCodeAt(i) === 8364) result += String.fromCharCode(128);
          else result += c;
          break;
      }
    }
    return result + ')';
  }

  /**
   * The text each shaped glyph stands for, when it is not a single character (TextoDeCadaGlifo):
   * a ligature gets its characters, a character split in several glyphs belongs to the glyph that
   * carries its cluster and the others are silent (callar). Null where nothing can be said.
   */
  private static textOfEachGlyph(lInfo: LineInfo): { texts: (string | null)[]; silent: boolean[] } {
    const glifos = (lInfo.glyphs ?? []) as TGlyphPos[];
    const texto = lInfo.text;
    const salida: (string | null)[] = new Array<string | null>(glifos.length).fill(null);
    const callar: boolean[] = new Array<boolean>(glifos.length).fill(false);
    if (texto === null || texto === '') return { texts: salida, silent: callar };
    const limites: number[] = [];
    const cuantos = new Map<number, number>();
    const primero = new Map<number, number>();
    const ultimo = new Map<number, number>();
    for (let i = 0; i < glifos.length; i++) {
      const c = (glifos[i] as TGlyphPos).lineCluster;
      if (c < 0 || c >= texto.length) continue;
      const n = cuantos.get(c);
      if (n !== undefined) cuantos.set(c, n + 1);
      else {
        cuantos.set(c, 1);
        limites.push(c);
        primero.set(c, i);
      }
      ultimo.set(c, i);
    }
    limites.sort((a, b) => a - b);
    const elegido = new Map<number, number>();
    for (const [c, f] of primero) {
      const l = ultimo.get(c) as number;
      const rtl =
        (l < glifos.length - 1 && (glifos[l + 1] as TGlyphPos).lineCluster >= 0 && (glifos[l + 1] as TGlyphPos).lineCluster < c) ||
        (f > 0 && (glifos[f - 1] as TGlyphPos).lineCluster > c);
      elegido.set(c, rtl ? l : f);
    }
    for (let i = 0; i < glifos.length; i++) {
      const g = glifos[i] as TGlyphPos;
      const c = g.lineCluster;
      if (c < 0 || c >= texto.length) continue;
      const pos = binarySearch(limites, c);
      const fin = pos >= 0 && pos + 1 < limites.length ? (limites[pos + 1] as number) : texto.length;
      const largo = fin - c;
      if (largo < 1 || largo > 4 || texto.charCodeAt(c) !== g.charCode) continue;
      let limpio = true;
      for (let k = c; k < fin; k++) if (texto.charCodeAt(k) <= 0x20) limpio = false;
      if (!limpio) continue;
      const count = cuantos.get(c) as number;
      if (largo === 1 && count > 1 && elegido.get(c) !== i) {
        callar[i] = true;
        continue;
      }
      if (largo > 1 && count > 1) {
        if (count === largo) {
          const k = elegido.get(c) === ultimo.get(c) ? (ultimo.get(c) as number) - i : i - (primero.get(c) as number);
          if (k >= 0 && k < largo) {
            salida[i] = texto.charAt(c + k);
            continue;
          }
        }
        if (elegido.get(c) !== i) {
          callar[i] = true;
          continue;
        }
      }
      salida[i] = texto.substring(c, c + largo);
    }
    return { texts: salida, silent: callar };
  }

  /**
   * The code a shaped glyph is written with (ShapedGlyphCode): its glyph number for the first text
   * it is drawn for, a code of its own (from the number of glyphs of the font up) for another text,
   * so the /ToUnicode CMap can give each its text. A CFF font or one whose glyphs cannot be counted
   * keeps the glyph number.
   */
  private static shapedGlyphCode(adata: TTFontData, glyph: number, texto: string): number {
    const reclamado = adata.cidClaim.get(glyph);
    if (reclamado === undefined) {
      adata.cidClaim.set(glyph, texto);
      return glyph;
    }
    if (reclamado === texto || adata.type1) return glyph;
    if (adata.glyphCount < 0) {
      const gc = sfntGlyphCount(adata.fontData);
      adata.glyphCount = gc.cff ? 0 : gc.count;
    }
    if (adata.glyphCount <= glyph) return glyph;
    const clave = String(glyph) + '|' + texto;
    const known = adata.cidExtra.get(clave);
    if (known !== undefined) return known;
    const code = adata.glyphCount + adata.cidExtraGlyph.length;
    if (code > 65535) return glyph;
    adata.cidExtra.set(clave, code);
    adata.cidExtraGlyph.push(glyph);
    adata.cidExtraText.push(texto);
    return code;
  }

  /**
   * The text operators of a shaped line, glyph by glyph (PDFCompatibleTextShaping): each glyph
   * placed with its own text matrix, the font and color switched when an HTML run or a fallback
   * face changes them, every glyph registered in the subset of the face it was shaped with.
   */
  pdfCompatibleTextShaping(adataIn: TTFontData | null, posX: number, posY: number, fontSize: number, lInfo: LineInfo): string {
    const provider = this.infoProvider;
    if (provider === null) throw new ShaperNotSupportedError('Shaped text');
    let adata = adataIn;
    const font = this.font;
    const eol = this.eol();
    let result = '';
    let cursor = 0.0;
    const originalFontFamily = font.getFontFamily();
    let actualFontFamily = originalFontFamily;
    const originalBold = font.bold;
    let actualBold = originalBold;
    const originalItalic = font.italic;
    let actualItalic = originalItalic;
    const originalFontSize = fontSize;
    let actualFontSize = originalFontSize;
    const originalColor = font.color;
    let actualColor = originalColor;
    let recursoEmitido = type1FontToPdfFontName(font.name, font.italic, font.bold, font.getFontFamilyKey(), font.style, this.file.pdfConformance);
    let tamanoEmitido = font.size;
    const glyphs = (lInfo.glyphs ?? []) as TGlyphPos[];
    const textOf = PDFCanvas.textOfEachGlyph(lInfo);
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i] as TGlyphPos;
      const newFontFamily = g.fontFamily === null || g.fontFamily === '' ? originalFontFamily : g.fontFamily;
      const newBold = originalBold || g.bold;
      const newItalic = originalItalic || g.italic;
      const newFontSize = g.hasFontSize ? g.fontSize : originalFontSize;
      if (actualFontFamily !== newFontFamily || actualBold !== newBold || actualItalic !== newItalic || actualFontSize !== newFontSize) {
        font.wFontName = newFontFamily;
        font.lFontName = newFontFamily;
        font.bold = newBold;
        font.italic = newItalic;
        font.style = (newBold ? 1 : 0) + (newItalic ? 2 : 0) + (font.underline ? 4 : 0) + (font.strikeOut ? 8 : 0);
        font.size = Math.trunc(newFontSize);
        this.updateFonts();
        adata = this.getTTFontData();
        actualFontFamily = newFontFamily;
        actualBold = newBold;
        actualItalic = newItalic;
        actualFontSize = newFontSize;
      }
      let faceData: TTFontData | null = null;
      if (adata !== null && g.faceKey !== null && g.faceKey !== '' && g.faceKey !== adata.faceKey) faceData = this.dataForFace(g.faceKey);
      const glyphData = faceData ?? adata;
      const recursoDelGlifo =
        faceData !== null
          ? faceData.objectName
          : type1FontToPdfFontName(font.name, font.italic, font.bold, font.getFontFamilyKey(), font.style, this.file.pdfConformance);
      if (recursoDelGlifo !== recursoEmitido || font.size !== tamanoEmitido) {
        result += '/F' + recursoDelGlifo + ' ' + String(font.size) + ' Tf' + eol;
        recursoEmitido = recursoDelGlifo;
        tamanoEmitido = font.size;
      }
      const newColor = g.hasColor ? g.color : originalColor;
      if (newColor !== actualColor) {
        result += this.rgbToFloats(newColor) + ' rg' + eol;
        actualColor = newColor;
      }
      if (glyphData === null) throw new TypeError('Object reference not set to an instance of an object.');
      provider.getCharWidth(font, glyphData, g.charCode);
      provider.getGlyphWidth(font, glyphData, g.glyphIndex, g.charCode, g.faceKey);
      let code = g.glyphIndex;
      const own = textOf.texts[i];
      const textoAqui = own !== null && own !== undefined ? own : textOf.silent[i] ? '' : String.fromCharCode(g.charCode);
      code = PDFCanvas.shapedGlyphCode(glyphData, g.glyphIndex, textoAqui);
      const absY = posY - g.yOffset;
      const absX = posX + cursor + g.xOffset;
      result += '1 0 0 1 ' + this.unitsToTextX(absX) + ' ' + this.unitsToTextY(absY) + ' Tm <' + intToHex(code) + '> Tj' + eol;
      cursor += g.xAdvance;
    }
    if (actualFontFamily !== originalFontFamily || actualBold !== originalBold || actualItalic !== originalItalic || actualFontSize !== originalFontSize) {
      font.wFontName = originalFontFamily;
      font.lFontName = originalFontFamily;
      font.bold = originalBold;
      font.italic = originalItalic;
      font.style = (originalBold ? 1 : 0) + (originalItalic ? 2 : 0) + (font.underline ? 4 : 0) + (font.strikeOut ? 8 : 0);
      font.size = Math.trunc(originalFontSize);
      this.updateFonts();
      adata = this.getTTFontData();
    }
    if (actualColor !== originalColor) result += this.rgbToFloats(originalColor) + ' rg' + eol;
    return result;
  }

  /**
   * One line of text at a position (TextOut): the text, plain or glyph by glyph (right to left,
   * HTML, the FreeType provider), then the underline or the strikeout (per glyph run for HTML). Y
   * is the top of the line; the leading of the font is added.
   */
  textOut(
    X: number,
    Y: number,
    text: string,
    lineWidth: number,
    rotation: number,
    rightToLeft: boolean,
    lInfo: LineInfo,
    isHtml = false,
  ): void {
    this.normalizeFontForProvider();
    const adata = this.getTTFontData();
    const spacing =
      adata !== null ? { lineSpacing: adata.ascent - adata.descent + adata.leading, leading: adata.leading } : this.getStdLineSpacing();
    const fnt = this.font;
    const leading = toInt32(roundHalfEven((spacing.leading / 100000.0) * this.fResolution * fnt.size * 1.25));
    Y = (Y + leading) | 0;
    // Per glyph (shaped) output: right to left, HTML, the FreeType provider, or forced shaping with shaped glyphs
    const shapedOutput =
      rightToLeft ||
      isHtml ||
      this.infoProvider?.providerName === 'FontInfoFt' ||
      (this.forceComplexShaping && lInfo.glyphs !== null && lInfo.glyphs.length > 0);
    if (shapedOutput && this.infoProvider === null)
      throw new ShaperNotSupportedError(rightToLeft ? 'Right to left text' : isHtml ? 'HTML text' : 'Shaped text');
    this.file.checkPrinting();
    if (rotation !== 0) this.saveGraph();
    try {
      this.writePenColor(fnt.color);
      this.writeBrushColor(fnt.color);
      this.swl('BT');
      this.swl(
        '/F' +
          type1FontToPdfFontName(fnt.name, fnt.italic, fnt.bold, fnt.getFontFamilyKey(), fnt.style, this.pdfConformance) +
          ' ' +
          String(fnt.size) +
          ' Tf',
      );
      if (shapedOutput)
        this.swl('/Span << /ActualText ' + PDFCanvas.encodePDFText(isHtml && lInfo.text !== null ? lInfo.text : text) + ' >> BDC');
      if (rotation !== 0) {
        this.swl('1 0 0 1 ' + this.unitsToTextX(X) + ' ' + this.unitsToTextText(Y, fnt.size) + ' cm');
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        this.swl(
          formatFixed2(Math.cos(rotrad)) + ' ' + formatFixed2(Math.sin(rotrad)) + ' ' + formatFixed2(-Math.sin(rotrad)) + ' ' +
            formatFixed2(Math.cos(rotrad)) + ' 0 0 cm',
        );
      } else this.swl(this.unitsToTextX(X) + ' ' + this.unitsToTextText(Y, fnt.size) + ' Td');
      if (shapedOutput) this.swl(this.pdfCompatibleTextShaping(adata, X, Y, fnt.size, lInfo));
      else this.swl(PDFCanvas.pdfCompatibleText(text, adata) + ' Tj');
      if (shapedOutput) this.swl('EMC');
      this.swl('ET');
    } finally {
      if (rotation !== 0) this.restoreGraph();
    }
    const sizeTw = (fnt.size / CONS_PDFRES) * this.fResolution;
    if (isHtml && lInfo.glyphs !== null && lInfo.glyphs.length > 0) {
      // Per glyph decorations of HTML text (grouped runs)
      const glyphs = lInfo.glyphs as TGlyphPos[];
      let decCursor = 0.0;
      let inUnderline = false;
      let inStrikeOut = false;
      let ulStartX = 0;
      let soStartX = 0;
      let ulFontSize = fnt.size;
      let soFontSize = fnt.size;
      const fontSizeOffset = toInt32(roundHalfEven((fnt.size / CONS_PDFRES) * this.fResolution));
      for (let i = 0; i <= glyphs.length; i++) {
        const isLast = i === glyphs.length;
        let gUnderline = false;
        let gStrikeOut = false;
        let gFontSize = fnt.size;
        if (!isLast) {
          const g = glyphs[i] as TGlyphPos;
          gUnderline = g.underline;
          gStrikeOut = g.strikeOut;
          gFontSize = g.hasFontSize ? g.fontSize : fnt.size;
        }
        if (gUnderline && !inUnderline) {
          inUnderline = true;
          ulStartX = X + decCursor;
          ulFontSize = gFontSize;
        } else if ((!gUnderline || isLast) && inUnderline) {
          let ulEndX = X + decCursor;
          if (gUnderline && isLast) ulEndX = X + decCursor + (glyphs[i - 1] as TGlyphPos).xAdvance;
          this.penStyle = 0;
          this.penWidth = toInt32(roundHalfEven((ulFontSize / CONS_PDFRES) * this.fResolution * CONS_UNDERLINEWIDTH));
          this.penColor = fnt.color;
          const posLine = toInt32(roundHalfEven(CONS_UNDERLINEPOS * ((ulFontSize / CONS_PDFRES) * this.fResolution)));
          this.line(toInt32(ulStartX), (Y - fontSizeOffset + posLine) | 0, toInt32(ulEndX), (Y - fontSizeOffset + posLine) | 0);
          inUnderline = gUnderline;
          if (gUnderline) {
            ulStartX = X + decCursor;
            ulFontSize = gFontSize;
          }
        }
        if (gStrikeOut && !inStrikeOut) {
          inStrikeOut = true;
          soStartX = X + decCursor;
          soFontSize = gFontSize;
        } else if ((!gStrikeOut || isLast) && inStrikeOut) {
          let soEndX = X + decCursor;
          if (gStrikeOut && isLast) soEndX = X + decCursor + (glyphs[i - 1] as TGlyphPos).xAdvance;
          this.penStyle = 0;
          this.penWidth = toInt32(roundHalfEven((soFontSize / CONS_PDFRES) * this.fResolution * CONS_UNDERLINEWIDTH));
          this.penColor = fnt.color;
          const posLine = toInt32(roundHalfEven(CONS_STRIKEOUTPOS * ((soFontSize / CONS_PDFRES) * this.fResolution)));
          this.line(toInt32(soStartX), (Y - fontSizeOffset + posLine) | 0, toInt32(soEndX), (Y - fontSizeOffset + posLine) | 0);
          inStrikeOut = gStrikeOut;
          if (gStrikeOut) {
            soStartX = X + decCursor;
            soFontSize = gFontSize;
          }
        }
        if (!isLast) decCursor += (glyphs[i] as TGlyphPos).xAdvance;
      }
    } else if (fnt.underline) {
      // Underline and strikeout (one of them: C# parity, a text with both gets the underline)
      this.penStyle = 0;
      this.penWidth = toInt32(roundHalfEven(sizeTw * CONS_UNDERLINEWIDTH));
      this.penColor = fnt.color;
      if (rotation === 0) {
        const posLine = toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw));
        let nliney = (Y + posLine) | 0;
        // The shaped output places the text with Tm at Y, the plain one with Td at Y less the size
        if (shapedOutput) nliney = (nliney - toInt32(roundHalfEven((fnt.size / CONS_PDFRES) * this.fResolution))) | 0;
        this.line(X, nliney, (X + lineWidth) | 0, nliney);
      } else {
        Y = (Y + toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw))) | 0;
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        const fsize = ((CONS_UNDERLINEPOS * fnt.size) / CONS_PDFRES) * this.fResolution - sizeTw;
        const posLineX1 = neg(toInt32(roundHalfEven(fsize * Math.cos(rotrad))));
        const posLineY1 = neg(toInt32(roundHalfEven(fsize * Math.sin(rotrad))));
        const posLineX2 = toInt32(roundHalfEven(lineWidth * Math.cos(rotrad)));
        const posLineY2 = neg(toInt32(roundHalfEven(lineWidth * Math.sin(rotrad))));
        this.line((X + posLineX1) | 0, (Y + posLineY1) | 0, (X + posLineX2) | 0, (Y + posLineY2) | 0);
        Y = (Y - toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw))) | 0;
      }
    } else if (fnt.strikeOut) {
      this.penStyle = 0;
      this.penWidth = toInt32(roundHalfEven(sizeTw * CONS_UNDERLINEWIDTH));
      this.penColor = fnt.color;
      if (rotation === 0) {
        const posLine = toInt32(roundHalfEven(CONS_STRIKEOUTPOS * sizeTw));
        let nliney = (Y + posLine) | 0;
        if (shapedOutput) nliney = (nliney - toInt32(roundHalfEven((fnt.size / CONS_PDFRES) * this.fResolution))) | 0;
        this.line(X, nliney, (X + lineWidth) | 0, nliney);
      } else {
        Y = (Y + toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw))) | 0;
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        let fsize = ((CONS_UNDERLINEPOS * fnt.size) / CONS_PDFRES) * this.fResolution - sizeTw;
        let posLineX1 = neg(toInt32(roundHalfEven(fsize * Math.cos(rotrad))));
        let posLineY1 = neg(toInt32(roundHalfEven(fsize * Math.sin(rotrad))));
        let posLineX2 = toInt32(roundHalfEven(lineWidth * Math.cos(rotrad)));
        let posLineY2 = neg(toInt32(roundHalfEven(lineWidth * Math.sin(rotrad))));
        fsize = (((1 - CONS_STRIKEOUTPOS) * fnt.size) / CONS_PDFRES) * this.fResolution;
        posLineX1 = (X + posLineX1) | 0;
        posLineY1 = (Y + posLineY1) | 0;
        posLineX2 = (X + posLineX2) | 0;
        posLineY2 = (Y + posLineY2) | 0;
        posLineX1 = (posLineX1 - toInt32(roundHalfEven(fsize * Math.sin(rotrad)))) | 0;
        posLineY1 = (posLineY1 - toInt32(roundHalfEven(fsize * Math.cos(rotrad)))) | 0;
        posLineX2 = (posLineX2 - toInt32(roundHalfEven(fsize * Math.sin(rotrad)))) | 0;
        posLineY2 = (posLineY2 - toInt32(roundHalfEven(fsize * Math.cos(rotrad)))) | 0;
        this.line(posLineX1, posLineY1, posLineX2, posLineY2);
      }
    }
  }

  /** Moves the origin (cm) and makes the vertical coordinates relative to it (Translate). */
  translate(X: number, Y: number): void {
    const transstring = '1 0 0 1 ' + this.unitsToTextX(X) + ' ' + this.unitsToTextY(Y);
    this.translatedy = true;
    this.swl(transstring + ' cm');
  }

  /** Rotates the coordinate system (cm), an angle in radians (Rotate). */
  rotate(radians: number): void {
    this.swl(
      formatFixed2(Math.cos(radians)) + ' ' + formatFixed2(Math.sin(radians)) + ' ' + formatFixed2(-Math.sin(radians)) + ' ' +
        formatFixed2(Math.cos(radians)) + ' 0 0 cm',
    );
  }

  /**
   * A text in a rectangle (TextRect): lines broken by the measurement, aligned horizontally
   * (left, right, center, justified) and vertically (top, center, bottom), with the background of
   * each line when the font is not transparent, clipped to the rectangle and rotated around its
   * top left corner. Tabs become spaces and the text is written in Windows-1252.
   */
  textRect(
    arect: Rectangle,
    text: string,
    alignment: number,
    clipping: boolean,
    wordbreak: boolean,
    rotation: number,
    rightToLeft: boolean,
    isHtml = false,
  ): void {
    text = text.replaceAll('\t', ' ');
    const font = this.font;
    if (rightToLeft) {
      font.name = PDFFontType.Embedded;
      text = text === '' ? '' : text.normalize('NFC');
    }
    // A text outside WinAnsi is promoted to an embedded font (with a font provider; without one the
    // font is only normalized)
    this.promoteToUnicodeFontIfNeeded(text);
    // The shaped path is decided before the WinAnsi conversion below
    if (this.usesShaper(rightToLeft, isHtml)) font.name = PDFFontType.Embedded;
    const adata = this.getTTFontData();
    const isunicode = adata !== null && adata.isUnicode;
    if (!isunicode) text = unicodeToWin1252(text);
    this.file.checkPrinting();
    // Rotated text keeps the legacy pipeline: forced shaping is suspended
    let suspendedForceShaping = false;
    if (rotation !== 0 && this.forceComplexShaping) {
      this.forceComplexShaping = false;
      suspendedForceShaping = true;
    }
    if (clipping || rotation !== 0) this.saveGraph();
    try {
      if (clipping) {
        // Clipping rectangle
        this.swl(
          this.unitsToTextX(arect.left) + ' ' + this.unitsToTextY(arect.top) + ' ' + this.unitsToTextX(arect.width) + ' ' +
            this.unitsToTextX(neg(arect.height)) + ' re',
        );
        this.swl('h'); // Close path
        this.swl('W'); // Clip
        this.swl('n'); // New path
      }
      if (rotation !== 0) {
        this.translate(arect.left, arect.top);
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        this.rotate(rotrad);
        arect = { left: 0, top: 0, width: arect.width, height: arect.height };
      }
      const singleline = (alignment & AlignmentFlags.SingleLine) > 0;
      if (singleline) wordbreak = false;
      // Text extent and alignment
      const measured = this.textExtent(text, { ...arect }, wordbreak, singleline, true, rightToLeft, isHtml);
      const recsize = measured.rect;
      const lines = measured.lines;
      let posy = arect.top;
      if ((alignment & AlignmentFlags.AlignBottom) > 0) posy = (arect.top + arect.height - recsize.height) | 0;
      if ((alignment & AlignmentFlags.AlignVCenter) > 0) posy = (arect.top + intDiv(arect.height - recsize.height, 2)) | 0;
      for (let i = 0; i < lines.length; i++) {
        const li = lines[i] as LineInfo;
        let posx = arect.left;
        if ((alignment & AlignmentFlags.AlignRight) > 0) posx = (arect.left + arect.width - li.width) | 0;
        if ((alignment & AlignmentFlags.AlignHCenter) > 0) posx = (arect.left + intDiv(arect.width - li.width, 2)) | 0;
        if (li.position < 0 || li.size < 0 || li.position + li.size > text.length)
          throw new RangeError('Index and length must refer to a location within the string');
        const astring = text.substring(li.position, li.position + li.size);
        // Right to left lines are not justified, as in the Delphi engine
        let dojustify = (alignment & AlignmentFlags.AlignHJustify) > 0 && !li.lastLine && !isHtml && !rightToLeft;
        if (dojustify) {
          // The sizes of the words, then the space shared between them
          const lwords: string[] = [];
          let aword = '';
          let index = 0;
          while (index < astring.length) {
            if (astring.charAt(index) !== ' ') aword = aword + astring.charAt(index);
            else {
              if (aword.length > 0) lwords.push(aword);
              aword = '';
            }
            index++;
          }
          if (aword.length > 0) lwords.push(aword);
          let alinesize = 0;
          const lwidths: number[] = [];
          // Each word keeps its own LineInfo
          const lwordinfos: LineInfo[] = [];
          for (index = 0; index < lwords.length; index++) {
            const winfos = this.textExtent(lwords[index] as string, { ...arect }, false, true, false, rightToLeft, isHtml);
            // C# parity: dolineinfo false keeps the lines of the canvas, so this is the first
            // line of the whole text, not of the word (only shaped output would use it)
            if (winfos.lines.length > 0) lwordinfos.push(winfos.lines[0] as LineInfo);
            else lwordinfos.push(li);
            const nwidth = rightToLeft ? neg(winfos.rect.width) : winfos.rect.width;
            lwidths.push(nwidth);
            alinesize = (alinesize + nwidth) | 0;
          }
          let alinedif = arect.width - alinesize;
          if (alinedif > 0) {
            if (lwords.length > 1) alinedif = alinedif / (lwords.length - 1);
            let currpos: number;
            if (rightToLeft) {
              currpos = arect.width;
              alinedif = -alinedif;
            } else currpos = posx;
            if (!font.transparent && lwords.length > 0) this.lineBackground(convertToInt32(currpos), posy, li);
            for (index = 0; index < lwords.length; index++) {
              this.textOut(
                convertToInt32(currpos),
                (posy + li.topPos) | 0,
                lwords[index] as string,
                li.width,
                0,
                rightToLeft,
                lwordinfos[index] as LineInfo,
                isHtml,
              );
              currpos = currpos + (lwidths[index] as number) + alinedif;
            }
          } else {
            // No space to share (overflowing line): the line is drawn unjustified
            dojustify = false;
          }
        }
        if (!dojustify) {
          if (!font.transparent) this.lineBackground(posx, posy, li);
          this.textOut(posx, (posy + li.topPos) | 0, astring, li.width, 0, rightToLeft, li, isHtml);
        }
      }
    } finally {
      if (clipping || rotation !== 0) this.restoreGraph();
      if (suspendedForceShaping) this.forceComplexShaping = true;
    }
  }

  private lineBackground(posx: number, posy: number, li: LineInfo): void {
    const previousBrushColor = this.brushColor;
    const previousBrushStyle = this.brushStyle;
    const previousPenStyle = this.penStyle;
    const previousPenColor = this.penColor;
    this.brushColor = this.font.backColor;
    this.penColor = this.font.backColor;
    this.penStyle = 5;
    this.brushStyle = 0;
    this.rectangle(posx, (posy + li.topPos) | 0, (posx + li.width) | 0, (posy + li.topPos + li.height) | 0);
    this.penColor = previousPenColor;
    this.penStyle = previousPenStyle;
    this.brushColor = previousBrushColor;
    this.brushStyle = previousBrushStyle;
  }

  /**
   * Draws an image in a rectangle (DrawImage) and embeds it, once, as an image XObject: a JPEG as
   * it is (/DCTDecode), a Windows bitmap read by BitmapUtil (indexed with its palette and color
   * key mask, or RGB with the fourth byte of a 32 bit bitmap as soft mask), and any other format
   * decoded (PNG, GIF) as RGB with its alpha as a soft mask; Flate compressed when the file is.
   *
   * dpires 0 stretches the image to the rectangle; otherwise the image has its size at that
   * resolution, centered in the rectangle when smaller. tile repeats it, clip clips to the
   * rectangle. An internalImageIndex of 0 or more is the key of an image shared by several
   * objects: the second time only the drawing is written.
   *
   * C# parity, kept: the clipping rectangle takes the width and height as the right and bottom
   * coordinates; after the first tile the scale of the tiles is their left (top) coordinate and
   * the tiles stop past the width (height) of the rectangle plus one tile, not past its right;
   * the q before the clipping is never closed (the clipping stays for the rest of the page); a
   * JPEG always declares /DeviceRGB; bytes no codec decodes give an image of 0 x 0.
   */
  drawImage(rec: Rectangle, abitmap: Uint8Array, dpires: number, tile: boolean, clip: boolean, internalImageIndex: number): void {
    const file = this.file;
    let arect = rec;
    file.checkPrinting();
    const calculateOnly = file.calculateOnly;
    let fimagestream: Uint8Array | null = null;
    let imageMaskStream: Uint8Array | null = null;
    let bitmapwidth: number;
    let bitmapheight: number;
    let indexed = false;
    let bitsperpixel = 8;
    let numcolors = 0;
    let palette = '';
    let mask = '';
    let isgif = false;
    let newstream = true;
    const jpeg = getJpegInfo(abitmap);
    const isjpeg = jpeg.isJpeg;
    if (isjpeg) {
      bitmapwidth = jpeg.width;
      bitmapheight = jpeg.height;
      if (!calculateOnly) fimagestream = abitmap;
    } else {
      const info = getBitmapInfo(abitmap, !calculateOnly, !calculateOnly);
      bitmapwidth = info.width;
      bitmapheight = info.height;
      indexed = info.indexed;
      bitsperpixel = info.bitsPerPixel;
      numcolors = info.usedColors;
      palette = info.palette;
      mask = info.mask;
      isgif = info.isGif;
      if (!calculateOnly) {
        fimagestream = info.bits ?? new Uint8Array(0);
        imageMaskStream = info.smask;
      }
      if (isgif || !info.isBitmap) {
        // PNG, GIF and the rest: decoded (Skia in C#) and read as a 32 bit bitmap. C# parity:
        // GetBitmapInfo of the bitmap resets the outputs (an image Skia cannot decode is 0 x 0)
        const decoded = decodeImageForPdf(abitmap);
        bitmapwidth = decoded === null ? 0 : decoded.width;
        bitmapheight = decoded === null ? 0 : decoded.height;
        indexed = false;
        bitsperpixel = decoded === null ? 8 : 32;
        numcolors = 0;
        palette = '';
        mask = '';
        isgif = false;
        if (!calculateOnly) {
          imageMaskStream = decoded === null ? null : decoded.alpha;
          if (decoded !== null) fimagestream = decoded.rgb;
        }
      }
    }
    if (imageMaskStream !== null && imageMaskStream.length === 0) imageMaskStream = null;
    if (dpires !== 0) {
      const arec = { ...rec };
      rec = {
        left: rec.left,
        top: rec.top,
        width: toInt32(roundHalfEven((bitmapwidth / dpires) * this.fResolution)),
        height: toInt32(roundHalfEven((bitmapheight / dpires) * this.fResolution)),
      };
      if (rec.width < arec.width) rec = { ...rec, left: (rec.left + intDiv((arec.width - rec.width) | 0, 2)) | 0 };
      if (rec.height < arec.height) rec = { ...rec, top: (rec.top + intDiv((arec.height - rec.height) | 0, 2)) | 0 };
      arect = rec;
    }
    let imageindex: number;
    if (internalImageIndex >= 0) {
      const key = String(internalImageIndex);
      const existing = file.imageIndexes.get(key);
      if (existing !== undefined) {
        imageindex = existing;
        newstream = false;
      } else {
        file.imageCount = file.imageCount + 1;
        imageindex = file.imageCount;
        file.imageIndexes.set(key, imageindex);
      }
    } else {
      file.imageCount = file.imageCount + 1;
      imageindex = file.imageCount;
    }
    const X = (v: number): string => this.unitsToTextX(v | 0);
    const Y = (v: number): string => this.unitsToTextY(v | 0);
    this.swl('q');
    if (clip) {
      // Clipping rectangle
      this.swl(X(arect.left) + ' ' + Y(arect.top) + ' ' + X(arect.width - arect.left) + ' ' + X(neg(arect.height - arect.top)) + ' re');
      this.swl('h'); // ClosePath
      this.swl('W'); // Clip
      this.swl('n'); // NewPath
    }
    const awidth = rec.width;
    const aheight = rec.height;
    if (awidth <= 0) tile = false;
    if (aheight <= 0) tile = false;
    do {
      rec = { left: arect.left, top: rec.top, width: awidth, height: aheight };
      do {
        this.swl('q');
        // Translate
        this.swl('1 0 0 1 ' + X(rec.left) + ' ' + Y(rec.top + rec.height) + ' cm');
        // Scale
        this.swl(X(rec.width) + ' 0 0  ' + X(rec.height) + ' 0 0 cm');
        this.swl('/Im' + String(imageindex) + ' Do');
        this.swl('Q');
        if (!tile) break;
        rec = { left: (rec.left + awidth) | 0, top: rec.top, width: (rec.left + awidth) | 0, height: rec.height };
      } while (rec.width <= ((arect.width + awidth) | 0));
      if (!tile) break;
      rec = { left: rec.left, top: (rec.top + aheight) | 0, width: rec.width, height: (rec.top + aheight) | 0 };
    } while (rec.height <= ((arect.height + aheight) | 0));
    if (!newstream) return;
    const imageName = 'Im' + String(file.imageCount);
    if (calculateOnly) return;
    const image = fimagestream ?? new Uint8Array(0);
    const sw = (stream: ByteBuffer, value: string): void => file.sWriteLine(stream, value);
    let maskStream: ByteBuffer | null = null;
    if (imageMaskStream !== null) {
      file.imageCount = file.imageCount + 1;
      const imageMaskName = 'Im' + String(file.imageCount);
      // Saves the soft mask to the image streams
      maskStream = new ByteBuffer();
      sw(maskStream, '<< /Type /XObject');
      sw(maskStream, '/Subtype /Image');
      sw(maskStream, '/Width ' + String(bitmapwidth));
      sw(maskStream, '/Height ' + String(bitmapheight));
      sw(maskStream, '/ColorSpace /DeviceGray');
      sw(maskStream, '/BitsPerComponent 8');
      sw(maskStream, '/Name /' + imageMaskName);
      writeImageData(file, maskStream, imageMaskStream, file.compressed);
    }
    // Saves the image to the image streams
    const astream = new ByteBuffer();
    sw(astream, '<< /Type /XObject');
    sw(astream, '/Subtype /Image');
    sw(astream, '/Width ' + String(bitmapwidth));
    sw(astream, '/Height ' + String(bitmapheight));
    if (indexed) {
      sw(astream, '/ColorSpace');
      sw(astream, '[/Indexed');
      sw(astream, '/DeviceRGB ' + String(numcolors));
      sw(astream, palette);
      sw(astream, ']');
      sw(astream, '/BitsPerComponent ' + String(bitsperpixel));
      if (mask.length > 0) sw(astream, '/Mask ' + mask);
    } else {
      sw(astream, '/ColorSpace /DeviceRGB');
      sw(astream, '/BitsPerComponent 8');
    }
    sw(astream, '/Name /' + imageName);
    if (maskStream !== null) {
      // The number of the mask object is written when the objects are (PDFFile.WriteBitmap)
      astream.writeLatin1('/SMask ');
      file.masks.set(file.imageCount - 1, { stream: astream, position: astream.length });
      sw(astream, '               0 R');
    }
    if (isjpeg) {
      sw(astream, '/Length ' + String(image.length));
      sw(astream, '/Filter [/DCTDecode]');
      sw(astream, '>>');
      sw(astream, 'stream');
      astream.write(image);
    } else if (isgif) {
      // C# parity: unreachable, GetBitmapInfo of the decoded GIF resets isgif
      sw(astream, '/Length ' + String(image.length));
      sw(astream, '/Filter [/LZWDecode]');
      sw(astream, '>>');
      sw(astream, 'stream');
      astream.write(image);
    } else writeImageData(file, astream, image, file.compressed);
    file.bitmapStreams.push(astream);
    if (maskStream !== null) file.bitmapStreams.push(maskStream);
  }
}

/**
 * The /Length (and /Filter) of an image stream, the end of its dictionary and its data: a
 * compressed stream gets its length written over spaces once it is compressed, as the
 * compression task of C# does.
 */
function writeImageData(file: PDFFile, stream: ByteBuffer, data: Uint8Array, compressed: boolean): void {
  if (compressed) {
    stream.writeLatin1('/Length ');
    const lengthPosition = stream.length;
    file.sWriteLine(stream, '             ');
    file.sWriteLine(stream, '/Filter [/FlateDecode]');
    file.sWriteLine(stream, '>>');
    file.sWriteLine(stream, 'stream');
    const packed = file.compressImage(data);
    stream.write(packed);
    const digits = String(packed.length);
    const bytes = new Uint8Array(digits.length);
    for (let i = 0; i < digits.length; i++) bytes[i] = digits.charCodeAt(i);
    stream.writeAt(lengthPosition, bytes);
  } else {
    file.sWriteLine(stream, '/Length ' + String(data.length));
    file.sWriteLine(stream, '>>');
    file.sWriteLine(stream, 'stream');
    stream.write(data);
  }
}
