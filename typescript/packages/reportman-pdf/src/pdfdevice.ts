import {
  MetaObjectDraw,
  MetaObjectText,
  MetaObjectType,
  OrientationType,
  PDFConformanceType,
  PDFFontType,
  PageSizeArray,
  PrintOut,
  PrinterFontsType,
  ShapeType,
  TWIPS_PER_INCH,
  intDiv,
  roundHalfEven,
  toInt32,
} from 'reportman-metafile';
import type {
  DevicePageSize,
  LineInfo,
  MetaFile,
  MetaObject,
  MetaPage,
  PageSizeDetail,
  Point,
  TextExtentLines,
  TextObjectStruct,
} from 'reportman-metafile';
import { StandardTextMeasurer } from 'reportman-text';
import { ImageNotSupportedError } from './pdfcanvas.js';
import { PDFA3_NOT_SUPPORTED, PDFFile, systemClock } from './pdffile.js';
import type { PdfClock } from './pdffile.js';

const RECTANGLE_RADIUS = 160;

/** Options of a PdfDevice. */
export interface PdfDeviceOptions {
  /** Flate compress the content streams (Compressed). */
  compressed?: boolean;
  /** The clock for the dates of a document without them (the host's clock by default). */
  clock?: PdfClock;
}

/**
 * The PDF device with the standard 14 fonts (PrintOutPDFBase with the PrintOutPDFStandard
 * providers): the layout device the report engine measures through, and the device that writes a
 * metafile as a PDF. Text is measured with the width tables of reportman-text; there is no font
 * provider, so Linked and Embedded fonts become Helvetica and nothing is embedded.
 *
 * Not ported yet, and failing with a clear error: images (ImageNotSupportedError), PDF/A-3, and
 * the texts that need the shaper (right to left, HTML, printer fonts Recalculate).
 */
export class PdfDevice extends PrintOut {
  private fPDFFile: PDFFile;
  private fPageWidth = 11904;
  private fPageHeight = 16836;
  private fPageRealWidth: number;
  private fPageRealHeight: number;
  private pageQt = 0;
  private metaFile: MetaFile | null = null;
  private fPDFConformance: PDFConformanceType = PDFConformanceType.PDF_1_4;
  private readonly measurer: StandardTextMeasurer;
  /** The PDF is not generated, but every size is calculated. */
  calculateOnly = false;
  /** Flate compress the content streams. */
  compressed: boolean;
  /** The clock for the dates of the document. */
  clock: PdfClock;

  constructor(options: PdfDeviceOptions = {}) {
    super();
    this.compressed = options.compressed ?? false;
    this.clock = options.clock ?? systemClock;
    this.fPDFFile = new PDFFile();
    this.fPDFFile.clock = this.clock;
    this.fPageRealWidth = this.fPageWidth;
    this.fPageRealHeight = this.fPageHeight;
    this.measurer = new StandardTextMeasurer(
      () => this.fPDFFile.canvas,
      () => this.syncForceShaping(),
    );
  }

  /** The PDF document being written (a new one for each newDocument). */
  get pdfFile(): PDFFile {
    return this.fPDFFile;
  }

  /** The PDF bytes, after endDocument (PDFStream). */
  get pdfBytes(): Uint8Array {
    const bytes = this.fPDFFile.mainPDF;
    if (bytes === null) throw new Error('No PDF document was generated');
    return bytes;
  }

  /** PDF conformance level. */
  get pdfConformance(): PDFConformanceType {
    return this.fPDFConformance;
  }
  set pdfConformance(value: PDFConformanceType) {
    this.fPDFConformance = value;
    this.fPDFFile.pdfConformance = value;
  }

  /** Measure every text with the shaper (the printer fonts Recalculate mode, not supported). */
  get forceComplexShaping(): boolean {
    return this.fPDFFile.canvas.forceComplexShaping;
  }
  set forceComplexShaping(value: boolean) {
    this.fPDFFile.canvas.forceComplexShaping = value;
  }

  /** The lines of the last measurement that asked for them. */
  get lineInfo(): LineInfo[] {
    return this.fPDFFile.canvas.lineInfo;
  }

