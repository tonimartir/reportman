import { zlibSync } from 'fflate';
import { ByteBuffer, PDFConformanceType, TWIPS_PER_INCH } from 'reportman-metafile';
import type { EmbeddedFile } from 'reportman-metafile';
import { byteToHex2 } from './netformat.js';
import { PDFCanvas } from './pdfcanvas.js';
import { isoDateOf, localDigitsOf, pdfDateOf, pdfDateOfText, splitDocDate, zoneOfOffset } from './pdfdates.js';

/** An annotation of a page: a link (URL:...) or a text note (PDFFile.PDFAnnotation). */
export interface PDFAnnotation {
  /** PDF object number, assigned when it is written. */
  streamNumber: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  /** The payload: "URL:" and the link, or the text of a note. */
  annotation: string;
  /** 1 based page number. */
  page: number;
}

/** The clock of the host: the current instant and the local time zone offset of an instant. */
export interface PdfClock {
  /** The current instant. */
  now(): Date;
  /** The offset of the local time zone at an instant, in minutes east of UTC. */
  offsetMinutes(date: Date): number;
}

/** The clock of the JavaScript runtime (Date and its local time zone). */
export const systemClock: PdfClock = {
  now: () => new Date(),
  offsetMinutes: (date: Date) => -date.getTimezoneOffset(),
};

/** The message of the PDF/A-3 conformance, which is not ported. */
export const PDFA3_NOT_SUPPORTED = 'PDF/A-3 is not supported yet by the TypeScript PDF writer (reportman-pdf)';

/** Points per inch. */
export const POINTS_PER_INCH = 72;

/**
 * A PDF document (PDFFile) for the standard 14 fonts: the objects, the pages with their content
 * streams (Flate compressed or not), the fonts, the annotations, the embedded files, the
 * information dictionary, the cross reference table and the trailer. The document is built in
 * memory; the C# engine can also write it to a file (FileName), which is the host's job here.
 */
export class PDFFile {
  private resourceNum = 0;
  private catalogNum = 0;
  private outlinesNum = 0;
  private currentSetPageObject = 0;
  private infoCreationDate = '';
  private infoModDate = '';
  private xmpCreateDate = '';
  private xmpModifyDate = '';
  private pageObjNum = 0;
  private fPages: string[] = [];
  private readonly fSTempStream = new ByteBuffer(65536);
  private readonly fTempStream = new ByteBuffer(65536);
  private fMainPDF: ByteBuffer | null = null;
  private readonly fCanvas: PDFCanvas;
  private fPrinting = false;
  private fontCount = 0;
  private objectCount = 0;
  private pageInfos: { pageWidth: number; pageHeight: number }[] = [];
  private fResolution = TWIPS_PER_INCH;
  private objectOffsets: number[] = [];
  /** Running byte offset of the objects (the cross reference table). */
  objectOffset = 0;
  /** Skip the color operators that repeat the current color. */
  optimized = false;
  private fPage = 0;
  private parentNum = 0;
  private fontList: string[] = [];
  /** Write the content streams with Flate compression. */
  compressed = false;
  /** Compression favors size (level 9) over speed (level 1). */
  optimizeSize = true;
  /** Number of images: always 0, images are not ported. */
  readonly imageCount = 0;
  /** Current page height in twips. */
  pageHeight: number;
  /** Current page width in twips. */
  pageWidth: number;
  docTitle: string | null;
  docAuthor: string | null;
  docCreator: string | null;
  docKeywords: string | null;
  docSubject: string | null;
  docProducer: string | null;
  docXMPContent: string | null = null;
  /** Creation date, ISO 8601 or a PDF date; empty, or not a date, means now. */
  docCreationDate: string | null = null;
  /** Modification date; empty, or not a date, means the creation date. */
  docModificationDate: string | null = null;
  /** Only the sizes are calculated (affects the images only). */
  calculateOnly = false;
  private fPDFConformance: PDFConformanceType = PDFConformanceType.PDF_1_4;
  /** Files to embed. */
  embeddedFiles: EmbeddedFile[] = [];
  private readonly pageAnnotations = new Map<number, PDFAnnotation[]>();
  /** The clock for the dates of a document without them. */
  clock: PdfClock = systemClock;

