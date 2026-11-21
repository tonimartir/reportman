import { zlibSync } from 'fflate';
import { ByteBuffer, PDFConformanceType, TWIPS_PER_INCH, roundHalfEven } from 'reportman-metafile';
import type { EmbeddedFile } from 'reportman-metafile';
import { cffGlyphsAreCIDs, pdfNameOf, sfntCFFTable, sfntIsCFF, type FontInfoProvider, type TTFontData } from 'reportman-text';
import { PDFCanvas } from './pdfcanvas.js';
import { encodePDFText, escapeXml, trimNet } from './pdfstrings.js';
import { formatFixed1, intToHex } from './netformat.js';
import { isoDateOf, localDigitsOf, pdfDateOf, pdfDateOfText, splitDocDate, zoneOfOffset } from './pdfdates.js';
import { srgbProfile } from './srgbprofile.js';

/** Whether a text can be declared for a code in the ToUnicode CMap (DestinoValido). */
function validTarget(text: string): boolean {
  if (text === '' || text.charCodeAt(0) < 0x20) return false;
  if (text.length === 1) {
    const c = text.charCodeAt(0);
    if (c >= 0xd800 && c <= 0xdfff) return false;
  }
  return true;
}

const intToHexPad = intToHex;

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

/**
 * A new document identifier, as the C# engine makes it (Guid.NewGuid without its dashes): a random
 * version 4 GUID, 32 lowercase hexadecimal digits.
 */
export function randomDocumentId(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?(array: Uint8Array): Uint8Array } }).crypto;
  if (crypto?.getRandomValues !== undefined) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  let id = '';
  for (const b of bytes) id += b.toString(16).padStart(2, '0');
  return id;
}

/** Points per inch. */
export const POINTS_PER_INCH = 72;