  /** Starts the PDF document of a metafile: its metadata, page size and orientation. */
  override newDocument(meta: MetaFile): void {
    this.metaFile = meta;
    if (meta.pdfConformance !== PDFConformanceType.PDF_1_4) throw new Error(PDFA3_NOT_SUPPORTED);
    this.fPDFFile = new PDFFile();
    this.fPDFFile.clock = this.clock;
    this.fPDFFile.compressed = this.compressed;
    this.fPDFFile.pdfConformance = meta.pdfConformance;
    this.fPDFFile.docTitle = meta.docTitle;
    this.fPDFFile.docAuthor = meta.docAuthor;
    this.fPDFFile.docCreator = meta.docCreator;
    this.fPDFFile.docKeywords = meta.docKeywords;
    this.fPDFFile.docSubject = meta.docSubject;
    this.fPDFFile.docProducer = meta.docProducer;
    this.fPDFFile.docCreationDate = meta.docCreationDate;
    this.fPDFFile.docModificationDate = meta.docModificationDate;
    this.fPDFFile.docXMPContent = meta.docXMPContent;
    this.fPDFFile.pageWidth = meta.customX;
    this.fPDFFile.pageHeight = meta.customY;
    this.fPageWidth = meta.customX;
    this.fPageHeight = meta.customY;
    this.fOrientation = meta.orientation;
    if (this.fOrientation === OrientationType.Landscape) {
      this.fPageRealWidth = meta.customY;
      this.fPageRealHeight = meta.customX;
    } else {
      this.fPageRealWidth = meta.customX;
      this.fPageRealHeight = meta.customY;
    }
    for (const efile of meta.embeddedFiles) this.fPDFFile.embeddedFiles.push(efile.clone());
    // Printer fonts Recalculate asks for the shaped measurement (not supported: it fails)
    if (meta.printerFonts === PrinterFontsType.Recalculate) this.forceComplexShaping = true;
    this.fPDFFile.calculateOnly = this.calculateOnly;
    this.fPDFFile.beginDoc();
  }

  /** The shaper is forced for printer fonts Recalculate before the layout too. */
  override preparePrint(meta: MetaFile): boolean {
    if (meta.printerFonts === PrinterFontsType.Recalculate) this.forceComplexShaping = true;
    return super.preparePrint(meta);
  }

  private syncForceShaping(): void {
    if (this.fPDFFile.canvas.forceComplexShaping) return;
    const nmeta = this.currentMetafile ?? this.metaFile;
    if (nmeta !== null && nmeta.printerFonts === PrinterFontsType.Recalculate) this.fPDFFile.canvas.forceComplexShaping = true;
  }

  /** Completes the PDF document. */
  override endDocument(_meta: MetaFile): void {
    this.fPDFFile.endDoc();
  }

  /** Starts a page of the PDF, with the size of the page when it has its own. */
  override newPage(_meta: MetaFile, page: MetaPage): void {
    if (page.updatedPageSize) {
      this.fPageRealWidth = page.pageDetail.physicWidth;
      this.fPageRealHeight = page.pageDetail.physicHeight;
      if (page.orientation === OrientationType.Landscape) {
        this.fPageWidth = page.pageDetail.physicHeight;
        this.fPageHeight = page.pageDetail.physicWidth;
      } else {
        this.fPageWidth = page.pageDetail.physicWidth;
        this.fPageHeight = page.pageDetail.physicHeight;
      }
    }
    this.fPDFFile.newPage(this.fPageWidth, this.fPageHeight);
  }

  private get meta(): MetaFile {
    if (this.metaFile === null) throw new Error('PdfDevice: newDocument was not called');
    return this.metaFile;
  }

