import { AlignmentFlags, PDFConformanceType, PDFFontType, convertToInt32, intDiv, roundHalfEven, toInt32 } from 'reportman-metafile';
import type { LineInfo, Rectangle } from 'reportman-metafile';
import {
  CONS_PDFRES,
  ShaperNotSupportedError,
  TextCanvas,
  type1FontToPdfFontName,
  unicodeToWin1252,
} from 'reportman-text';
import { formatFixed2, intToHex } from './netformat.js';
import type { PDFFile } from './pdffile.js';

/** Underline position factor, relative to the font size (PDFFile.CONS_UNDERLINEPOS). */
export const CONS_UNDERLINEPOS = 1.1;
/** Strikeout position factor (PDFFile.CONS_STRIKEOUTPOS). */
export const CONS_STRIKEOUTPOS = 0.7;
/** Underline and strikeout width factor (PDFFile.CONS_UNDERLINEWIDTH). */
export const CONS_UNDERLINEWIDTH = 0.1;

/** The error of an image object: images are not ported to TypeScript yet. */
export class ImageNotSupportedError extends Error {
  constructor() {
    super('Images are not supported yet by the TypeScript PDF writer (reportman-pdf)');
    this.name = 'ImageNotSupportedError';
  }
}

/** An int negation of C# (no negative zero). */
function neg(x: number): number {
  return -x | 0;
}

/**
 * The PDF drawing surface (PDFCanvas) for the standard 14 fonts: it writes the operators of the
 * content stream of the current page of its PDFFile, in twips converted to points. Text is
 * measured and broken in lines by the TextCanvas it extends.
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

  /** The font data of the current font: always none without a font provider (UpdateFonts). */
  updateFonts(): null {
    return null;
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
   * A text as a PDF literal string for a standard font (PDFCompatibleText without font data):
   * ( ) and \ escaped, € (U+20AC) as the WinAnsi 0x80.
   */
  static pdfCompatibleText(astring: string): string {
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
   * One line of text at a position (TextOut): the text, then the underline or the strikeout. Y is
   * the top of the line; the leading of the font is added.
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
    this.getTTFontData();
    const spacing = this.getStdLineSpacing();
    const fnt = this.font;
    const leading = toInt32(roundHalfEven((spacing.leading / 100000.0) * this.fResolution * fnt.size * 1.25));
    Y = (Y + leading) | 0;
    // Per glyph (shaped) output: right to left, HTML, or forced shaping with shaped glyphs
    const shapedOutput =
      rightToLeft || isHtml || (this.forceComplexShaping && lInfo.glyphs !== null && lInfo.glyphs.length > 0);
    if (shapedOutput) throw new ShaperNotSupportedError(rightToLeft ? 'Right to left text' : isHtml ? 'HTML text' : 'Shaped text');
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
      if (rotation !== 0) {
        this.swl('1 0 0 1 ' + this.unitsToTextX(X) + ' ' + this.unitsToTextText(Y, fnt.size) + ' cm');
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        this.swl(
          formatFixed2(Math.cos(rotrad)) + ' ' + formatFixed2(Math.sin(rotrad)) + ' ' + formatFixed2(-Math.sin(rotrad)) + ' ' +
            formatFixed2(Math.cos(rotrad)) + ' 0 0 cm',
        );
      } else this.swl(this.unitsToTextX(X) + ' ' + this.unitsToTextText(Y, fnt.size) + ' Td');
      this.swl(PDFCanvas.pdfCompatibleText(text) + ' Tj');
      this.swl('ET');
    } finally {
      if (rotation !== 0) this.restoreGraph();
    }
    const sizeTw = (fnt.size / CONS_PDFRES) * this.fResolution;
    // Underline and strikeout (one of them: C# parity, a text with both gets the underline)
    if (fnt.underline) {
      this.penStyle = 0;
      this.penWidth = toInt32(roundHalfEven(sizeTw * CONS_UNDERLINEWIDTH));
      this.penColor = fnt.color;
      if (rotation === 0) {
        const posLine = toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw));
        const nliney = (Y + posLine) | 0;
        this.line(X, nliney, (X + lineWidth) | 0, nliney);
      } else {
        Y = (Y + toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw))) | 0;
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        const fsize = (((CONS_UNDERLINEPOS * fnt.size) / CONS_PDFRES) * this.fResolution) - sizeTw;
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
        const nliney = (Y + posLine) | 0;
        this.line(X, nliney, (X + lineWidth) | 0, nliney);
      } else {
        Y = (Y + toInt32(roundHalfEven(CONS_UNDERLINEPOS * sizeTw))) | 0;
        const rotrad = (rotation / 10) * ((2 * Math.PI) / 360);
        let fsize = (((CONS_UNDERLINEPOS * fnt.size) / CONS_PDFRES) * this.fResolution) - sizeTw;
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
    // A text outside WinAnsi would be promoted to an embedded font; without a font provider the
    // font is only normalized
    this.promoteToUnicodeFontIfNeeded(text);
    if (this.usesShaper(rightToLeft, isHtml)) font.name = PDFFontType.Embedded;
    this.getTTFontData();
    text = unicodeToWin1252(text);
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

  /** Images are not ported yet: always fails (DrawImage). */
  drawImage(_rec: Rectangle, _bitmap: Uint8Array, _dpires: number, _tile: boolean, _clip: boolean, _imageIndex: number): never {
    throw new ImageNotSupportedError();
  }
}
