// reportman-text: text measurement with the standard 14 PDF fonts (their width tables, line
// spacing and the line breaking of the engine) and the Windows-1252 encoding of their texts.

export * from './widths.js';
export { PDFFont } from './pdffont.js';
export { getStdLineSpacing, type1FontToPdfFontName, pdfNameOf, utf8Bytes } from './stdfonts.js';
export type { StdLineSpacing } from './stdfonts.js';
export { unicodeToWin1252, win1252Byte } from './win1252.js';
export { TextCanvas, CONS_PDFRES, PDFA3_NO_FONT_PROVIDER, ShaperNotSupportedError } from './textcanvas.js';
export type { TextExtentResult } from './textcanvas.js';
export { StandardTextMeasurer } from './measurer.js';
