// Report Manager outputs of a metafile besides the PDF: CSV (PrintOutCSV of the C# engine), and
// SVG and HTML (the drivers of the Delphi engine, which the C# engine does not have).
export { metafileToCsv } from './csv.js';
export type { CsvOptions } from './csv.js';
export { metafileToSvg, windows1252Bytes, DelphiImageError } from './svg.js';
export type { SvgOptions, ExportedPage, ExportedPages } from './svg.js';
export { metafileToHtml, metafileToHtmlSingle } from './html.js';
export type { HtmlOptions, HtmlSingleOptions } from './html.js';
