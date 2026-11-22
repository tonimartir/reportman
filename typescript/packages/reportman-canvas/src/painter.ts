// The PDF canvas of the preview: PDFCanvas of @reportman/pdf with its operators drawn on a Canvas
// 2D context. It extends the same TextCanvas, so a text is measured and broken in lines as the PDF
// breaks it, and each method follows the method of PDFCanvas it is named after: the coordinates,
// the line widths, the dashes, the fills, the text positions and the C# quirks the PDF keeps.
//
// Coordinates are twips, y down: the preview scales the context once, so the twips of the metafile
// go straight to the context (the PDF converts each one to points, y up).

import { AlignmentFlags, PDFFontType, TWIPS_PER_INCH, convertToInt32, intDiv, roundHalfEven, toInt32 } from '@reportman/metafile';
import type { LineInfo, Rectangle } from '@reportman/metafile';
import { CONS_STRIKEOUTPOS, CONS_UNDERLINEPOS, CONS_UNDERLINEWIDTH } from '@reportman/pdf';
import { CONS_PDFRES, ShaperNotSupportedError, TextCanvas, unicodeToWin1252 } from '@reportman/text';
import type { FontInfoProvider, LogFontFt, TGlyphPos, TTFontData } from '@reportman/text';
import { cssColor } from './color.js';
import type { CanvasContext, CanvasImage } from './context.js';
import { OutlineCache, standardChar, standardFamily, standardWidth, DEFAULT_FAMILIES } from './fonts.js';
import type { StandardFamilies } from './fonts.js';
import type { PreparedImage } from './images.js';

/** Twips per point. */
const TWIPS_PER_POINT = TWIPS_PER_INCH / CONS_PDFRES;

/** An int negation of C# (no negative zero). */
function neg(x: number): number {
  return -x | 0;
}

/** The dash of a pen style in twips (the PDF writes it in points). */
function dashOf(penStyle: number): number[] {
  switch (penStyle) {
    case 1: // Dash: [16 8]
      return [320, 160];
    case 2: // Dot: [1]
      return [20, 20];
    case 3: // Dash dot: [8 7 2 7]
      return [160, 140, 40, 140];
    case 4: // Dash dot dot: [8 4 2 4 2 4]
      return [160, 80, 40, 80, 40, 80];
    default:
      return [];
  }
}

/** Something the preview left out of a page, and why. */
export interface SkippedObject {
  /** The index of the object in the page. */
  objectIndex: number;
  reason: string;
}

/**
 * The drawing surface of the preview (the PDFCanvas of the PDF device): the pen, the brush and the
 * font of PDFCanvas, measured by the TextCanvas they share, drawn on a context.
 */
export class PreviewCanvas extends TextCanvas {
  /** The context of the page being drawn. */
  ctx: CanvasContext | null = null;
  penColor = 0;
  penStyle = 0;
  penWidth = 0;
  brushColor = 0;
  brushStyle = 0;
  /**
   * The narrowest line in twips (one pixel of the device by default): a PDF line of 1 twip is a
   * hairline viewers draw one pixel wide; a context would draw a fraction of a pixel, almost white.
   */
  minLineWidth = 0;
  /**
   * Pixels of the device per twip, to align to the pixels the horizontal and vertical lines and
   * rectangles (their edges on pixel boundaries, at least one pixel: the stroke adjustment of PDF
   * viewers, which keeps rules and barcode bars sharp) and the baselines of the texts. 0 draws
   * every coordinate as it is. The pixels are taken as aligned with the origin of the page.
   */
  pixelsPerTwip = 0;
  /** Pixels of the device per twip, whether the drawing is aligned to them or not. */
  devicePixelsPerTwip = 1;
  /** Inside a rotated text nothing is aligned to the pixels. */
  private rotated = 0;
  families: StandardFamilies = DEFAULT_FAMILIES;
  /** The outlines of the TrueType glyphs drawn. */
  readonly outlines: OutlineCache;
  /** What the current object leaves out (set by the preview for each object). */
  onSkip: ((reason: string) => void) | null = null;
  private depth = 0;

  constructor(infoProvider: FontInfoProvider | null = null, outlines: OutlineCache = new OutlineCache()) {
    super(infoProvider);
    this.outlines = outlines;
  }