  /**
   * Draws an object of a page (DrawObject): texts and shapes. An image fails (not ported yet);
   * polygons, export data and barcodes are not drawn by the C# PDF device either.
   */
  drawObject(page: MetaPage, obj: MetaObject): void {
    if (this.calculateOnly) return;
    const canvas = this.fPDFFile.canvas;
    const posx = obj.left;
    const posy = obj.top;
    switch (obj.metaType) {
      case MetaObjectType.Text: {
        if (!(obj instanceof MetaObjectText)) throw new TypeError('A text object is not a MetaObjectText');
        const meta = this.meta;
        this.syncForceShaping();
        const font = canvas.font;
        font.wFontName = page.getWFontNameText(obj);
        font.lFontName = page.getLFontNameText(obj);
        font.style = obj.fontStyle;
        if (meta.pdfConformance === PDFConformanceType.PDF_A_3) font.name = PDFFontType.Embedded;
        else font.name = obj.type1Font;
        // C# parity: the C# engine sets the font name again, PDF/A-3 or not
        font.name = obj.type1Font;
        // Exact parity mode (printer fonts Recalculate): standard fonts through the linked pipeline
        if (
          meta.printerFonts === PrinterFontsType.Recalculate &&
          meta.pdfConformance !== PDFConformanceType.PDF_A_3 &&
          font.name !== PDFFontType.Embedded
        )
          font.name = PDFFontType.Linked;
        font.size = obj.fontSize;
        font.color = obj.fontColor;
        font.bold = (obj.fontStyle & 1) > 0;
        font.italic = (obj.fontStyle & 2) > 0;
        font.underline = (obj.fontStyle & 4) > 0;
        font.strikeOut = (obj.fontStyle & 8) > 0;
        font.backColor = obj.backColor;
        font.transparent = obj.transparent;
        canvas.updateFonts();
        const rec = { left: posx, top: posy, width: obj.width, height: obj.height };
        const astring = page.getText(obj);
        canvas.textRect(rec, astring, obj.alignment, obj.cutText, obj.wordWrap, obj.fontRotation, obj.rightToLeft, obj.isHtml);
        const annotation = page.getAnnotationText(obj);
        if (annotation !== null) this.fPDFFile.newAnnotation(posx, posy, obj.width, obj.height, annotation);
        break;
      }
      case MetaObjectType.Draw: {
        if (!(obj instanceof MetaObjectDraw)) throw new TypeError('A draw object is not a MetaObjectDraw');
        const width = obj.width;
        const height = obj.height;
        canvas.brushStyle = obj.brushStyle;
        canvas.penStyle = obj.penStyle;
        canvas.penColor = obj.penColor;
        canvas.brushColor = obj.brushColor;
        canvas.penWidth = obj.penWidth;
        let X = intDiv(canvas.penWidth, 2);
        let Y = X;
        let W = (width - canvas.penWidth + 1) | 0;
        let H = (height - canvas.penWidth + 1) | 0;
        if (canvas.penWidth === 0) {
          W--;
          H--;
        }
        const S = W < H ? W : H;
        const shape = obj.drawStyle as ShapeType;
        if (shape === ShapeType.Square || shape === ShapeType.RoundSquare || shape === ShapeType.Circle) {
          X = (X + intDiv(W - S, 2)) | 0;
          Y = (Y + intDiv(H - S, 2)) | 0;
          W = S;
          H = S;
        }
        switch (shape) {
          case ShapeType.Rectangle:
          case ShapeType.Square:
            canvas.rectangle(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.RoundRect:
          case ShapeType.RoundSquare:
            canvas.roundedRectangle(X + posx, Y + posy, X + posx + W, Y + posy + H, RECTANGLE_RADIUS);
            break;
          case ShapeType.Ellipse:
          case ShapeType.Circle:
            canvas.ellipse(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.HorzLine:
            canvas.line(X + posx, Y + posy, X + posx + W, Y + posy);
            break;
          case ShapeType.VertLine:
            canvas.line(X + posx, Y + posy, X + posx, Y + posy + H);
            break;
          case ShapeType.Oblique1:
            canvas.line(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.Oblique2:
            canvas.line(X + posx, Y + posy + H, X + posx + W, Y + posy);
            break;
        }
        const drawAnnotation = page.getAnnotationText(obj);
        // C# parity: the width and height given are the right and bottom coordinates
        if (drawAnnotation !== null)
          this.fPDFFile.newAnnotation(posx + X, Y + posy, posx + X + W, posy + Y + H, drawAnnotation);
        break;
      }
      case MetaObjectType.Image:
        throw new ImageNotSupportedError();
    }
  }

  /** Draws every object of a page. */
  override drawPage(_meta: MetaFile, page: MetaPage): void {
    for (const obj of page.objects) this.drawObject(page, obj);
  }

  /**
   * Writes the pages of a metafile, from fromPage to toPage, as a PDF (Print): the first page in
   * the page the document starts with, the size of the others from the first page detail or
   * their own. False when the metafile has fewer pages than fromPage (the document is left
   * incomplete, as in C#).
   */
  override print(meta: MetaFile): boolean {
    const aresult = super.print(meta);
    let fCurrentPage = this.fromPage - 1;
    if (meta.pages.currentCount < this.fromPage) return false;
    this.setOrientation(meta.orientation);
    this.setPageSize(meta.pages.get(0).pageDetail);
    while (meta.pages.currentCount > fCurrentPage) {
      const apage = meta.pages.get(fCurrentPage);
      if (apage.updatedPageSize) {
        this.setOrientation(apage.orientation);
        this.setPageSize(apage.pageDetail);
      }
      if (fCurrentPage >= this.fromPage) this.newPage(meta, apage);
      this.drawPage(meta, apage);
      fCurrentPage++;
      if (fCurrentPage > this.toPage - 1) break;
    }
    this.endDocument(meta);
    return aresult;
  }

  /** The extent of a word with the current font of the canvas (WordExtent). */
  wordExtent(text: string, extent: Point): Point {
    return this.measurer.wordExtent(text, extent);
  }

  /** The extent and lines of a word with the current font (WordExtentLineInfo). */
  wordExtentLineInfo(text: string, extent: Point, rightToLeft = false): TextExtentLines & { lines: LineInfo[] } {
    return this.measurer.wordExtentLineInfo(text, extent, rightToLeft);
  }

  /** The extent of a text (TextExtent); a rotated text gives the extent back. */
  override textExtent(aobj: TextObjectStruct, extent: Point): Point {
    return this.measurer.textExtent(aobj, extent);
  }

  /** The extent and lines of a text (TextExtentLineInfo, both C# overloads). */
  override textExtentLineInfo(aobj: TextObjectStruct, extent: Point): TextExtentLines & { lines: LineInfo[] } {
    return this.measurer.textExtentLineInfo(aobj, extent);
  }

  /** The extent of an image: images are not ported yet (GraphicExtent). */
  override graphicExtent(_stream: Uint8Array, _extent: Point, _dpi: number): Point {
    throw new ImageNotSupportedError();
  }

  /** Sets the orientation: swaps the page width and height for landscape. */
  override setOrientation(pageOrientation: OrientationType): void {
    if (pageOrientation === this.fOrientation) return;
    if (pageOrientation === OrientationType.Default) return;
    if (pageOrientation === OrientationType.Portrait) {
      this.fOrientation = pageOrientation;
      this.fPageWidth = this.fPageRealWidth;
      this.fPageHeight = this.fPageRealHeight;
    } else {
      this.fOrientation = pageOrientation;
      this.fPageWidth = this.fPageRealHeight;
      this.fPageHeight = this.fPageRealWidth;
    }
  }

  /** Sets the page size, a predefined one or a custom one; returns the size in twips. */
  override setPageSize(psize: PageSizeDetail): Point {
    let newwidth: number;
    let newheight: number;
    this.pageQt = psize.index;
    if (psize.custom) {
      this.pageQt = -1;
      newwidth = psize.customWidth;
      newheight = psize.customHeight;
    } else {
      const size = PageSizeArray[psize.index];
      if (size === undefined) throw new RangeError('Index was outside the bounds of the array.');
      newwidth = toInt32(roundHalfEven((size[0] / 1000) * TWIPS_PER_INCH));
      newheight = toInt32(roundHalfEven((size[1] / 1000) * TWIPS_PER_INCH));
    }
    this.fPageRealWidth = newwidth;
    this.fPageRealHeight = newheight;
    if (this.fOrientation === OrientationType.Landscape) {
      this.fPageWidth = newheight;
      this.fPageHeight = newwidth;
    } else {
      this.fPageWidth = newwidth;
      this.fPageHeight = newheight;
    }
    return { x: this.fPageWidth, y: this.fPageHeight };
  }

  /** The page size and its index (-1 custom). */
  override getPageSize(): DevicePageSize {
    return { size: { x: this.fPageWidth, y: this.fPageHeight }, indexqt: this.pageQt };
  }
}
