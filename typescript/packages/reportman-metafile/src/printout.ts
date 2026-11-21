import { MetaBarcodeSymbology, OrientationType, PrinterSelectType } from './enums.js';
import type { Point } from './geometry.js';
import type { MetaFile } from './metafile.js';
import type { MetaPage, PageSizeDetail } from './metapage.js';
import { PageSizeArray, pageSizeName } from './pagesizes.js';
import type { LineInfo, TextObjectStruct } from './textobject.js';

/** The lines of a measured text and its extent (TextExtentLineInfo with its ref extent). */
export interface TextExtentLines {
  /** The lines, or null when the device does not report them. */
  lines: LineInfo[] | null;
  /** The extent of the text, in twips. */
  extent: Point;
}

/** The page size of the device and its page size index (GetPageSize with its out index). */
export interface DevicePageSize {
  /** Width and height in twips. */
  size: Point;
  /** Index in PageSizeArray, -1 for a custom size. */
  indexqt: number;
}

/**
 * The layout device contract (PrintOut): what the report engine measures through while it lays
 * a report out, and what draws the pages of a metafile. A device for PDF, a preview, a printer...
 *
 * C# parity: in C# PreparePrint calls MetaFile.BeginPrint, which runs the report through the
 * OnBeginPrint event (and a NoDataToPrintException there reaches NoData / ProcessNoDataToPrint).
 * In TypeScript the engine fills the metafile before printing it, so preparePrint only starts
 * the document. The C# DrawChart draws with VectorChart when the device has no chart support:
 * here drawChart is optional and the engine draws the vector chart when a device lacks it.
 */
export abstract class PrintOut {
  /** Page sizes by index (the same table as MetaFile.PageSizeArray). */
  static readonly PageSizeArray = PageSizeArray;
  /** Default printer name used when no printer is selected. */
  static defaultPrinterName = '';
  /** The name of a page size index. */
  static pageSizeName(index: number): string {
    return pageSizeName(index);
  }

  /** A printer name that overrides any other printer selection. */
  forcePrinterName = '';
  /** The device renders a preview, not a print. */
  previewing = false;
  /** The metafile being processed. */
  currentMetafile: MetaFile | null = null;
  /** Maximum number of pages (to stop runaway reports). */
  protected PRINTOUT_MAX_PAGES = 100000;
  /** First page to print, 1 based. */
  fromPage = 1;
  /** Last page to print. */
  toPage: number;
  /** Number of copies. */
  copies = 0;
  /** Current orientation. */
  protected fOrientation: OrientationType = OrientationType.Portrait;
  /** Throw when there is no data to print. */
  emptyReportThrowException = false;
  /** Handler of no data to print: true when it handled it. */
  noData: (() => boolean) | null = null;
  /** The searched texts are drawn as a selection (preview). */
  protected drawFound = true;

  constructor() {
    this.toPage = this.PRINTOUT_MAX_PAGES;
  }

  /** Frees the resources of the device. */
  dispose(): void {}

  /** Starts a document. */
  newDocument(_meta: MetaFile): void {}

  /**
   * The device draws a barcode symbology by itself from its data. Asked while the report is
   * generated, so it must not depend on newDocument.
   */
  supportsNativeBarcode(_symbology: MetaBarcodeSymbology): boolean {
    return false;
  }

  /** Ends the document. */
  endDocument(_meta: MetaFile): void {}

  /** Starts a page. */
  newPage(_meta: MetaFile, _page: MetaPage): void {}

  /** Ends the current page. */
  endPage(_meta: MetaFile): void {}

  /** Draws a page. */
  abstract drawPage(meta: MetaFile, page: MetaPage): void;

  /** The extent of a text in twips, measured inside an extent (its width wraps the text). */
  abstract textExtent(aobj: TextObjectStruct, extent: Point): Point;

  /** The lines of a text and its extent; a device that does not report lines gives null. */
  textExtentLineInfo(_aobj: TextObjectStruct, extent: Point): TextExtentLines {
    return { lines: null, extent: { ...extent } };
  }

  /** The extent of an image in twips, at a resolution in dots per inch. */
  abstract graphicExtent(stream: Uint8Array, extent: Point, dpi: number): Point;

  /** Selects a printer. */
  selectPrinter(_printerSelect: PrinterSelectType): void {}

  /** Sets the page orientation. */
  setOrientation(pageOrientation: OrientationType): void {
    this.fOrientation = pageOrientation;
  }

  /**
   * Draws a chart with the device's own chart support; devices without it leave this undefined
   * and the engine draws the chart with metafile primitives (VectorChart in C#).
   */
  drawChart?(series: unknown, metafile: MetaFile, posx: number, posy: number, chart: unknown): void;

  /** Sets a page size; returns the page size in twips. */
  abstract setPageSize(psize: PageSizeDetail): Point;

  /** The default page size of the device. */
  abstract getPageSize(): DevicePageSize;

  /** Starts printing a metafile: remembers it and starts the document. */
  preparePrint(meta: MetaFile): boolean {
    this.currentMetafile = meta;
    this.newDocument(meta);
    return true;
  }

  /** What the device does when there is no data to print and nobody handled it. */
  protected processNoDataToPrint(): void {}

  /** Prints a metafile. */
  print(meta: MetaFile): boolean {
    return this.preparePrint(meta);
  }
}