  constructor() {
    this.docTitle = 'Report Manager Document';
    this.docAuthor = 'Report Manager engine';
    this.docCreator = this.docAuthor;
    this.docKeywords = '';
    this.docSubject = '';
    this.docProducer = this.docAuthor;
    this.fCanvas = new PDFCanvas();
    this.fCanvas.file = this;
    this.fCanvas.resolution = this.fResolution;
    this.pageWidth = 12048;
    this.pageHeight = 17039;
  }

  /** PDF conformance level, also the canvas one. */
  get pdfConformance(): PDFConformanceType {
    return this.fPDFConformance;
  }
  set pdfConformance(value: PDFConformanceType) {
    this.fPDFConformance = value;
    this.fCanvas.pdfConformance = value;
  }

  /** Resolution in twips per inch, also the canvas one (which does not use it: see TextCanvas). */
  get resolution(): number {
    return this.fResolution;
  }
  set resolution(value: number) {
    this.fResolution = value;
    this.fCanvas.resolution = value;
  }

  /** The document is being generated (between beginDoc and endDoc). */
  get printing(): boolean {
    return this.fPrinting;
  }

  /** The content stream of the current page. */
  get sTempStream(): ByteBuffer {
    return this.fSTempStream;
  }

  /** The canvas that writes the content streams. */
  get canvas(): PDFCanvas {
    return this.fCanvas;
  }

  /** The PDF bytes (after endDoc, the whole document); null before beginDoc. */
  get mainPDF(): Uint8Array | null {
    return this.fMainPDF === null ? null : this.fMainPDF.toUint8Array();
  }

  /** Writes a line: its characters as bytes and CR LF (PDF 1.4) or LF (StreamUtil.SWriteLine). */
  sWriteLine(stream: ByteBuffer, value: string): void {
    stream.writeLatin1(value);
    if (this.fPDFConformance === PDFConformanceType.PDF_1_4) {
      stream.writeByte(13);
      stream.writeByte(10);
    } else stream.writeByte(10);
  }

  private get main(): ByteBuffer {
    if (this.fMainPDF === null) throw new Error('Not printing (PDFFile.CheckPrinting)');
    return this.fMainPDF;
  }

  /** Adds an annotation of the current page: "URL:" and a link, or the text of a note. */
  newAnnotation(posx: number, posy: number, width: number, height: number, annotation: string): void {
    const ann: PDFAnnotation = { streamNumber: 0, posX: posx, posY: posy, width, height, page: this.fPage, annotation };
    let list = this.pageAnnotations.get(this.fPage);
    if (list === undefined) {
      list = [];
      this.pageAnnotations.set(this.fPage, list);
    }
    list.push(ann);
  }

  /** Fails when the document is not being generated. */
  checkPrinting(): void {
    if (!this.fPrinting) throw new Error('Not printing (PDFFile.CheckPrinting)');
  }

  private addToOffset(offset: number): void {
    this.objectOffset = this.objectOffset + offset;
    this.objectOffsets.push(this.objectOffset);
  }

  private flushTemp(): void {
    this.addToOffset(this.fTempStream.length);
    this.main.write(this.fTempStream.view());
  }

  private compress(data: Uint8Array, optimizeSize: boolean): Uint8Array {
    // BEST_COMPRESSION or BEST_SPEED of the C# Deflater, a zlib stream
    return zlibSync(data, { level: optimizeSize ? 9 : 1 });
  }

