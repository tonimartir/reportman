import { PDFConformanceType, PDFFontType } from '@reportman/metafile';

/** Line spacing and leading of a standard font, in hundred thousandths of the font size × 1.25. */
export interface StdLineSpacing {
  lineSpacing: number;
  leading: number;
}

/**
 * The line spacing of a standard font, and no leading (PDFCanvas.GetStdLineSpacing): the height of
 * n lines is n line spacings, as in the Delphi engine since its "Normalize line spacing"
 * (2025-12-10). The leading (150 for Helvetica and Times, 133 Courier, 255 Symbol) was added once
 * to the height of every text and taken from the top of each line, which the drawing gave back.
 */
export function getStdLineSpacing(fontName: PDFFontType): StdLineSpacing {
  switch (fontName) {
    case PDFFontType.Helvetica:
      return { lineSpacing: 1270, leading: 0 };
    case PDFFontType.Courier:
      return { lineSpacing: 1265, leading: 0 };
    case PDFFontType.TimesRoman:
      return { lineSpacing: 1257, leading: 0 };
    case PDFFontType.Symbol:
      return { lineSpacing: 1450, leading: 0 };
    case PDFFontType.ZafDingbats:
      return { lineSpacing: 1200, leading: 0 };
    default:
      return { lineSpacing: 1270, leading: 0 };
  }
}

/** The UTF-8 bytes of a text, lone surrogates as U+FFFD (Encoding.UTF8.GetBytes). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function hex2(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * A text as a PDF name, without the leading / (PDFFile.PDFNameOf): white space, the delimiters
 * ( ) < > [ ] { } / %, the # and anything outside ! to ~ go as #xx of their UTF-8 bytes.
 */
export function pdfNameOf(name: string | null): string {
  let result = '';
  for (const b of utf8Bytes(name ?? '')) {
    if (b < 0x21 || b > 0x7e || '()<>[]{}/%#'.indexOf(String.fromCharCode(b)) >= 0) result += '#' + hex2(b);
    else result += String.fromCharCode(b);
  }
  return result;
}

/**
 * The resource name suffix of a font (/F + it, PDFCanvas.Type1FontTopdfFontName): the number of
 * a standard font (1 Helvetica ... 14 ZapfDingbats, with its bold / oblique variant), or the
 * family and style of a linked or embedded font as a PDF name.
 */
export function type1FontToPdfFontName(
  type1Font: PDFFontType,
  oblique: boolean,
  bold: boolean,
  wFontName: string,
  fontStyle: number,
  pdfConformance: PDFConformanceType,
): string {
  if (
    type1Font === PDFFontType.Linked ||
    type1Font === PDFFontType.Embedded ||
    pdfConformance === PDFConformanceType.PDF_A_3
  ) {
    return pdfNameOf(wFontName + String(fontStyle));
  }
  let avalue = 0;
  switch (type1Font) {
    case PDFFontType.Helvetica:
      avalue = 0;
      break;
    case PDFFontType.Courier:
      avalue = 4;
      break;
    case PDFFontType.TimesRoman:
      avalue = 8;
      break;
    case PDFFontType.Symbol:
      avalue = 12;
      break;
    case PDFFontType.ZafDingbats:
      avalue = 13;
      break;
  }
  if (type1Font === PDFFontType.Helvetica || type1Font === PDFFontType.Courier || type1Font === PDFFontType.TimesRoman) {
    if (bold) avalue = avalue + 1;
    if (oblique) avalue = avalue + 2;
  }
  return String(avalue + 1);
}