  private get c(): CanvasContext {
    if (this.ctx === null) throw new Error('PreviewCanvas: no context');
    return this.ctx;
  }

  /** The number of saves not restored yet. */
  get saveDepth(): number {
    return this.depth;
  }

  save(): void {
    this.c.save();
    this.depth++;
  }

  restore(): void {
    if (this.depth <= 0) return;
    this.c.restore();
    this.depth--;
  }

  /** Restores the context to a depth of saves (after an object failed in the middle). */
  restoreTo(depth: number): void {
    while (this.depth > depth) this.restore();
  }

  private skip(reason: string): void {
    this.onSkip?.(reason);
  }

  private get snapping(): boolean {
    return this.pixelsPerTwip > 0 && this.rotated === 0;
  }

  /** A coordinate on the nearest pixel boundary. */
  private toEdge(v: number): number {
    const k = this.pixelsPerTwip;
    return Math.round(v * k) / k;
  }

  /** The ends of a span on pixel boundaries, one pixel at least when it is not empty. */
  private span(a: number, b: number): [number, number] {
    const k = this.pixelsPerTwip;
    const p = Math.round(a * k);
    let q = Math.round(b * k);
    if (p === q && a !== b) q = b > a ? p + 1 : p - 1;
    return [p / k, q / k];
  }

  /** The center of a line across an axis that puts its edges on pixel boundaries. */
  private lineCenter(v: number, width: number): number {
    const k = this.pixelsPerTwip;
    if (Math.round(width * k) % 2 === 1) return (Math.floor(v * k) + 0.5) / k;
    return Math.round(v * k) / k;
  }

  /** The width of the pen: 1 twip for 0, the narrowest line at least, whole pixels when aligned. */
  private lineWidthOf(): number {
    const w = Math.max(this.penWidth > 0 ? this.penWidth : 1, this.minLineWidth);
    if (!this.snapping) return w;
    const k = this.pixelsPerTwip;
    return Math.max(1, Math.round(w * k)) / k;
  }

  /** The stroke of the current pen: its color, its width and its dash (SetDash). */
  private setPen(color: number): void {
    const c = this.c;
    c.lineWidth = this.lineWidthOf();
    c.strokeStyle = cssColor(color);
    c.setLineDash(dashOf(this.penStyle));
  }

  /** Fills and strokes the current path as the PDF fill operator does: B, f for a clear pen, S for a clear brush. */
  private fillOperator(): void {
    const c = this.c;
    if (this.brushStyle === 1) c.stroke();
    else {
      c.fill();
      if (this.penStyle !== 5) c.stroke();
    }
  }

  /** A line with the current pen (Line). */
  line(x1: number, y1: number, x2: number, y2: number): void {
    if (this.penStyle === 5) return;
    const c = this.c;
    this.setPen(this.penColor);
    c.beginPath();
    if (this.snapping && y1 === y2) {
      const y = this.lineCenter(y1, this.lineWidthOf());
      const [a, b] = this.span(x1, x2);
      c.moveTo(a, y);
      c.lineTo(b, y);
    } else if (this.snapping && x1 === x2) {
      const x = this.lineCenter(x1, this.lineWidthOf());
      const [a, b] = this.span(y1, y2);
      c.moveTo(x, a);
      c.lineTo(x, b);
    } else {
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    }
    c.stroke();
  }

  private startShape(): void {
    this.setPen(this.penColor);
    this.c.fillStyle = cssColor(this.brushColor);
    this.c.beginPath();
  }

  /** An ellipse inscribed in a box, four Bezier curves with the integer control points of the PDF (Ellipse). */
  ellipse(x1: number, y1: number, x2: number, y2: number): void {
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.startShape();
    const W = x2 - x1;
    const H = y2 - y1;
    const h2 = toInt32(H / 2);
    const w2 = toInt32(W / 2);
    const hk = toInt32(roundHalfEven(((H / 2) * 11) / 20));
    const wk = toInt32(roundHalfEven(((W / 2) * 11) / 20));
    const c = this.c;
    const I = (v: number): number => v | 0;
    c.moveTo(I(x1), I(y1 + h2));
    c.bezierCurveTo(I(x1), I(y1 + h2 - hk), I(x1 + w2 - wk), I(y1), I(x1 + w2), I(y1));
    c.bezierCurveTo(I(x1 + w2 + wk), I(y1), I(x1 + W), I(y1 + h2 - hk), I(x1 + W), I(y1 + h2));
    c.bezierCurveTo(I(x1 + W), I(y1 + h2 + hk), I(x1 + w2 + wk), I(y1 + H), I(x1 + w2), I(y1 + H));
    c.bezierCurveTo(I(x1 + w2 - wk), I(y1 + H), I(x1), I(y1 + h2 + hk), I(x1), I(y1 + h2));
    this.fillOperator();
  }