  private createFont(subtype: string, basefont: string, encoding: string): void {
    this.fontCount = this.fontCount + 1;
    this.objectCount = this.objectCount + 1;
    this.fontList.push(String(this.objectCount));
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Font');
    this.sWriteLine(t, '/Subtype /' + subtype);
    this.sWriteLine(t, '/Name /F' + String(this.fontCount));
    this.sWriteLine(t, '/BaseFont /' + basefont);
    this.sWriteLine(t, '/Encoding /' + encoding);
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  private setOutLine(): void {
    this.objectCount = this.objectCount + 1;
    this.outlinesNum = this.objectCount;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Outlines');
    this.sWriteLine(t, '/Count 0');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  private setPages(): void {
    this.objectCount = this.objectCount + 1;
    this.parentNum = this.objectCount;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Pages');
    this.sWriteLine(t, '/Kids [');
    for (let i = 1; i <= this.fPage; i++) {
      this.sWriteLine(t, String(this.objectCount + i + 1 + this.imageCount) + ' 0 R');
      this.fPages.push(String(this.pageObjNum));
      this.pageObjNum = this.pageObjNum + 2;
    }
    this.sWriteLine(t, ']');
    this.sWriteLine(t, '/Count ' + String(this.fPage));
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  private setFontType(): void {
    if (this.fPDFConformance === PDFConformanceType.PDF_1_4) {
      this.createFont('Type1', 'Helvetica', 'WinAnsiEncoding');
      this.createFont('Type1', 'Helvetica-Bold', 'WinAnsiEncoding');
      this.createFont('Type1', 'Helvetica-Oblique', 'WinAnsiEncoding');
      this.createFont('Type1', 'Helvetica-BoldOblique', 'WinAnsiEncoding');
      this.createFont('Type1', 'Courier', 'WinAnsiEncoding');
      this.createFont('Type1', 'Courier-Bold', 'WinAnsiEncoding');
      this.createFont('Type1', 'Courier-Oblique', 'WinAnsiEncoding');
      this.createFont('Type1', 'Courier-BoldOblique', 'WinAnsiEncoding');
      this.createFont('Type1', 'Times-Roman', 'WinAnsiEncoding');
      this.createFont('Type1', 'Times-Bold', 'WinAnsiEncoding');
      this.createFont('Type1', 'Times-Italic', 'WinAnsiEncoding');
      this.createFont('Type1', 'Times-BoldItalic', 'WinAnsiEncoding');
      this.createFont('Type1', 'Symbol', 'WinAnsiEncoding');
      this.createFont('Type1', 'ZapfDingbats', 'WinAnsiEncoding');
    }
    // The TrueType fonts of the canvas: none without a font provider
  }

  private startStream(): void {
    // Starting of the stream
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.pageObjNum = this.objectCount;
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Length ' + String(this.objectCount + 1) + ' 0 R');
    if (this.compressed) this.sWriteLine(t, '/Filter [/FlateDecode]');
    this.sWriteLine(t, ' >>');
    this.sWriteLine(t, 'stream');
    this.fSTempStream.setLength(0);
  }

  // Writes the content stream of the current page, its end and its length object
  private writeContentStream(): void {
    let streamSize = this.fSTempStream.length;
    if (this.compressed) {
      const packed = this.compress(this.fSTempStream.view(), this.optimizeSize);
      this.fTempStream.write(packed);
      streamSize = packed.length;
    } else this.fTempStream.write(this.fSTempStream.view());
    this.fSTempStream.setLength(0);
    this.sWriteLine(this.fTempStream, '\nendstream');
    this.sWriteLine(this.fTempStream, 'endobj');
    this.flushTemp();
    this.objectCount++;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, String(streamSize));
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  /** A PDF string: an escaped literal for ASCII text, UTF-16BE hexadecimal with BOM otherwise. */
  static encodePDFText(text: string | null | undefined): string {
    const s = text ?? '';
    let isASCII = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 127) {
        isASCII = false;
        break;
      }
    }
    if (isASCII) {
      let result = '(';
      for (const c of s) {
        switch (c) {
          case '(':
          case ')':
          case '\\':
            result += '\\' + c;
            break;
          default:
            result += c;
            break;
        }
      }
      return result + ')';
    }
    // UTF-16BE (lone surrogates replaced with U+FFFD, as the .NET encoder does)
    let hex = '<FEFF';
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (d >= 0xdc00 && d <= 0xdfff) {
          hex += byteToHex2(c >> 8) + byteToHex2(c) + byteToHex2(d >> 8) + byteToHex2(d);
          i++;
          continue;
        }
        c = 0xfffd;
      } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
      hex += byteToHex2(c >> 8) + byteToHex2(c);
    }
    return hex + '>';
  }

  /** Starts the document: the header, the information dictionary and the first page. */
  beginDoc(): void {
    if (this.fPDFConformance !== PDFConformanceType.PDF_1_4) throw new Error(PDFA3_NOT_SUPPORTED);
    this.fMainPDF = new ByteBuffer(65536);
    this.pageInfos = [{ pageWidth: this.pageWidth, pageHeight: this.pageHeight }];
    this.fPrinting = true;
    this.objectOffsets = [];
    this.objectCount = 0;
    this.objectOffset = 0;
    this.fPages = [];
    this.fontList = [];
    this.fontCount = 0;
    this.currentSetPageObject = 0;
    this.fPage = 1;
    this.fCanvas.pdfConformance = this.fPDFConformance;
    // The header
    this.sWriteLine(this.main, '%PDF-1.4');
    // The first object starts after the header as written
    this.addToOffset(this.main.length);
    this.computeDocDates();
    // The information dictionary
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<<');
    if (this.docProducer !== null && this.docProducer !== '')
      this.sWriteLine(t, '/Producer ' + PDFFile.encodePDFText(this.docProducer));
    this.sWriteLine(t, '/Author ' + PDFFile.encodePDFText(this.docAuthor));
    this.sWriteLine(t, '/CreationDate (' + this.infoCreationDate + ')');
    if (this.docCreator !== null && this.docCreator !== '')
      this.sWriteLine(t, '/Creator ' + PDFFile.encodePDFText(this.docCreator));
    if (this.docKeywords !== null && this.docKeywords.length > 0)
      this.sWriteLine(t, '/Keywords ' + PDFFile.encodePDFText(this.docKeywords));
    this.sWriteLine(t, '/Subject ' + PDFFile.encodePDFText(this.docSubject));
    this.sWriteLine(t, '/Title ' + PDFFile.encodePDFText(this.docTitle));
    this.sWriteLine(t, '/ModDate (' + this.infoModDate + ')');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
    this.startStream();
  }

  private computeDocDates(): void {
    let created = splitDocDate(this.docCreationDate);
    if (created === null) {
      const now = this.clock.now();
      const offset = this.clock.offsetMinutes(now);
      created = { digits: localDigitsOf(now, offset), zone: zoneOfOffset(offset) };
    }
    // A new document: modified when it was created, unless the report says otherwise
    let modified = splitDocDate(this.docModificationDate);
    if (modified === null) modified = { ...created };
    this.infoCreationDate = pdfDateOf(created.digits, created.zone);
    this.infoModDate = pdfDateOf(modified.digits, modified.zone);
    this.xmpCreateDate = isoDateOf(created.digits, created.zone);
    this.xmpModifyDate = isoDateOf(modified.digits, modified.zone);
  }

  /** The creation and modification dates of the document as PDF and as ISO 8601 dates. */
  get documentDates(): { infoCreationDate: string; infoModDate: string; xmpCreateDate: string; xmpModifyDate: string } {
    return {
      infoCreationDate: this.infoCreationDate,
      infoModDate: this.infoModDate,
      xmpCreateDate: this.xmpCreateDate,
      xmpModifyDate: this.xmpModifyDate,
    };
  }

  // The rest of a stream object, from its /Length on (WriteStream)
  private writeStream(stream: Uint8Array, dest: ByteBuffer): void {
    if (this.compressed) {
      // StreamUtil.CompressStream(Stream, MemoryStream): BEST_SPEED
      const fmem = this.compress(stream, false);
      this.sWriteLine(dest, ' /Length ' + String(fmem.length));
      this.sWriteLine(dest, '/Filter [/FlateDecode]');
      this.sWriteLine(dest, '>>');
      this.sWriteLine(dest, 'stream');
      dest.write(fmem);
    } else {
      this.sWriteLine(dest, ' /Length ' + String(stream.length));
      this.sWriteLine(dest, '>>');
      this.sWriteLine(dest, 'stream');
      dest.write(stream);
    }
    this.sWriteLine(dest, '');
    this.sWriteLine(dest, 'endstream');
  }

  private writeEmbeddedFiles(): void {
    for (const efile of this.embeddedFiles) {
      if (efile.stream === null) throw new TypeError('An embedded file has no content');
      this.objectCount++;
      const resourceStream = this.objectCount;
      const t = this.fTempStream;
      t.setLength(0);
      this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
      this.sWriteLine(t, '<< /Type /EmbeddedFile ');
      // The MIME type of the embedded file stream is its /Subtype
      if (efile.mimeType !== null && efile.mimeType.length > 0)
        this.sWriteLine(t, '   /Subtype /' + efile.mimeType.replaceAll('/', '#2F'));
      // The parameters of the file belong to the embedded file stream; the dates are PDF dates
      this.sWriteLine(t, '   /Params <<');
      this.sWriteLine(t, '   /Size ' + String(efile.stream.length));
      const efileCreationDate = pdfDateOfText(efile.creationDate);
      if (efileCreationDate.length > 0) this.sWriteLine(t, '   /CreationDate (' + efileCreationDate + ')');
      const efileModDate = pdfDateOfText(efile.modificationDate);
      if (efileModDate.length > 0) this.sWriteLine(t, '   /ModDate (' + efileModDate + ')');
      this.sWriteLine(t, '   >>');
      this.writeStream(efile.stream, t);
      this.sWriteLine(t, 'endobj');
      this.flushTemp();

      this.objectCount++;
      efile.resourceNumber = this.objectCount;
      t.setLength(0);
      this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
      this.sWriteLine(t, '<< /Type /Filespec ');
      this.sWriteLine(t, '   /F ' + PDFFile.encodePDFText(efile.fileName));
      this.sWriteLine(t, '   /Desc ' + PDFFile.encodePDFText(efile.description));
      this.sWriteLine(t, '   /UF ' + PDFFile.encodePDFText(efile.fileName));
      this.sWriteLine(
        t,
        '   /EF << /F ' + String(resourceStream) + ' 0 R /UF ' + String(resourceStream) + ' 0 R >>',
      );
      this.sWriteLine(t, '   /AFRelationship /' + efile.afRelationShipToString());
      this.sWriteLine(t, '>>');
      this.sWriteLine(t, 'endobj');
      this.flushTemp();
    }
  }

  /** Ends the content stream of the current page and starts a page of a size (twips). */
  newPage(nPageWidth: number, nPageHeight: number): void {
    this.checkPrinting();
    this.pageWidth = nPageWidth;
    this.pageHeight = nPageHeight;
    this.pageInfos.push({ pageWidth: nPageWidth, pageHeight: nPageHeight });
    this.fPage = this.fPage + 1;
    this.writeContentStream();
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Length ' + String(this.objectCount + 1) + ' 0 R');
    if (this.compressed) this.sWriteLine(t, '/Filter [/FlateDecode]');
    this.sWriteLine(t, ' >>');
    this.sWriteLine(t, 'stream');
  }

  private setArray(): void {
    this.objectCount = this.objectCount + 1;
    this.resourceNum = this.objectCount;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /ProcSet [ /PDF /Text /ImageC]');
    // No /XObject: images are not ported (ImageCount is 0)
    this.sWriteLine(t, '/Font << ');
    for (let i = 1; i <= this.fontCount; i++) this.sWriteLine(t, '/F' + String(i) + ' ' + (this.fontList[i - 1] as string) + ' 0 R ');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  /** Completes the document: fonts, annotations, pages, catalog, cross reference table. */
  endDoc(): void {
    this.checkPrinting();
    this.fPrinting = false;
    // The trailing zone
    this.writeContentStream();
    this.setOutLine();
    this.setFontType();
    this.addAnnotations();
    this.setPages();
    this.setArray();
    for (let i = 1; i <= this.fPage; i++) this.setPageObject(i);
    this.writeEmbeddedFiles();
    this.setCatalog();
    this.setXref();
    this.sWriteLine(this.main, '%%EOF');
  }

  private setCatalog(): void {
    this.objectCount = this.objectCount + 1;
    this.catalogNum = this.objectCount;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Catalog');
    this.sWriteLine(t, '/Pages ' + String(this.parentNum) + ' 0 R');
    this.sWriteLine(t, '/Outlines ' + String(this.outlinesNum) + ' 0 R');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  private static getOffsetNumber(offset: string): string {
    let result = '';
    for (let y = 1; y <= 10 - offset.length; y++) result += '0';
    return result + offset;
  }

  private setXref(): void {
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, 'xref');
    this.sWriteLine(t, '0 ' + String(this.objectCount));
    // Every entry is 20 bytes: PDF 1.4 ends them with CR LF
    this.sWriteLine(t, '0000000000 65535 f');
    for (let i = 0; i <= this.objectCount - 2; i++)
      this.sWriteLine(t, PDFFile.getOffsetNumber(String(this.objectOffsets[i])) + ' 00000 n');
    this.sWriteLine(t, 'trailer');
    this.sWriteLine(t, '<< /Size ' + String(this.objectCount));
    this.sWriteLine(t, '/Root ' + String(this.catalogNum) + ' 0 R');
    this.sWriteLine(t, '/Info 1 0 R');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'startxref');
    this.sWriteLine(t, String(this.main.length));
    this.main.write(t.view());
  }

  private addAnnotations(): void {
    const pages = [...this.pageAnnotations.keys()].sort((a, b) => a - b);
    for (const annPage of pages) {
      for (const annotation of this.pageAnnotations.get(annPage) as PDFAnnotation[]) {
        const t = this.fTempStream;
        t.setLength(0);
        this.objectCount = this.objectCount + 1;
        annotation.streamNumber = this.objectCount;
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        this.sWriteLine(t, '<< /Type /Annot');
        let anot = annotation.annotation;
        const c = this.fCanvas;
        const coords =
          c.unitsToTextX(annotation.posX) + ' ' + c.unitsToTextY((annotation.posY + annotation.height) | 0) + ' ' +
          c.unitsToTextX((annotation.posX + annotation.width) | 0) + ' ' + c.unitsToTextY(annotation.posY);
        if (anot.length > 4 && anot.substring(0, 4).toUpperCase() === 'URL:') {
          this.sWriteLine(t, '   /Subtype /Link');
          anot = anot.substring(4);
          this.sWriteLine(t, '   /Rect [' + coords + ']');
          this.sWriteLine(t, '   /A << /Type /Action');
          this.sWriteLine(t, '        /S /URI');
          this.sWriteLine(t, '        /URI ' + PDFFile.encodePDFText(anot));
          this.sWriteLine(t, '   >>');
        } else {
          this.sWriteLine(t, '   /Subtype /Text');
          this.sWriteLine(t, '   /Rect [' + coords + ']');
          this.sWriteLine(t, '   /Contents ' + PDFFile.encodePDFText(anot));
          this.sWriteLine(t, '   /Open false');
          this.sWriteLine(t, '   /C [1 1 0]');
        }
        this.sWriteLine(t, '>>');
        // C# parity: the annotation objects are written without endobj
        this.flushTemp();
      }
    }
  }

  private setPageObject(index: number): void {
    const aobj = this.pageInfos[index - 1];
    if (aobj === undefined) throw new RangeError('Index out of range on PageInfos collection');
    let annotationsString = '';
    const list = this.pageAnnotations.get(index);
    if (list !== undefined) {
      for (const annotation of list) {
        if (annotationsString.length === 0) annotationsString += '[';
        else annotationsString += ' ';
        annotationsString += String(annotation.streamNumber) + ' 0 R';
      }
    }
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Page');
    this.sWriteLine(t, '/Parent ' + String(this.parentNum) + ' 0 R');
    this.sWriteLine(
      t,
      '/MediaBox [ 0 0 ' + this.fCanvas.unitsToTextX(aobj.pageWidth) + ' ' + this.fCanvas.unitsToTextX(aobj.pageHeight) + ']',
    );
    this.sWriteLine(t, '/Contents ' + (this.fPages[this.currentSetPageObject] as string) + ' 0 R');
    this.sWriteLine(t, '/Resources ' + String(this.resourceNum) + ' 0 R');
    if (annotationsString.length > 0) {
      annotationsString += ']';
      this.sWriteLine(t, '/Annots ' + annotationsString);
    }
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
    this.currentSetPageObject = this.currentSetPageObject + 1;
  }
}
