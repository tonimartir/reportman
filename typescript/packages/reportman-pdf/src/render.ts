import type { MetaFile } from 'reportman-metafile';
import { PdfDevice } from './pdfdevice.js';
import type { PdfDeviceOptions } from './pdfdevice.js';

/** Options of renderPdf. */
export interface RenderPdfOptions extends PdfDeviceOptions {
  /** First page to write, 1 based (1 by default). */
  fromPage?: number;
  /** Last page to write (every page by default). */
  toPage?: number;
}

/**
 * Writes a metafile as a PDF and returns its bytes (a PdfDevice printing the metafile): with the
 * standard 14 fonts, or with the embedded TrueType fonts of a font library (options.fonts). Fails
 * when the metafile has fewer pages than fromPage, where the C# device leaves an incomplete
 * document.
 */
export function renderPdf(meta: MetaFile, options: RenderPdfOptions = {}): Uint8Array {
  const device = new PdfDevice(options);
  if (options.fromPage !== undefined) device.fromPage = options.fromPage;
  if (options.toPage !== undefined) device.toPage = options.toPage;
  if (!device.print(meta)) throw new Error('The metafile has fewer pages than the first page to print');
  return device.pdfBytes;
}
