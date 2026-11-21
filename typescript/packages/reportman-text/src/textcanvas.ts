import {
  PDFConformanceType,
  PDFFontType,
  PrintStepType,
  TWIPS_PER_INCH,
  newLineInfo,
  roundHalfEven,
  toInt32,
} from 'reportman-metafile';
import type { LineInfo, Rectangle } from 'reportman-metafile';
import { PDFFont } from './pdffont.js';
import { getStdLineSpacing } from './stdfonts.js';
import type { StdLineSpacing } from './stdfonts.js';
import {
  DEFAULT_FONT_WIDTH,
  HELVETICA_BOLDITALIC_WIDTHS,
  HELVETICA_BOLD_WIDTHS,
  HELVETICA_ITALIC_WIDTHS,
  HELVETICA_WIDTHS,
  TIMES_ROMAN_BOLDITALIC_WIDTHS,
  TIMES_ROMAN_BOLD_WIDTHS,
  TIMES_ROMAN_ITALIC_WIDTHS,
  TIMES_ROMAN_WIDTHS,
} from './widths.js';

/** PDF points per inch (PDFFile.CONS_PDFRES). */
export const CONS_PDFRES = 72;

/** The message of the C# engine when PDF/A-3 has no font provider. */
export const PDFA3_NO_FONT_PROVIDER = 'No info provider for fonts, pdf conformance A3 requires embedded fonts';

/** The error of a text that needs the shaper, which is not ported. */
export class ShaperNotSupportedError extends Error {
  constructor(what: string) {
    super(
      what +
        ' needs a text shaper and a font provider (DirectWrite / HarfBuzz in C#); only the standard 14 PDF fonts are supported yet',
    );
    this.name = 'ShaperNotSupportedError';
  }
}

/** The result of a text measurement: the lines and the extent. */
export interface TextExtentResult {
  lines: LineInfo[];
  /** The measured rectangle: the position of the input one, the width and height of the text. */
  rect: Rectangle;
}

function isSpecial(c: number): boolean {
  return c === 10 || c === 13 || c === 0;
}

function isSeparatorSign(c: number): boolean {
  return c === 0x2d || c === 0x20; // '-' or ' '
}

/**
 * The text measurement half of PDFCanvas, for the standard 14 PDF fonts: a font, the per line
 * results of the last measurement and the width tables. The PDF canvas extends it.
 *
 * This is the canvas of PrintOutPDFStandard: there is no font provider (InfoProvider is null),
 * so a Linked or Embedded font falls back to Helvetica, and the texts that need the shaper
 * (right to left, HTML, forced complex shaping) fail with ShaperNotSupportedError, where the C#
 * engine fails with a NullReferenceException.
 */
export class TextCanvas {
  private readonly fFont = new PDFFont();
  /**
   * Resolution of the device, twips per inch.
   * C# parity: the C# field Resolution is not used by the measurements (they use a private
   * copy fixed at 1440), so changing it has no effect here either.
   */
  resolution = TWIPS_PER_INCH;
  /** Twips per inch used by the measurements. */
  protected readonly fResolution = TWIPS_PER_INCH;
  /** PDF conformance level. */
  pdfConformance: PDFConformanceType = PDFConformanceType.PDF_1_4;
  /** Measure every text with the shaper (not supported: the measurement fails). */
  forceComplexShaping = false;
  /** The lines of the last measurement that asked for them. */
  protected lines: LineInfo[] = [];

  /** The font of the canvas. */
  get font(): PDFFont {
    return this.fFont;
  }

  /** The lines of the last measurement that asked for them (PDFCanvas.LineInfo). */
  get lineInfo(): LineInfo[] {
    return this.lines;
  }

  /**
   * The TrueType font data of the current font (GetTTFontData): never there without a font
   * provider; PDF/A-3 needs embedded fonts and fails.
   */
  getTTFontData(): null {
    if (this.pdfConformance === PDFConformanceType.PDF_1_4) {
      if (!(this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded)) return null;
    }
    if (this.pdfConformance === PDFConformanceType.PDF_A_3) throw new Error(PDFA3_NO_FONT_PROVIDER);
    return null;
  }

  /** Without a font provider a Linked or Embedded font becomes Helvetica (NormalizeFontForProvider). */
  normalizeFontForProvider(): void {
    if (this.pdfConformance === PDFConformanceType.PDF_A_3) return; // GetTTFontData reports it
    if (this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded)
      this.fFont.name = PDFFontType.Helvetica;
  }

  /**
   * Promotes a text outside WinAnsi to an embedded font (PromoteToUnicodeFontIfNeeded); without a
   * font provider it only normalizes the font.
   */
  promoteToUnicodeFontIfNeeded(_text: string): void {
    this.normalizeFontForProvider();
  }

