import {
  PDFConformanceType,
  PDFFontType,
  PrintStepType,
  TWIPS_PER_INCH,
  newLineInfo,
  roundHalfEven,
  toInt32,
} from '@reportman/metafile';
import type { LineInfo, Rectangle } from '@reportman/metafile';
import { PDFFont } from './pdffont.js';
import { getStdLineSpacing, pdfNameOf } from './stdfonts.js';
import type { StdLineSpacing } from './stdfonts.js';
import type { FontInfoProvider } from './fonts/ttfontdata.js';
import { TTFontData } from './fonts/ttfontdata.js';
import { CultureSortedMap } from './fonts/culturemap.js';
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

/**
 * What a text the standard 14 PDF fonts cannot lay out says (the engine's HTML text check says the
 * same): it needs the TrueType provider, which the host gives with its fonts.
 */
export const NEEDS_TRUETYPE_FONTS =
  ' needs TrueType fonts, and the PDF has only the standard 14 PDF fonts: give it fonts (the fonts option of @reportman/node: ' +
  "fonts: {} for the fonts of the system, fonts: { folders: ['./fonts'] } for a folder of its own; reportman-pdf --fonts)";

/** The error of a text that needs the shaper and the TrueType provider, when there are no fonts. */
export class ShaperNotSupportedError extends Error {
  constructor(what: string) {
    super(what + NEEDS_TRUETYPE_FONTS);
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

/** Style.ToString("00000") of C#: five digits at least, the sign before them. */
function style00000(style: number): string {
  const s = String(Math.abs(style)).padStart(5, '0');
  return style < 0 ? '-' + s : s;
}

/**
 * StringUtil.NeedsUnicodeFont: a character Windows-1252 cannot hold, so a PDF standard font would
 * print it as '?'.
 */
export function needsUnicodeFont(s: string | null): boolean {
  if (s === null || s === '') return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x100) continue;
    switch (c) {
      case 0x20ac:
      case 0x201a:
      case 0x0192:
      case 0x201e:
      case 0x2026:
      case 0x2020:
      case 0x2021:
      case 0x02c6:
      case 0x2030:
      case 0x0160:
      case 0x2039:
      case 0x0152:
      case 0x017d:
      case 0x2018:
      case 0x2019:
      case 0x201c:
      case 0x201d:
      case 0x2022:
      case 0x2013:
      case 0x2014:
      case 0x02dc:
      case 0x2122:
      case 0x0161:
      case 0x203a:
      case 0x0153:
      case 0x017e:
      case 0x0178:
        continue;
      default:
        return true;
    }
  }
  return false;
}

