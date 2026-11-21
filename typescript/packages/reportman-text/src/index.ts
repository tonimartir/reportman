// reportman-text: text measurement with the standard 14 PDF fonts (their width tables, line
// spacing and the line breaking of the engine) and the Windows-1252 encoding of their texts, and
// the TrueType provider of the FreeType driver of the C# engine (font choice, metrics, shaped
// layout with fontkit and bidi-js, HTML text, font subsets).

export * from './widths.js';
export { PDFFont } from './pdffont.js';
export { getStdLineSpacing, type1FontToPdfFontName, pdfNameOf, utf8Bytes } from './stdfonts.js';
export type { StdLineSpacing } from './stdfonts.js';
export { unicodeToWin1252, win1252Byte } from './win1252.js';
export { TextCanvas, CONS_PDFRES, PDFA3_NO_FONT_PROVIDER, ShaperNotSupportedError, needsUnicodeFont } from './textcanvas.js';
export type { TextExtentResult } from './textcanvas.js';
export { StandardTextMeasurer } from './measurer.js';
// The TrueType provider
export { memoryFontFile } from './fonts/sources.js';
export type { FontFileSource, FontPlatform } from './fonts/sources.js';
export { FontLibrary, FontInfoFt, LogFontFt, detectScript, faceKeyOf, toUpperNet } from './fonts/fontinfoft.js';
export type { FontLibraryOptions, ProviderTextExtent } from './fonts/fontinfoft.js';
export { TTFontData, SortedNumberMap, newGlyphPos } from './fonts/ttfontdata.js';
export type { FontInfoProvider, GlyphInfo, TGlyphPos } from './fonts/ttfontdata.js';
export { CultureSortedMap, compareCulture } from './fonts/culturemap.js';
export { sfntGlyphCount, sfntIsCFF, sfntCFFTable, cffGlyphsAreCIDs } from './fonts/sfnt.js';
export { isWhiteSpaceNet } from './fonts/htmllayout.js';
export { BidiParagraph, UBIDI_DEFAULT_LTR, UBIDI_DEFAULT_RTL, mirroredCharacter } from './bidi.js';
export { HtmlTextParser } from './html/htmltextparser.js';
export type { HtmlFormatRun } from './html/htmltextparser.js';