/**
 * A PDF document (PDFFile): the objects, the pages with their content streams (Flate compressed or
 * not), the fonts (the standard 14, and the embedded TrueType and OpenType fonts of a font
 * provider), the annotations, the embedded files, the information dictionary, the cross reference
 * table and the trailer; in PDF/A-3B also the XMP metadata, the sRGB output intent and the
 * associated files. The document is built in memory; the C# engine can also write it to a file
 * (FileName), which is the host's job here.
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
  private xmpMetadataObject = 0;
  private outputIntentObject = 0;
  private colorSpaceObject = 0;
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
  /** Number of images (and soft masks) embedded so far (ImageCount). */
  imageCount = 0;
  /** The images already embedded, by the key the caller gives (ImageIndexes: a shared image). */
  readonly imageIndexes = new Map<string, number>();
  /** The image and soft mask objects (their dictionary and stream), by image number - 1 (BitmapStreams). */
  readonly bitmapStreams: ByteBuffer[] = [];
  /** The images with a soft mask, by image number - 1: where the number of its object goes (Masks). */
  readonly masks = new Map<number, { stream: ByteBuffer; position: number }>();
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
  /**
   * The identifier of a PDF/A-3 document, the /ID of its trailer: hexadecimal digits, a random
   * GUID by default (Guid.NewGuid).
   */
  documentId: () => string = randomDocumentId;

  constructor(infoProvider: FontInfoProvider | null = null) {
    this.docTitle = 'Report Manager Document';
    this.docAuthor = 'Report Manager engine';
    this.docCreator = this.docAuthor;
    this.docKeywords = '';
    this.docSubject = '';
    this.docProducer = this.docAuthor;
    this.fCanvas = new PDFCanvas(infoProvider);
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

  /** Flate compression of an image stream (StreamUtil.CompressStreamTask, BEST_SPEED). */
  compressImage(data: Uint8Array): Uint8Array {
    return this.compress(data, false);
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
    const canvas = this.fCanvas;
    const fonts = canvas.fontData;
    const t = this.fTempStream;
    // The font files, descriptors and ToUnicode CMaps
    for (let i = 0; i < fonts.size; i++) {
      const adata = fonts.getByIndex(i);
      if (adata.embedded) {
        this.objectCount = this.objectCount + 1;
        t.setLength(0);
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        adata.fontProgramIsSubset = false;
        adata.cffKeepsCIDs = false;
        const provider = canvas.infoProvider;
        if (provider === null) throw new Error('No info provider for fonts');
        let fontcontent = provider.getFontStream(adata);
        if (adata.fontProgramIsSubset) adata.subsetTag = PDFFile.subsetTagOf(adata.postcriptName, i);
        else adata.subsetTag = '';
        // An OpenType font with CFF outlines goes as /FontFile3 (CIDFontType0) when its glyph numbers
        // are its CIDs; a CID-keyed subset that keeps its CIDs goes as its CFF alone (/CIDFontType0C)
        let cffSolo = false;
        adata.cffOpenType = false;
        if (adata.cffProgram) {
          cffSolo = true;
          adata.cffOpenType = true;
        } else if (!adata.type1 && (adata.glyphMap === null || adata.glyphMap.size === 0) && sfntIsCFF(fontcontent, 0)) {
          const ids = cffGlyphsAreCIDs(fontcontent, 0);
          adata.cffOpenType = ids.result;
          if (!adata.cffOpenType && adata.cffKeepsCIDs && ids.cidKeyed) {
            const table = sfntCFFTable(fontcontent, 0);
            if (table !== null) {
              fontcontent = table;
              cffSolo = true;
              adata.cffOpenType = true;
            }
          }
        }
        // A font file stream has no /Type (ISO 32000-1, 9.9)
        if (cffSolo) this.sWriteLine(t, '<< /Subtype /CIDFontType0C');
        else if (adata.cffOpenType) this.sWriteLine(t, '<< /Subtype /OpenType');
        else this.sWriteLine(t, '<<');
        this.writeStream(fontcontent, t, !adata.cffOpenType);
        adata.objectIndex = this.objectCount;
        this.sWriteLine(t, 'endobj');
        this.flushTemp();
      } else {
        adata.objectIndex = 0;
        adata.subsetTag = '';
      }
      // The font descriptor
      this.objectCount = this.objectCount + 1;
      t.setLength(0);
      this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
      adata.descriptorIndex = this.objectCount;
      this.sWriteLine(t, '<< /Type /FontDescriptor');
      this.sWriteLine(t, '/FontName /' + pdfNameOf(adata.subsetTag + adata.postcriptName));
      if (adata.isUnicode) this.sWriteLine(t, '/FontFamily(' + adata.fontFamily + ')');
      this.sWriteLine(t, '/Flags ' + String(adata.flags));
      const bbox = adata.fontBBox;
      this.sWriteLine(t, '/FontBBox [' + String(bbox.left) + ' ' + String(bbox.height) + ' ' + String(bbox.width) + ' ' + String(bbox.top) + ']');
      this.sWriteLine(t, '/ItalicAngle ' + String(roundHalfEven(adata.italicAngle) | 0));
      this.sWriteLine(t, '/Ascent ' + String(adata.ascent));
      this.sWriteLine(t, '/Descent ' + String(adata.descent));
      this.sWriteLine(t, '/Leading ' + String(adata.leading));
      this.sWriteLine(t, '/CapHeight ' + String(adata.capHeight));
      this.sWriteLine(t, '/StemV ' + String(roundHalfEven(adata.stemV) | 0));
      if (adata.avgWidth !== 0) this.sWriteLine(t, '/AvgWidth ' + String(adata.avgWidth));
      this.sWriteLine(t, '/MaxWidth ' + String(adata.maxWidth));
      this.sWriteLine(t, '/FontStretch /Normal');
      if (adata.fontWeight > 0) this.sWriteLine(t, '/FontWeight ' + String(adata.fontWeight));
      if (adata.embedded) {
        if (adata.type1) this.sWriteLine(t, '/FontFile ' + String(adata.objectIndex) + ' 0 R');
        else if (adata.cffOpenType) this.sWriteLine(t, '/FontFile3 ' + String(adata.objectIndex) + ' 0 R');
        else this.sWriteLine(t, '/FontFile2 ' + String(adata.objectIndex) + ' 0 R');
      }
      this.sWriteLine(t, '>>');
      this.sWriteLine(t, 'endobj');
      this.flushTemp();
      // The ToUnicode CMap
      if (adata.isUnicode) {
        const LINE_FEED = '\r\n';
        let cmap =
          '/CIDInit /ProcSet findresource begin' + LINE_FEED +
          '12 dict begin ' + LINE_FEED +
          'begincmap' + LINE_FEED +
          '/CIDSystemInfo' + LINE_FEED +
          '<< /Registry (TTX+0)' + LINE_FEED +
          '/Ordering (T42UV)' + LINE_FEED +
          '/Supplement 0' + LINE_FEED +
          '>> def' + LINE_FEED +
          '/CMapName /TTX+0 def' + LINE_FEED +
          '/CMapType 2 def' + LINE_FEED +
          '1 begincodespacerange' + LINE_FEED +
          '<0000><FFFF>' + LINE_FEED +
          'endcodespacerange' + LINE_FEED;
        const entries: [number, string][] = [];
        const declared = new Set<number>();
        for (const [nkey, info] of adata.cacheWidths.entries()) {
          const nvalue = info.glyph;
          if (declared.has(nvalue)) continue;
          let target = adata.cidClaim.get(nvalue);
          if (target === undefined) {
            target = adata.glyphText.get(nvalue);
            if (target === undefined || target === '') target = String.fromCharCode(nkey);
          }
          declared.add(nvalue);
          if (validTarget(target)) entries.push([nvalue, target]);
        }
        for (const [nvalue, info] of adata.glyphsInfo.entries()) {
          if (nvalue <= 0 || declared.has(nvalue)) continue;
          let target = adata.cidClaim.get(nvalue);
          if (target === undefined) {
            target = adata.glyphText.get(nvalue);
            if (target === undefined || target === '') target = String.fromCharCode(info.char);
          }
          declared.add(nvalue);
          if (validTarget(target)) entries.push([nvalue, target]);
        }
        for (let k = 0; k < adata.cidExtraGlyph.length; k++)
          if (validTarget(adata.cidExtraText[k] as string)) entries.push([adata.glyphCount + k, adata.cidExtraText[k] as string]);
        let current = 0;
        while (current < entries.length) {
          let nsize = entries.length - current;
          if (nsize > 100) nsize = 100;
          cmap += String(nsize) + ' beginbfchar' + LINE_FEED;
          for (let idx = 0; idx < nsize; idx++) {
            const [code, target] = entries[current + idx] as [number, string];
            let hex = '';
            for (let k = 0; k < target.length; k++) hex += intToHexPad(target.charCodeAt(k));
            cmap += '<' + intToHexPad(code) + '>  <' + hex + '>' + LINE_FEED;
          }
          cmap += 'endbfchar' + LINE_FEED;
          current += nsize;
        }
        cmap += 'endcmap' + LINE_FEED + 'CMapName currentdict /CMap defineresource pop' + LINE_FEED + 'end end' + LINE_FEED;
        this.objectCount = this.objectCount + 1;
        adata.toUnicodeIndex = this.objectCount;
        t.setLength(0);
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        const cmapBytes = new Uint8Array(cmap.length);
        for (let k = 0; k < cmap.length; k++) {
          const ch = cmap.charCodeAt(k);
          cmapBytes[k] = ch < 0x80 ? ch : 0x3f;
        }
        this.sWriteLine(t, '<< ');
        this.writeStream(cmapBytes, t);
        this.sWriteLine(t, 'endobj');
        this.flushTemp();
      }
    }
    // The fonts of the font list
    for (let i = 0; i < fonts.size; i++) {
      const adata = fonts.getByIndex(i);
      if (adata.isUnicode) {
        let cidToGidObject = 0;
        const compactMap = adata.embedded && adata.glyphMap !== null && adata.glyphMap.size > 0;
        const ownCodes = adata.cidExtraGlyph.length > 0 && !adata.type1;
        if (compactMap || ownCodes) {
          let maxCid = 0;
          if (compactMap) for (const cid of (adata.glyphMap as NonNullable<TTFontData['glyphMap']>).keys()) if (cid > maxCid) maxCid = cid;
          if (ownCodes) maxCid = Math.max(maxCid, adata.glyphCount + adata.cidExtraGlyph.length - 1);
          const table = new Uint8Array((maxCid + 1) * 2);
          if (compactMap) {
            for (const [key, value] of (adata.glyphMap as NonNullable<TTFontData['glyphMap']>).entries()) {
              table[key * 2] = (value >> 8) & 0xff;
              table[key * 2 + 1] = value & 0xff;
            }
          } else {
            for (let cid = 0; cid < adata.glyphCount && cid <= maxCid; cid++) {
              table[cid * 2] = (cid >> 8) & 0xff;
              table[cid * 2 + 1] = cid & 0xff;
            }
          }
          for (let k = 0; k < adata.cidExtraGlyph.length && ownCodes; k++) {
            const glyph = adata.cidExtraGlyph[k] as number;
            let target = glyph;
            if (compactMap) target = (adata.glyphMap as NonNullable<TTFontData['glyphMap']>).get(glyph) ?? 0;
            const cid = adata.glyphCount + k;
            table[cid * 2] = (target >> 8) & 0xff;
            table[cid * 2 + 1] = target & 0xff;
          }
          this.objectCount = this.objectCount + 1;
          cidToGidObject = this.objectCount;
          t.setLength(0);
          this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
          this.sWriteLine(t, '<<');
          this.writeStream(table, t);
          this.sWriteLine(t, 'endobj');
          this.flushTemp();
        }
        this.objectCount = this.objectCount + 1;
        t.setLength(0);
        adata.objectIndexParent = this.objectCount;
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        this.sWriteLine(t, '<< /Type /Font');
        this.sWriteLine(t, '/Subtype /Type0');
        this.sWriteLine(t, '/Name /F' + adata.objectName);
        this.sWriteLine(t, '/BaseFont /' + pdfNameOf(adata.subsetTag + adata.postcriptName));
        this.sWriteLine(t, '/Encoding /Identity-H');
        this.sWriteLine(t, '/DescendantFonts [ ' + String(this.objectCount + 1) + ' 0 R ]');
        this.sWriteLine(t, '/ToUnicode ' + String(adata.toUnicodeIndex) + ' 0 R');
        this.sWriteLine(t, '>>');
        this.sWriteLine(t, 'endobj');
        this.flushTemp();
        this.objectCount = this.objectCount + 1;
        t.setLength(0);
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        this.sWriteLine(t, '<< /Type /Font');
        if (adata.type1) this.sWriteLine(t, '/Subtype /CIDFontType1');
        else if (adata.cffOpenType) this.sWriteLine(t, '/Subtype /CIDFontType0');
        else this.sWriteLine(t, '/Subtype /CIDFontType2');
        this.sWriteLine(t, '/BaseFont /' + pdfNameOf(adata.subsetTag + adata.postcriptName));
        this.sWriteLine(t, '/FontDescriptor ' + String(adata.descriptorIndex) + ' 0 R');
        this.sWriteLine(t, '/FontFamily(' + adata.fontFamily + ')');
        this.sWriteLine(t, '/CIDSystemInfo<</Ordering(Identity)/Registry(Adobe)/Supplement 0>>');
        this.sWriteLine(t, '/DW 1000');
        this.sWriteLine(t, '/W [');
        let awidths = '';
        let acount = 0;
        const withWidth = new Set<number>();
        for (const [, info] of adata.cacheWidths.entries()) {
          awidths = awidths + String(info.glyph) + '[' + formatFixed1(info.width) + '] ';
          withWidth.add(info.glyph);
          acount++;
          if (acount % 8 === 7) awidths = awidths + '\r\n';
        }
        for (const [key, info] of adata.glyphsInfo.entries()) {
          if (key <= 0 || withWidth.has(key)) continue;
          withWidth.add(key);
          awidths = awidths + String(key) + '[' + formatFixed1(info.width) + '] ';
          acount++;
          if (acount % 8 === 7) awidths = awidths + '\r\n';
        }
        for (let k = 0; k < adata.cidExtraGlyph.length; k++) {
          const info = adata.glyphsInfo.get(adata.cidExtraGlyph[k] as number);
          if (info === undefined) continue;
          awidths = awidths + String(adata.glyphCount + k) + '[' + formatFixed1(info.width) + '] ';
          acount++;
          if (acount % 8 === 7) awidths = awidths + '\r\n';
        }
        this.sWriteLine(t, awidths);
        this.sWriteLine(t, ']');
        // Only a CIDFontType2 has a CIDToGIDMap; a CIDFontType0 takes the CID as the glyph
        if (adata.cffOpenType) {
          // none
        } else if (cidToGidObject > 0) this.sWriteLine(t, '/CIDToGIDMap ' + String(cidToGidObject) + ' 0 R');
        else this.sWriteLine(t, '/CIDToGIDMap /Identity');
        this.sWriteLine(t, '>>');
        this.sWriteLine(t, 'endobj');
        this.flushTemp();
      } else {
        this.objectCount = this.objectCount + 1;
        t.setLength(0);
        adata.objectIndexParent = this.objectCount;
        this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
        this.sWriteLine(t, '<< /Type /Font');
        if (adata.type1) this.sWriteLine(t, '/Subtype /Type1');
        else this.sWriteLine(t, '/Subtype /TrueType');
        this.sWriteLine(t, '/Name /F' + adata.objectName);
        this.sWriteLine(t, '/BaseFont /' + pdfNameOf(adata.subsetTag + adata.postcriptName));
        this.sWriteLine(t, '/FirstChar ' + String(adata.firstLoaded));
        this.sWriteLine(t, '/LastChar ' + String(adata.lastLoaded));
        let awidths = '[';
        if (adata.lastLoaded > 0) {
          let index = adata.firstLoaded;
          do {
            const w = adata.widths.get(index);
            if (w !== undefined) awidths = awidths + formatFixed1(w, false) + ' ';
            else awidths = awidths + '0 ';
            index++;
            if (index % 8 === 7) awidths = awidths + '\r\n';
          } while (index <= adata.lastLoaded);
          awidths = awidths + ']';
          this.sWriteLine(t, '/Widths ' + awidths);
        }
        this.sWriteLine(t, '/FontDescriptor ' + String(adata.descriptorIndex) + ' 0 R');
        if (this.fPDFConformance === PDFConformanceType.PDF_A_3) this.sWriteLine(t, '/Encoding /Identity-H');
        else this.sWriteLine(t, '/Encoding /' + adata.encoding);
        this.sWriteLine(t, '>>');
        this.sWriteLine(t, 'endobj');
        this.flushTemp();
      }
    }
  }

  /**
   * The tag of a font subset: six capital letters and + (ISO 32000-1, 9.6.4), from the name of the
   * font and its place in the document (FNV-1a), the same for the same document (SubsetTagOf).
   */
  static subsetTagOf(name: string | null, index: number): string {
    let h = 2166136261;
    const s = name ?? '';
    for (let i = 0; i < s.length; i++) h = Number((BigInt((h ^ s.charCodeAt(i)) >>> 0) * 16777619n) & 0xffffffffn);
    h = Number((BigInt((h ^ index) >>> 0) * 16777619n) & 0xffffffffn);
    let result = '';
    for (let k = 0; k < 6; k++) {
      result += String.fromCharCode(65 + (h % 26));
      h = Math.floor(h / 26);
    }
    return result + '+';
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
    return encodePDFText(text);
  }

  /** Starts the document: the header, the information dictionary and the first page. */
  beginDoc(): void {
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
    this.imageIndexes.clear();
    this.bitmapStreams.length = 0;
    // C# parity: the masks are not cleared (a PDFFile writes one document)
    this.imageCount = 0;
    this.fPage = 1;
    this.fCanvas.pdfConformance = this.fPDFConformance;
    // The header
    if (this.fPDFConformance === PDFConformanceType.PDF_1_4) this.sWriteLine(this.main, '%PDF-1.4');
    else {
      this.sWriteLine(this.main, '%PDF-1.7');
      // The comment of binary characters (%äüöß) that PDF/A asks for after the header
      this.main.write(new Uint8Array([37, 228, 252, 246, 223, 13, 10]));
    }
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
    if (this.fPDFConformance === PDFConformanceType.PDF_A_3) {
      this.setXMPMetadata();
      this.setColorSpace();
    }
    this.startStream();
  }

  /**
   * The XMP metadata of a PDF/A-3 document (SetXMPMetadata): the twins of the information
   * dictionary, the PDF/A-3B identification and the XMP content of the report.
   */
  private setXMPMetadata(): void {
    const xmp = new ByteBuffer(4096);
    const line = (text: string): void => this.sWriteLine(xmp, text);
    line('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    line('<x:xmpmeta xmlns:x="adobe:ns:meta/">');
    line('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"');
    line('    xmlns:xmp="http://ns.adobe.com/xap/1.0/"');
    line('    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"');
    line('    xmlns:dc="http://purl.org/dc/elements/1.1/"');
    line('    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"');
    line('    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">');
    line('  <rdf:Description rdf:about="">');
    // Author
    line('    <dc:creator>');
    line('      <rdf:Seq>');
    line('        <rdf:li>' + escapeXml(this.docAuthor) + '</rdf:li>');
    line('      </rdf:Seq>');
    line('    </dc:creator>');
    // Title
    line('    <dc:title>');
    line('      <rdf:Alt>');
    line('        <rdf:li xml:lang="x-default">' + escapeXml(this.docTitle) + '</rdf:li>');
    line('      </rdf:Alt>');
    line('    </dc:title>');
    // Keywords
    const keywords = this.docKeywords ?? '';
    if (keywords !== '') {
      line('    <dc:subject>');
      line('      <rdf:Bag>');
      for (const keyword of keywords.split(',')) line('        <rdf:li>' + escapeXml(trimNet(keyword)) + '</rdf:li>');
      line('      </rdf:Bag>');
      line('    </dc:subject>');
    }
    // Description
    line('    <dc:description>');
    line('      <rdf:Alt>');
    line('        <rdf:li xml:lang="x-default">' + escapeXml(this.docSubject) + '</rdf:li>');
    line('      </rdf:Alt>');
    line('    </dc:description>');
    // The dates of the information dictionary (beginDoc)
    line('    <xmp:CreateDate>' + this.xmpCreateDate + '</xmp:CreateDate>');
    line('    <xmp:ModifyDate>' + this.xmpModifyDate + '</xmp:ModifyDate>');
    // xmp:CreatorTool is the twin of /Creator, pdf:Producer of /Producer, pdf:Keywords of /Keywords
    if (this.docCreator !== null && this.docCreator !== '') line('    <xmp:CreatorTool>' + escapeXml(this.docCreator) + '</xmp:CreatorTool>');
    if (this.docProducer !== null && this.docProducer !== '') line('    <pdf:Producer>' + escapeXml(this.docProducer) + '</pdf:Producer>');
    if (keywords !== '') line('    <pdf:Keywords>' + escapeXml(keywords) + '</pdf:Keywords>');
    line('    <pdfaid:part>3</pdfaid:part>');
    line('    <pdfaid:conformance>B</pdfaid:conformance>');
    // The XMP content of the report
    if (this.docXMPContent !== null && this.docXMPContent !== '') line(this.docXMPContent);
    line('  </rdf:Description>');
    line('</rdf:RDF>');
    line('</x:xmpmeta>');
    line('<?xpacket end="w"?>');
    // The metadata object; its length leaves out the last end of line, as C# writes it
    this.objectCount++;
    this.xmpMetadataObject = this.objectCount;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /Metadata');
    this.sWriteLine(t, '   /Subtype /XML');
    this.sWriteLine(t, '   /Length ' + String(xmp.length - 1));
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'stream');
    t.write(xmp.view());
    this.sWriteLine(t, 'endstream');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
  }

  /** The sRGB ICC profile, the PDF/A output intent and the color space of a PDF/A-3 document (SetColorSpace). */
  private setColorSpace(): void {
    const t = this.fTempStream;
    this.objectCount++;
    const colorProfileObject = this.objectCount;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /N 3 /Alternate /DeviceRGB ');
    this.writeStream(srgbProfile(), t);
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
    // Output intent
    this.objectCount++;
    this.outputIntentObject = this.objectCount;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<< /Type /OutputIntent');
    this.sWriteLine(t, '  /S /GTS_PDFA1');
    this.sWriteLine(t, '  /OutputConditionIdentifier (sRGB IEC61966-2.1) ');
    this.sWriteLine(t, '  /Info (sRGB IEC61966-2.1) ');
    this.sWriteLine(t, '  /DestOutputProfile ' + String(colorProfileObject) + ' 0 R');
    this.sWriteLine(t, '>>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
    // Color space
    this.objectCount++;
    this.colorSpaceObject = this.objectCount;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    this.sWriteLine(t, '<<  /Type /ColorSpace');
    this.sWriteLine(t, '    /ColorSpace [/ICCBased ' + String(colorProfileObject) + ' 0 R] >>');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
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
  private writeStream(stream: Uint8Array, dest: ByteBuffer, fontProgram = false): void {
    // /Length1, the length of the decoded program, belongs to the TrueType font files only
    const length1 = fontProgram ? ' /Length1 ' + String(stream.length) : '';
    if (this.compressed) {
      // StreamUtil.CompressStream(Stream, MemoryStream): BEST_SPEED
      const fmem = this.compress(stream, false);
      this.sWriteLine(dest, ' /Length ' + String(fmem.length) + length1);
      this.sWriteLine(dest, '/Filter [/FlateDecode]');
      this.sWriteLine(dest, '>>');
      this.sWriteLine(dest, 'stream');
      dest.write(fmem);
    } else {
      this.sWriteLine(dest, ' /Length ' + String(stream.length) + length1);
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
    if (this.fPDFConformance === PDFConformanceType.PDF_A_3) this.sWriteLine(t, '<< /ProcSet [/PDF]');
    else this.sWriteLine(t, '<< /ProcSet [ /PDF /Text /ImageC]');
    if (this.imageCount > 0) {
      this.sWriteLine(t, '/XObject << ');
      // The soft masks are not listed: only the images reference them
      for (let i = 1; i <= this.imageCount; i++)
        if (!this.masks.has(i - 1)) this.sWriteLine(t, '/Im' + String(i) + ' ' + String(this.objectCount + i) + ' 0 R');
      this.sWriteLine(t, '>>');
    }
    this.sWriteLine(t, '/Font << ');
    for (let i = 1; i <= this.fontCount; i++) this.sWriteLine(t, '/F' + String(i) + ' ' + (this.fontList[i - 1] as string) + ' 0 R ');
    for (let i = 0; i < this.fCanvas.fontData.size; i++) {
      const adata = this.fCanvas.fontData.getByIndex(i);
      this.sWriteLine(t, '/F' + adata.objectName + ' ' + String(adata.objectIndexParent) + ' 0 R ');
    }
    this.sWriteLine(t, '>>');
    if (this.fPDFConformance === PDFConformanceType.PDF_A_3) {
      this.sWriteLine(t, '/ColorSpace << ');
      this.sWriteLine(t, '     /CS1 ' + String(this.colorSpaceObject) + ' 0 R');
      this.sWriteLine(t, '  >>');
    }
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
    for (let i = 1; i <= this.imageCount; i++) this.writeBitmap(i);
    for (let i = 1; i <= this.fPage; i++) this.setPageObject(i);
    this.writeEmbeddedFiles();
    this.setCatalog();
    this.setXref();
    this.sWriteLine(this.main, '%%EOF');
  }

  // An image or soft mask object; an image with a soft mask gets the number of the next object
  private writeBitmap(index: number): void {
    if (this.calculateOnly) return;
    this.objectCount = this.objectCount + 1;
    const t = this.fTempStream;
    t.setLength(0);
    this.sWriteLine(t, String(this.objectCount) + ' 0 obj');
    const mask = this.masks.get(index);
    if (mask !== undefined) {
      const digits = String(this.objectCount + 1);
      const bytes = new Uint8Array(digits.length);
      for (let i = 0; i < digits.length; i++) bytes[i] = digits.charCodeAt(i);
      mask.stream.writeAt(mask.position, bytes);
    }
    const stream = this.bitmapStreams[index - 1];
    if (stream === undefined) throw new RangeError('Index out of range on PrintItems collection');
    t.write(stream.view());
    // PDFCanvas.ENDSTREAM
    this.sWriteLine(t, '\nendstream');
    this.sWriteLine(t, 'endobj');
    this.flushTemp();
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
    if (this.fPDFConformance === PDFConformanceType.PDF_A_3) {
      this.sWriteLine(t, '/Metadata ' + String(this.xmpMetadataObject) + ' 0 R');
      this.sWriteLine(t, '/OutputIntents [' + String(this.outputIntentObject) + ' 0 R]');
      if (this.embeddedFiles.length > 0) {
        // The embedded files by name, and the same files as associated files of the document
        let files = '[';
        let resources = '[';
        for (const efile of this.embeddedFiles) {
          files = files + PDFFile.encodePDFText(efile.fileName) + ' ' + String(efile.resourceNumber) + ' 0 R';
          resources = resources + ' ' + String(efile.resourceNumber) + ' 0 R';
        }
        files = files + ']';
        resources = resources + ']';
        this.sWriteLine(t, '/Names <<');
        this.sWriteLine(t, '  /EmbeddedFiles << /Names ' + files + ' >>');
        this.sWriteLine(t, '>>');
        this.sWriteLine(t, '/AF ' + resources);
      }
    }
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
    // Every entry is 20 bytes: PDF 1.4 ends them with CR LF, PDF/A-3 with a space and LF
    const entryEnd = this.fPDFConformance === PDFConformanceType.PDF_1_4 ? '' : ' ';
    this.sWriteLine(t, '0000000000 65535 f' + entryEnd);
    for (let i = 0; i <= this.objectCount - 2; i++)
      this.sWriteLine(t, PDFFile.getOffsetNumber(String(this.objectOffsets[i])) + ' 00000 n' + entryEnd);
    this.sWriteLine(t, 'trailer');
    this.sWriteLine(t, '<< /Size ' + String(this.objectCount));
    this.sWriteLine(t, '/Root ' + String(this.catalogNum) + ' 0 R');
    this.sWriteLine(t, '/Info 1 0 R');
    if (this.fPDFConformance === PDFConformanceType.PDF_A_3) {
      // A new document: the permanent and the changing identifier are the same (ISO 32000-1, 14.4)
      const id = this.documentId();
      if (!/^[0-9A-Fa-f]+$/.test(id)) throw new Error('The document identifier must be hexadecimal digits: ' + id);
      this.sWriteLine(t, '/ID [<' + id + '> <' + id + '>]');
    }
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
