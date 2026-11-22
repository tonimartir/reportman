// Report Manager outputs of a metafile besides the PDF: CSV (PrintOutCSV of the C# engine), and
// SVG and HTML (the drivers of the Delphi engine, which the C# engine does not have). And the text
// of the line, dot matrix and receipt printers (PrintOutText of the C# engine), a layout device of
// its own: a report is run with a TextDevice, not written from the metafile of a PDF run.
export { metafileToCsv } from './csv.js';
export type { CsvOptions } from './csv.js';
export { metafileToSvg, windows1252Bytes, DelphiImageError } from './svg.js';
export type { SvgOptions, ExportedPage, ExportedPages } from './svg.js';
export { metafileToHtml, metafileToHtmlSingle } from './html.js';
export type { HtmlOptions, HtmlSingleOptions } from './html.js';
export {
  TextDevice,
  runReportToText,
  defaultTextPrinterConfig,
  decodeCp437,
  encodeOem,
  encodeUtf8,
  encodeLatin1,
  encodeEscPosQr,
  encodeEscPosPdf417,
  encodeEscPos1D,
  ESCPOS_DPI,
  isReceiptDriver,
  isTm88Driver,
} from './text.js';
export type { TextDeviceOptions, TextPrinterConfig, TextReportRun } from './text.js';