  /** The text goes through the shaper: right to left and HTML text (UsesShaper). */
  usesShaper(rightToLeft: boolean, isHtml: boolean): boolean {
    return rightToLeft || isHtml;
  }

  /** The line spacing and leading of the current font. */
  getStdLineSpacing(): StdLineSpacing {
    return getStdLineSpacing(this.fFont.name);
  }

  /**
   * The width of a character in points (CalcCharWidth), from the table of the current font.
   * C# parity: the code unit is cut to its low byte ((byte)charcode), so € (U+20AC) measures as
   * 0xAC; the fonts without a table (Courier, Symbol, ZapfDingbats) and the codes below 32 use an
   * integer division, 600 * size / 1000.
   */
  calcCharWidth(charCode: number): number {
    if (isSpecial(charCode)) return 0.0;
    this.normalizeFontForProvider();
    if (
      this.fFont.name === PDFFontType.Linked ||
      this.fFont.name === PDFFontType.Embedded ||
      this.pdfConformance === PDFConformanceType.PDF_A_3
    ) {
      // InfoProvider.GetCharWidth, with no provider
      throw new Error(PDFA3_NO_FONT_PROVIDER);
    }
    let aarray: readonly number[] | null = null;
    let isdefault = true;
    switch (this.fFont.name) {
      case PDFFontType.Helvetica:
        isdefault = false;
        if (this.fFont.bold) aarray = this.fFont.italic ? HELVETICA_BOLDITALIC_WIDTHS : HELVETICA_BOLD_WIDTHS;
        else aarray = this.fFont.italic ? HELVETICA_ITALIC_WIDTHS : HELVETICA_WIDTHS;
        break;
      case PDFFontType.TimesRoman:
        isdefault = false;
        if (this.fFont.bold) aarray = this.fFont.italic ? TIMES_ROMAN_BOLDITALIC_WIDTHS : TIMES_ROMAN_BOLD_WIDTHS;
        else aarray = this.fFont.italic ? TIMES_ROMAN_ITALIC_WIDTHS : TIMES_ROMAN_WIDTHS;
        break;
    }
    const intvalue = charCode & 0xff;
    if (isdefault || intvalue < 32 || aarray === null) return Math.trunc((DEFAULT_FONT_WIDTH * this.fFont.size) / 1000);
    let aresult = aarray[intvalue - 32] as number;
    aresult = (aresult * this.fFont.size) / 1000;
    return aresult;
  }

  /**
   * Measures a text (PDFCanvas.TextExtent): the lines and the extent inside a rectangle (its width
   * wraps the text). The lines are a copy of the lines of the canvas, which are only updated when
   * dolineinfo is true.
   */
  textExtent(
    text: string,
    rect: Rectangle,
    wordbreak: boolean,
    singleline: boolean,
    dolineinfo: boolean,
    rightToLeft: boolean,
    isHtml = false,
  ): TextExtentResult {
    this.promoteToUnicodeFontIfNeeded(text);
    const useShaper = this.usesShaper(rightToLeft, isHtml);
    if (useShaper || this.forceComplexShaping) {
      if (useShaper) this.fFont.name = PDFFontType.Embedded;
      this.getTTFontData();
      throw new ShaperNotSupportedError(
        rightToLeft ? 'Right to left text' : isHtml ? 'HTML text' : 'Forced complex shaping (printer fonts Recalculate)',
      );
    }
    const nrect = this.textExtentSimple(text, rect, wordbreak, singleline, dolineinfo);
    return { lines: this.lines.map((l) => ({ ...l })), rect: nrect };
  }

