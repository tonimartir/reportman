import { describe, expect, it } from 'vitest';
import { PDFConformanceType, PDFFontType, newTextObjectStruct } from 'reportman-metafile';
import {
  HELVETICA_WIDTHS,
  PDFA3_NO_FONT_PROVIDER,
  PDFFont,
  ShaperNotSupportedError,
  StandardTextMeasurer,
  TextCanvas,
  getStdLineSpacing,
  pdfNameOf,
  type1FontToPdfFontName,
  unicodeToWin1252,
  utf8Bytes,
  win1252Byte,
} from 'reportman-text';

describe('Windows-1252 (UnicodeToWin1252 of the C# engine)', () => {
  it('keeps ASCII and Latin-1, maps the 1252 specials and best fits the rest', () => {
    expect(unicodeToWin1252('Ñandú')).toBe('Ñandú');
    expect(unicodeToWin1252('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')).toBe(
      String.fromCharCode(0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f),
    );
    expect(unicodeToWin1252('Āα')).toBe('Aa');
    expect(unicodeToWin1252('ＡＢＣ')).toBe('ABC');
    expect(unicodeToWin1252('中')).toBe('?');
    // One byte per UTF-16 code unit: a surrogate pair is two question marks
    expect(unicodeToWin1252('😀')).toBe('??');
    expect(win1252Byte(0x80)).toBe(0x3f); // U+0080 has no 1252 byte
    expect(win1252Byte(0x81)).toBe(0x81);
  });
});

describe('standard font helpers', () => {
  it('names the standard font resources', () => {
    const P = PDFConformanceType.PDF_1_4;
    expect(type1FontToPdfFontName(PDFFontType.Helvetica, false, false, 'Arial', 0, P)).toBe('1');
    expect(type1FontToPdfFontName(PDFFontType.Helvetica, true, true, 'Arial', 3, P)).toBe('4');
    expect(type1FontToPdfFontName(PDFFontType.Courier, false, true, 'Arial', 1, P)).toBe('6');
    expect(type1FontToPdfFontName(PDFFontType.TimesRoman, true, false, 'Arial', 2, P)).toBe('11');
    expect(type1FontToPdfFontName(PDFFontType.Symbol, true, true, 'Arial', 3, P)).toBe('13');
    expect(type1FontToPdfFontName(PDFFontType.ZafDingbats, false, false, 'Arial', 0, P)).toBe('14');
    expect(type1FontToPdfFontName(PDFFontType.Linked, false, false, 'Arial', 1, P)).toBe('Arial1');
    expect(type1FontToPdfFontName(PDFFontType.Helvetica, false, false, '[FontFamily: Name=Arial]', 0, PDFConformanceType.PDF_A_3)).toBe(
      '#5BFontFamily:#20Name=Arial#5D0',
    );
  });
  it('writes PDF names and UTF-8', () => {
    expect(pdfNameOf('Times New Roman#1 (ñ)')).toBe('Times#20New#20Roman#231#20#28#C3#B1#29');
    expect(utf8Bytes('€😀\ud800')).toEqual([0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbf, 0xbd]);
  });
  it('has the line spacing of each font', () => {
    expect(getStdLineSpacing(PDFFontType.Helvetica)).toEqual({ lineSpacing: 1270, leading: 150 });
    expect(getStdLineSpacing(PDFFontType.Courier)).toEqual({ lineSpacing: 1265, leading: 133 });
    expect(getStdLineSpacing(PDFFontType.Linked)).toEqual({ lineSpacing: 1270, leading: 200 });
  });
  it('gives the platform family name of a font', () => {
    const f = new PDFFont();
    expect(f.name).toBe(PDFFontType.Courier);
    expect(() => f.getFontFamilyKey()).toThrow(TypeError);
    f.wFontName = 'Times New Roman';
    f.lFontName = 'Liberation Serif';
    expect(f.getFontFamilyKey()).toBe('TimesNewRoman');
    f.unixFamilyNames = true;
    expect(f.getFontFamily()).toBe('Liberation Serif');
  });
});

describe('CalcCharWidth', () => {
  it('measures with the tables, the low byte of the code unit', () => {
    const c = new TextCanvas();
    c.font.name = PDFFontType.Helvetica;
    c.font.size = 10;
    expect(c.calcCharWidth(0x41)).toBe((HELVETICA_WIDTHS[0x41 - 32]! * 10) / 1000);
    expect(c.calcCharWidth(0x20ac)).toBe(c.calcCharWidth(0xac)); // € measures as ¬
    expect(c.calcCharWidth(10)).toBe(0);
    expect(c.calcCharWidth(13)).toBe(0);
    expect(c.calcCharWidth(0)).toBe(0);
  });
  it('uses an integer division for the fonts without a table and the codes below 32', () => {
    const c = new TextCanvas();
    c.font.name = PDFFontType.Courier;
    c.font.size = 9;
    expect(c.calcCharWidth(0x41)).toBe(5); // 600 * 9 / 1000 = 5.4 -> 5
    c.font.name = PDFFontType.Helvetica;
    expect(c.calcCharWidth(1)).toBe(5);
  });
  it('turns Linked and Embedded into Helvetica', () => {
    const c = new TextCanvas();
    c.font.name = PDFFontType.Embedded;
    c.font.size = 10;
    expect(c.calcCharWidth(0x41)).toBe(6.67);
    expect(c.font.name).toBe(PDFFontType.Helvetica);
  });
});

describe('errors of the parts that are not ported', () => {
  const measurer = new StandardTextMeasurer();
  it('fails for right to left and HTML text (the shaper)', () => {
    expect(() => measurer.textExtent(newTextObjectStruct({ text: 'abc', fontSize: 10, rightToLeft: true }), { x: 1000, y: 0 })).toThrow(
      ShaperNotSupportedError,
    );
    expect(() => measurer.textExtentLineInfo(newTextObjectStruct({ text: '<b>a</b>', fontSize: 10, isHtml: true }), { x: 1000, y: 0 })).toThrow(
      /HTML text needs a text shaper/,
    );
  });
  it('fails for forced complex shaping (printer fonts Recalculate)', () => {
    const m = new StandardTextMeasurer();
    m.canvas.forceComplexShaping = true;
    expect(() => m.textExtent(newTextObjectStruct({ text: 'abc', fontSize: 10 }), { x: 1000, y: 0 })).toThrow(ShaperNotSupportedError);
  });
  it('fails for PDF/A-3, which needs embedded fonts', () => {
    const m = new StandardTextMeasurer();
    m.canvas.pdfConformance = PDFConformanceType.PDF_A_3;
    expect(() => m.textExtent(newTextObjectStruct({ text: 'abc', fontSize: 10 }), { x: 1000, y: 0 })).toThrow(PDFA3_NO_FONT_PROVIDER);
  });
  it('gives the extent back for rotated text, and measures words with the current font', () => {
    expect(measurer.textExtent(newTextObjectStruct({ text: 'abc', fontSize: 10, fontRotation: 900 }), { x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
    measurer.textExtent(newTextObjectStruct({ text: 'x', fontSize: 20, type1Font: PDFFontType.TimesRoman }), { x: 0, y: 0 });
    const w = measurer.wordExtent('Hello', { x: 0, y: 0 });
    const li = measurer.wordExtentLineInfo('Hello', { x: 0, y: 0 });
    expect(li.extent).toEqual(w);
    expect(li.lines.length).toBe(1);
    expect(measurer.lineInfo.length).toBe(1);
  });
});