  /** A rectangle with rounded corners: the v curves of the PDF, the first control point the current one (RoundedRectangle). */
  roundedRectangle(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.startShape();
    const c = this.c;
    const I = (v: number): number => v | 0;
    c.moveTo(I(x1), I(y2 - radius));
    c.lineTo(I(x1), I(y1 + radius));
    c.bezierCurveTo(I(x1), I(y1 + radius), I(x1), I(y1), I(x1 + radius), I(y1));
    c.lineTo(I(x2 - radius), I(y1));
    c.bezierCurveTo(I(x2 - radius), I(y1), I(x2), I(y1), I(x2), I(y1 + radius));
    c.lineTo(I(x2), I(y2 - radius));
    c.bezierCurveTo(I(x2), I(y2 - radius), I(x2), I(y2), I(x2 - radius), I(y2));
    c.lineTo(I(x1 + radius), I(y2));
    c.bezierCurveTo(I(x1 + radius), I(y2), I(x1), I(y2), I(x1), I(y2 - radius));
    this.fillOperator();
  }

  /**
   * A rectangle (Rectangle). Aligned to the pixels, a filled one has its edges on pixel boundaries
   * and a stroked one its lines (the fill then reaches their centers, under the stroke).
   */
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    if (this.penStyle === 5 && this.brushStyle === 1) return;
    this.startShape();
    const w = (x2 - x1) | 0;
    const h = (y2 - y1) | 0;
    if (!this.snapping) this.c.rect(x1, y1, w, h);
    else if (this.penStyle === 5) {
      const [l, r] = this.span(x1, x1 + w);
      const [t, b] = this.span(y1, y1 + h);
      this.c.rect(l, t, r - l, b - t);
    } else {
      const lw = this.lineWidthOf();
      const l = this.lineCenter(x1, lw);
      const t = this.lineCenter(y1, lw);
      this.c.rect(l, t, this.lineCenter(x1 + w, lw) - l, this.lineCenter(y1 + h, lw) - t);
    }
    this.fillOperator();
  }

  /**
   * A text in a rectangle (TextRect): the lines of the measurement, aligned, justified word by
   * word, with the background of each line, clipped and rotated around the top left corner, as
   * the PDF canvas writes them.
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
    this.promoteToUnicodeFontIfNeeded(text);
    if (this.usesShaper(rightToLeft, isHtml)) font.name = PDFFontType.Embedded;
    const adata = this.getTTFontData();
    const isunicode = adata !== null && adata.isUnicode;
    if (!isunicode) text = unicodeToWin1252(text);
    // Rotated text keeps the legacy pipeline: forced shaping is suspended
    let suspendedForceShaping = false;
    if (rotation !== 0 && this.forceComplexShaping) {
      this.forceComplexShaping = false;
      suspendedForceShaping = true;
    }
    const depth = this.depth;
    const rotated = this.rotated;
    if (clipping || rotation !== 0) this.save();
    try {
      const c = this.c;
      if (clipping) {
        c.beginPath();
        c.rect(arect.left, arect.top, arect.width, arect.height);
        c.clip();
      }
      if (rotation !== 0) {
        this.rotated++;
        c.translate(arect.left, arect.top);
        // Counterclockwise on the page: the y axis points down here
        c.rotate(-((rotation / 10) * ((2 * Math.PI) / 360)));
        arect = { left: 0, top: 0, width: arect.width, height: arect.height };
      }
      const singleline = (alignment & AlignmentFlags.SingleLine) > 0;
      if (singleline) wordbreak = false;
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
        let dojustify = (alignment & AlignmentFlags.AlignHJustify) > 0 && !li.lastLine && !isHtml && !rightToLeft;
        if (dojustify) {
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
          const lwordinfos: LineInfo[] = [];
          for (index = 0; index < lwords.length; index++) {
            const winfos = this.textExtent(lwords[index] as string, { ...arect }, false, true, false, rightToLeft, isHtml);
            // C# parity, as PDFCanvas: the first line of the canvas, not of the word
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
              this.textOut(convertToInt32(currpos), (posy + li.topPos) | 0, lwords[index] as string, li.width, rightToLeft, lwordinfos[index] as LineInfo, isHtml);
              currpos = currpos + (lwidths[index] as number) + alinedif;
            }
          } else dojustify = false;
        }
        if (!dojustify) {
          if (!font.transparent) this.lineBackground(posx, posy, li);
          this.textOut(posx, (posy + li.topPos) | 0, astring, li.width, rightToLeft, li, isHtml);
        }
      }
    } finally {
      this.restoreTo(depth);
      this.rotated = rotated;
      if (suspendedForceShaping) this.forceComplexShaping = true;
    }
  }

  private lineBackground(posx: number, posy: number, li: LineInfo): void {
    const previous = [this.brushColor, this.brushStyle, this.penStyle, this.penColor] as const;
    this.brushColor = this.font.backColor;
    this.penColor = this.font.backColor;
    this.penStyle = 5;
    this.brushStyle = 0;
    this.rectangle(posx, (posy + li.topPos) | 0, (posx + li.width) | 0, (posy + li.topPos + li.height) | 0);
    [this.brushColor, this.brushStyle, this.penStyle, this.penColor] = previous;
  }

  /**
   * One line of text (TextOut): Y is the top of the line, the leading of the font is added. The
   * standard fonts are drawn character by character at the positions their widths give in the PDF,
   * with the browser family of each; the shaped lines (the TrueType fonts) glyph by glyph with the
   * outlines of the font the PDF embeds. Then the underline or the strikeout.
   * The PDF canvas has a rotation here too, which the text rectangle never passes: it is left out.
   */
  textOut(X: number, Y: number, text: string, lineWidth: number, rightToLeft: boolean, lInfo: LineInfo, isHtml = false): void {
    this.normalizeFontForProvider();
    const adata = this.getTTFontData();
    const spacing =
      adata !== null ? { lineSpacing: adata.ascent - adata.descent + adata.leading, leading: adata.leading } : this.getStdLineSpacing();
    const fnt = this.font;
    const leading = toInt32(roundHalfEven((spacing.leading / 100000.0) * this.fResolution * fnt.size * 1.25));
    Y = (Y + leading) | 0;
    const shapedOutput =
      rightToLeft ||
      isHtml ||
      this.infoProvider?.providerName === 'FontInfoFt' ||
      (this.forceComplexShaping && lInfo.glyphs !== null && lInfo.glyphs.length > 0);
    if (shapedOutput && this.infoProvider === null)
      throw new ShaperNotSupportedError(rightToLeft ? 'Right to left text' : isHtml ? 'HTML text' : 'Shaped text');
    if (shapedOutput) this.drawShapedLine(adata, X, Y, fnt.size, lInfo);
    else if (adata === null) this.drawStandardText(X, (Y + fnt.size * TWIPS_PER_POINT), text);
    // A TrueType font drawn without the shaper takes its glyphs from the widths of the PDF, which
    // only a provider other than the FreeType one gives: there is none
    else this.skip('TrueType text without the shaper');
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
    } else if (fnt.underline || fnt.strikeOut) {
      // One of them: C# parity, a text with both gets the underline
      this.penStyle = 0;
      this.penWidth = toInt32(roundHalfEven(sizeTw * CONS_UNDERLINEWIDTH));
      this.penColor = fnt.color;
      const posLine = toInt32(roundHalfEven((fnt.underline ? CONS_UNDERLINEPOS : CONS_STRIKEOUTPOS) * sizeTw));
      let nliney = (Y + posLine) | 0;
      // The shaped output places the text at Y, the plain one at Y less the size
      if (shapedOutput) nliney = (nliney - toInt32(roundHalfEven((fnt.size / CONS_PDFRES) * this.fResolution))) | 0;
      this.line(X, nliney, (X + lineWidth) | 0, nliney);
    }
  }

  /**
   * A line of a standard font: each character at the position the widths of the font give it, as a
   * PDF viewer places the glyphs of a string (no kerning), from the baseline.
   */
  private drawStandardText(X: number, baseline: number, text: string): void {
    const fnt = this.font;
    if (fnt.size <= 0) return;
    const family = standardFamily(this.families, fnt.name);
    if (family === null) {
      if (text.trim() !== '') this.skip('The ' + PDFFontType[fnt.name] + ' font is not drawn yet');
      return;
    }
    const c = this.c;
    // Symbol and ZapfDingbats have no bold or italic faces
    const symbolic = fnt.name === PDFFontType.Symbol || fnt.name === PDFFontType.ZafDingbats;
    c.font = (fnt.italic && !symbolic ? 'italic ' : '') + (fnt.bold && !symbolic ? 'bold ' : '') + String(fnt.size * TWIPS_PER_POINT) + 'px ' + family;
    c.fillStyle = cssColor(fnt.color);
    // On the nearest pixel row, as text rasterizers place a horizontal baseline
    if (this.snapping) baseline = this.toEdge(baseline);
    let x = X;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const ch = standardChar(fnt.name, code & 0xff);
      if (ch !== '' && ch !== ' ') c.fillText(ch, x, baseline);
      const width = standardWidth(fnt.name, code & 0xff);
      x += (width === null ? this.calcCharWidth(code, null) : (width / 1000) * fnt.size) * TWIPS_PER_POINT;
    }
  }

  /** The face of the font data of a glyph. */
  private static faceOf(data: TTFontData | null): LogFontFt | null {
    const face = data?.logFont;
    return face === null || face === undefined ? null : (face as LogFontFt);
  }

  /**
   * A shaped line glyph by glyph (PDFCompatibleTextShaping): the font switched where an HTML run
   * or a fallback face changes it, each glyph at its position with the outline of its face, the
   * glyphs of a color filled together.
   */
  private drawShapedLine(adataIn: TTFontData | null, posX: number, posY: number, fontSize: number, lInfo: LineInfo): void {
    let adata = adataIn;
    const font = this.font;
    const c = this.c;
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
    let pathColor = -1;
    let pathOpen = false;
    const flush = (): void => {
      if (pathOpen) c.fill();
      pathOpen = false;
    };
    const glyphs = (lInfo.glyphs ?? []) as TGlyphPos[];
    // The baseline on the nearest pixel row, as text rasterizers place a horizontal one
    if (this.snapping) posY = this.toEdge(posY);
    try {
      for (const g of glyphs) {
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
        const face = PreviewCanvas.faceOf(faceData ?? adata);
        const absX = posX + cursor + g.xOffset;
        const absY = posY - g.yOffset;
        cursor += g.xAdvance;
        const outline = face === null ? null : this.outlines.outline(face, g.glyphIndex);
        if (outline === null) {
          if (face !== null && face.type1) this.skip('Type 1 fonts are not drawn yet');
          continue;
        }
        if (outline.commands.length === 0) continue;
        const color = g.hasColor ? g.color : originalColor;
        if (color !== pathColor) {
          flush();
          c.fillStyle = cssColor(color);
          pathColor = color;
        }
        if (!pathOpen) {
          c.beginPath();
          pathOpen = true;
        }
        // Font units, y up, scaled by the size the PDF writes with Tf
        const s = (font.size * TWIPS_PER_POINT) / outline.unitsPerEm;
        for (const cmd of outline.commands) {
          const a = cmd.args;
          switch (cmd.command) {
            case 'moveTo':
              c.moveTo(absX + (a[0] as number) * s, absY - (a[1] as number) * s);
              break;
            case 'lineTo':
              c.lineTo(absX + (a[0] as number) * s, absY - (a[1] as number) * s);
              break;
            case 'quadraticCurveTo':
              c.quadraticCurveTo(absX + (a[0] as number) * s, absY - (a[1] as number) * s, absX + (a[2] as number) * s, absY - (a[3] as number) * s);
              break;
            case 'bezierCurveTo':
              c.bezierCurveTo(
                absX + (a[0] as number) * s,
                absY - (a[1] as number) * s,
                absX + (a[2] as number) * s,
                absY - (a[3] as number) * s,
                absX + (a[4] as number) * s,
                absY - (a[5] as number) * s,
              );
              break;
            case 'closePath':
              c.closePath();
              break;
          }
        }
      }
      flush();
    } finally {
      if (actualFontFamily !== originalFontFamily || actualBold !== originalBold || actualItalic !== originalItalic || actualFontSize !== originalFontSize) {
        font.wFontName = originalFontFamily;
        font.lFontName = originalFontFamily;
        font.bold = originalBold;
        font.italic = originalItalic;
        font.style = (originalBold ? 1 : 0) + (originalItalic ? 2 : 0) + (font.underline ? 4 : 0) + (font.strikeOut ? 8 : 0);
        font.size = Math.trunc(originalFontSize);
        this.updateFonts();
      }
    }
  }

  /**
   * An image in a rectangle (DrawImage). dpires 0 stretches it to the rectangle; otherwise it has
   * its size at that resolution, centered when smaller. tile repeats it and clip clips to the
   * rectangle. C# parity, as the PDF draws it: the clipping rectangle takes the width and height as
   * the right and bottom coordinates; after the first tile of a row the scale of a tile is its left
   * coordinate and the tiles stop past the width plus one tile; the clipping is never undone, it
   * stays for the rest of the page (the preview restores it when the page ends).
   */
  drawImage(rec: Rectangle, prepared: PreparedImage, image: CanvasImage | null, dpires: number, tile: boolean, clip: boolean): void {
    const c = this.c;
    let arect = rec;
    if (dpires !== 0) {
      const arec = { ...rec };
      rec = {
        left: rec.left,
        top: rec.top,
        width: toInt32(roundHalfEven((prepared.width / dpires) * this.fResolution)),
        height: toInt32(roundHalfEven((prepared.height / dpires) * this.fResolution)),
      };
      if (rec.width < arec.width) rec = { ...rec, left: (rec.left + intDiv((arec.width - rec.width) | 0, 2)) | 0 };
      if (rec.height < arec.height) rec = { ...rec, top: (rec.top + intDiv((arec.height - rec.height) | 0, 2)) | 0 };
      arect = rec;
    }
    if (clip) {
      // The q of the PDF that is never closed
      this.save();
      c.beginPath();
      c.rect(arect.left, arect.top, (arect.width - arect.left) | 0, (arect.height - arect.top) | 0);
      c.clip();
    }
    const awidth = rec.width;
    const aheight = rec.height;
    if (awidth <= 0) tile = false;
    if (aheight <= 0) tile = false;
    const draw = image !== null && prepared.width > 0 && prepared.height > 0;
    if (draw && c.imageSmoothingEnabled !== undefined) {
      // A PDF image does not ask for interpolation: viewers smooth it, but not when it is
      // enlarged four times or more (poppler's rule), so the pixels of a small image stay sharp
      const k = this.devicePixelsPerTwip;
      c.imageSmoothingEnabled = !(Math.floor(Math.abs(rec.width) * k) / prepared.width >= 4 || Math.floor(Math.abs(rec.height) * k) / prepared.height >= 4);
    }
    do {
      rec = { left: arect.left, top: rec.top, width: awidth, height: aheight };
      do {
        if (draw) {
          if (this.snapping) {
            // On pixel boundaries, as viewers place an image, so tiles and edges stay sharp
            const [l, r] = this.span(rec.left, rec.left + rec.width);
            const [t, b] = this.span(rec.top, rec.top + rec.height);
            c.drawImage(image, l, t, r - l, b - t);
          } else c.drawImage(image, rec.left, rec.top, rec.width, rec.height);
        }
        if (!tile) break;
        rec = { left: (rec.left + awidth) | 0, top: rec.top, width: (rec.left + awidth) | 0, height: rec.height };
      } while (rec.width <= ((arect.width + awidth) | 0));
      if (!tile) break;
      rec = { left: rec.left, top: (rec.top + aheight) | 0, width: rec.width, height: (rec.top + aheight) | 0 };
    } while (rec.height <= ((arect.height + aheight) | 0));
  }
}