  /**
   * The measurement with the width tables (TextExtentSimple): breaks the text in lines at the
   * line feeds and, with wordbreak, at the spaces and hyphens that fit, and returns the
   * rectangle with the extent (the left and top of the input one).
   */
  textExtentSimple(text: string, rect: Rectangle, wordbreak: boolean, singleline: boolean, dolineinfo: boolean): Rectangle {
    if (singleline) {
      wordbreak = false;
      text = text.replaceAll('\r\n', ' ').replaceAll('\n', ' ').replaceAll('\r', '');
    }
    // Leading and line spacing
    this.getTTFontData();
    const spacing = this.getStdLineSpacing();
    const fsize = this.fFont.size;
    const leading = toInt32(roundHalfEven((spacing.leading / 100000.0) * this.fResolution * fsize * 1.25));
    const linespacing = toInt32(roundHalfEven((spacing.lineSpacing / 100000.0) * this.fResolution * fsize * 1.25));

    let currentwidth = 0;
    let maxwidth = 0;
    let newsize = 0;
    let linebreakpos = 0;
    let wasspace = false;
    let infocount = 0;
    let lastsize = 0;
    let lastsizewithoutspace = 0;
    let lastindexwithoutspace = 0;
    let currenttoppos = 0;
    const recwidth = (rect.width / this.fResolution) * CONS_PDFRES;
    if (dolineinfo) this.lines = [];
    // Kill tabs, replace them with spaces
    const astring = text.replaceAll('\t', ' ');
    let i = 0;
    let startposition = 0;
    // A C# struct reused for every line: each Add copies it
    const linfo = newLineInfo();
    const addLine = (): void => {
      if (dolineinfo) this.lines.push({ ...linfo });
    };
    while (i < astring.length) {
      const c = astring.charCodeAt(i);
      if (c === 10) {
        // Add the line
        let cutindex = i;
        if (wasspace) {
          cutindex = lastindexwithoutspace + 1;
          currentwidth = lastsizewithoutspace;
        }
        linfo.lastLine = true;
        linfo.position = startposition;
        linfo.step = PrintStepType.cpi10;
        linfo.size = cutindex - startposition;
        if (i > 0) if (astring.charCodeAt(i - 1) === 13) linfo.size = linfo.size - 1;
        if (linfo.size < 0) linfo.size = 0;
        linfo.width = toInt32(roundHalfEven((currentwidth * this.fResolution) / CONS_PDFRES));
        if (currentwidth > maxwidth) maxwidth = currentwidth;
        linfo.topPos = currenttoppos - leading;
        linfo.height = linespacing;
        currenttoppos = currenttoppos + linespacing;
        addLine();
        infocount++;
        currentwidth = 0;
        startposition = i + 1;
      } else {
        newsize = this.calcCharWidth(c);
        // If the character fits inside the line
        if (currentwidth + newsize <= recwidth || !wordbreak) {
          if (c === 0x20) {
            if (!wasspace) {
              wasspace = true;
              lastsizewithoutspace = currentwidth;
              if (i > startposition) {
                lastindexwithoutspace = i - 1;
                linebreakpos = i - 1;
                lastsize = currentwidth;
              } else lastindexwithoutspace = 0;
            }
          } else {
            wasspace = false;
            if (isSeparatorSign(c)) {
              linebreakpos = i;
              lastsize = currentwidth + newsize;
            }
          }
          currentwidth = currentwidth + newsize;
        }
        // When the character does not fit
        else {
          if (wordbreak) {
            // Add the line
            if (currentwidth === 0 && startposition === i) i++;
            let cutindex = i;
            if (linebreakpos > 0) {
              cutindex = linebreakpos + 1;
              i = linebreakpos;
              currentwidth = lastsize;
            } else i--;
            if (wasspace) {
              cutindex = lastindexwithoutspace + 1;
              currentwidth = lastsizewithoutspace;
            }
            linfo.lastLine = false;
            linfo.position = startposition;
            linfo.step = PrintStepType.cpi10;
            linfo.size = cutindex - startposition;
            if (linfo.size < 0) linfo.size = 0;
            linfo.width = toInt32(roundHalfEven((currentwidth * this.fResolution) / CONS_PDFRES));
            if (currentwidth > maxwidth) maxwidth = currentwidth;
            linfo.topPos = currenttoppos - leading;
            linfo.height = linespacing;
            currenttoppos = currenttoppos + linespacing;
            addLine();
            infocount++;
            currentwidth = 0;
            linebreakpos = 0;
            startposition = i + 1;
            // Skip spaces
            while (startposition < astring.length - 1) {
              if (astring.charCodeAt(startposition) === 0x20) {
                startposition++;
                i = startposition - 1;
              } else break;
            }
          }
        }
      }
      i++;
    }
    if (startposition < astring.length) {
      // Add the line
      let cutindex = i;
      if (wasspace) {
        cutindex = lastindexwithoutspace + 1;
        currentwidth = lastsizewithoutspace;
      }
      linfo.lastLine = true;
      linfo.position = startposition;
      linfo.step = PrintStepType.cpi10;
      linfo.size = cutindex - startposition;
      if (linfo.size < 0) linfo.size = 0;
      linfo.width = toInt32(roundHalfEven((currentwidth * this.fResolution) / CONS_PDFRES));
      if (currentwidth > maxwidth) maxwidth = currentwidth;
      linfo.topPos = currenttoppos - leading;
      linfo.height = linespacing;
      currenttoppos = currenttoppos + linespacing;
      addLine();
      infocount++;
    }
    let totalheight = 0;
    if (infocount > 0) totalheight = infocount * linespacing + leading;
    return {
      left: rect.left,
      top: rect.top,
      width: toInt32(roundHalfEven((maxwidth * this.fResolution) / CONS_PDFRES)),
      height: totalheight,
    };
  }
}