/**
 * The text measurement half of PDFCanvas: a font, the per line results of the last measurement,
 * the width tables of the standard 14 fonts and, with a font provider, the TrueType font data of
 * the fonts used (FontData) and the shaped layout. The PDF canvas extends it.
 *
 * Without a font provider this is the canvas of PrintOutPDFStandard: a Linked or Embedded font
 * falls back to Helvetica, and the texts that need the shaper (right to left, HTML, forced complex
 * shaping) fail with ShaperNotSupportedError, where the C# engine fails with a
 * NullReferenceException. With the FreeType provider (FontInfoFt) it is the canvas of
 * PrintOutPDFFreeType: every text is shaped with an embedded TrueType font.
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
  /** Measure every text with the shaper (the printer fonts Recalculate mode). */
  forceComplexShaping = false;
  /** The lines of the last measurement that asked for them. */
  protected lines: LineInfo[] = [];
  /** The font provider (InfoProvider), null for the standard 14 fonts only. */
  readonly infoProvider: FontInfoProvider | null;
  /** The TrueType font data of the fonts used, by family and style (FontData). */
  readonly fontData = new CultureSortedMap<TTFontData>();
  /** How many faces got a resource of their own (DataForFace). */
  private facesWithResource = 0;

  constructor(infoProvider: FontInfoProvider | null = null) {
    this.infoProvider = infoProvider;
    // The family names of the platform of the provider (PDFFont.GetFontFamily)
    if (infoProvider !== null) this.fFont.unixFamilyNames = infoProvider.unixFamilyNames;
  }

  /** The font of the canvas. */
  get font(): PDFFont {
    return this.fFont;
  }

  /** The lines of the last measurement that asked for them (PDFCanvas.LineInfo). */
  get lineInfo(): LineInfo[] {
    return this.lines;
  }

  /**
   * The TrueType font data of the current font (GetTTFontData): none for a standard font in PDF
   * 1.4; without a font provider PDF/A-3 needs embedded fonts and fails.
   */
  getTTFontData(): TTFontData | null {
    if (this.pdfConformance === PDFConformanceType.PDF_1_4) {
      if (!(this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded)) return null;
    }
    if (this.infoProvider === null) {
      if (this.pdfConformance === PDFConformanceType.PDF_A_3) throw new Error(PDFA3_NO_FONT_PROVIDER);
      return null;
    }
    return this.updateFonts();
  }

  /**
   * The font data of the current font, created and filled the first time (UpdateFonts): by
   * family and style, with the resource name of the font; none for a standard font in PDF 1.4.
   */
  updateFonts(): TTFontData | null {
    if (this.pdfConformance !== PDFConformanceType.PDF_A_3) {
      if (!(this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded)) return null;
    }
    if (this.infoProvider === null) return null;
    const familyKey = this.fFont.getFontFamilyKey();
    const searchname = familyKey + style00000(this.fFont.style);
    let adata = this.fontData.get(searchname);
    if (adata === undefined) {
      adata = new TTFontData();
      adata.embedded = false;
      adata.objectName = pdfNameOf(familyKey + String(this.fFont.style));
      this.fontData.add(searchname, adata);
      adata.embedded = this.fFont.name === PDFFontType.Embedded || this.pdfConformance === PDFConformanceType.PDF_A_3;
      if (adata.embedded) adata.isUnicode = true;
      this.infoProvider.fillFontData(this.fFont, adata);
    }
    return adata;
  }

  /**
   * The font data of a face of its own, apart from its family (DataForFace): the glyphs shaped
   * with a face other than the one the family resolves to; null without a provider of faces.
   */
  dataForFace(faceKey: string | null): TTFontData | null {
    if (faceKey === null || faceKey === '' || this.infoProvider === null) return null;
    const searchname = 'cara:' + faceKey;
    const known = this.fontData.get(searchname);
    if (known !== undefined) return known;
    const adata = new TTFontData();
    adata.embedded = this.fFont.name === PDFFontType.Embedded || this.pdfConformance === PDFConformanceType.PDF_A_3;
    if (adata.embedded) adata.isUnicode = true;
    if (!this.infoProvider.fillFontDataForFace(this.fFont, adata, faceKey)) return null;
    this.facesWithResource++;
    adata.objectName = 'Cara' + String(this.facesWithResource);
    this.fontData.add(searchname, adata);
    return adata;
  }

  /** Without a font provider a Linked or Embedded font becomes Helvetica (NormalizeFontForProvider). */
  normalizeFontForProvider(): void {
    if (this.infoProvider !== null) return;
    if (this.pdfConformance === PDFConformanceType.PDF_A_3) return; // GetTTFontData reports it
    if (this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded)
      this.fFont.name = PDFFontType.Helvetica;
  }

  /**
   * Promotes a text outside WinAnsi to an embedded font (PromoteToUnicodeFontIfNeeded); without a
   * font provider it only normalizes the font.
   */
  promoteToUnicodeFontIfNeeded(text: string): void {
    this.normalizeFontForProvider();
    if (this.fFont.name === PDFFontType.Linked || this.fFont.name === PDFFontType.Embedded) return;
    if (this.infoProvider === null) return;
    if (needsUnicodeFont(text)) this.fFont.name = PDFFontType.Embedded;
  }

  /** The text goes through the shaper: right to left and HTML text, every text with FontInfoFt (UsesShaper). */
  usesShaper(rightToLeft: boolean, isHtml: boolean): boolean {
    return rightToLeft || isHtml || this.infoProvider?.providerName === 'FontInfoFt';
  }

  /** The line spacing and leading of the current font. */
  getStdLineSpacing(): StdLineSpacing {
    return getStdLineSpacing(this.fFont.name);
  }

  /**
   * The width of a character in points (CalcCharWidth): from the font provider for a TrueType
   * font, else from the table of the current standard font.
   * C# parity: the code unit is cut to its low byte ((byte)charcode), so € (U+20AC) measures as
   * 0xAC; the fonts without a table (Courier, Symbol, ZapfDingbats) and the codes below 32 use an
   * integer division, 600 * size / 1000.
   */
  calcCharWidth(charCode: number, fontdata: TTFontData | null = null): number {
    if (isSpecial(charCode)) return 0.0;
    this.normalizeFontForProvider();
    if (
      this.fFont.name === PDFFontType.Linked ||
      this.fFont.name === PDFFontType.Embedded ||
      this.pdfConformance === PDFConformanceType.PDF_A_3
    ) {
      if (this.infoProvider === null) throw new Error(PDFA3_NO_FONT_PROVIDER);
      if (fontdata === null) throw new TypeError('Object reference not set to an instance of an object.');
      const x = this.infoProvider.getCharWidth(this.fFont, fontdata, charCode);
      return (x * this.fFont.size) / 1000;
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
   * wraps the text). With the shaper (a font provider) the lines come from the provider, with
   * their glyphs; otherwise they are a copy of the lines of the canvas, which are only updated when
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
      const data = this.getTTFontData();
      const provider = this.infoProvider;
      if (provider === null)
        throw new ShaperNotSupportedError(
          rightToLeft ? 'Right to left text' : isHtml ? 'HTML text' : 'Forced complex shaping (printer fonts Recalculate)',
        );
      const r = { ...rect };
      const lines = provider.textExtent(text, r, this.fFont, data, wordbreak, singleline, this.fFont.size, isHtml, rightToLeft);
      return { lines, rect: r };
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
    const adata = this.getTTFontData();
    const spacing =
      adata !== null ? { lineSpacing: adata.ascent - adata.descent + adata.leading, leading: adata.leading } : this.getStdLineSpacing();
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
        newsize = this.calcCharWidth(c, adata);
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
