import { ByteBuffer } from './bytebuffer.js';
import {
  AutoScaleType,
  MetaFileVersion,
  MetaObjectType,
  OrientationType,
  PDFAFRelationShip,
  PDFConformanceType,
  PreviewWindowStyleType,
  PrinterFontsType,
  PrinterSelectType,
} from './enums.js';
import { AlignmentFlags } from './alignment.js';
import type { Point } from './geometry.js';
import { MetaObjectText } from './metaobject.js';
import type { MetaObject } from './metaobject.js';
import { MetaPages } from './metapage.js';
import type { MetaPage } from './metapage.js';
import { intDiv } from './numeric.js';
import { PageSizeArray } from './pagesizes.js';
import type { TextObjectStruct } from './textobject.js';

/** The part of the layout device CalcTextExtent needs: text measurement. */
export interface TextExtentDevice {
  textExtent(aobj: TextObjectStruct, extent: Point): Point;
}

/** A file embedded in the metafile, and later in the PDF (EmbeddedFile). */
export class EmbeddedFile {
  /** Name of the file in the PDF file specification. */
  fileName: string | null = null;
  /** Content. */
  stream: Uint8Array | null = null;
  /** MIME type (PDF Subtype). */
  mimeType: string | null = null;
  /** PDF object number, assigned while the PDF is written. */
  resourceNumber = 0;
  description: string | null = null;
  afRelationShip: PDFAFRelationShip = PDFAFRelationShip.Unspecified;
  /** Creation date, as ISO 8601 or as a PDF date. */
  creationDate: string | null = null;
  /** Modification date, as ISO 8601 or as a PDF date. */
  modificationDate: string | null = null;

  /** The name of the relationship as the PDF AFRelationship key expects it. */
  afRelationShipToString(): string {
    let result = 'Unspecified';
    switch (this.afRelationShip) {
      case PDFAFRelationShip.Unspecified:
        result = 'Unspecified';
        break;
      case PDFAFRelationShip.Alternative:
        result = 'Alternative';
        break;
      case PDFAFRelationShip.Data:
        result = 'Data';
        break;
      case PDFAFRelationShip.Source:
        result = 'Source';
        break;
      case PDFAFRelationShip.Supplement:
        result = 'Supplement';
        break;
    }
    return result;
  }

  /**
   * A deep copy, with a copy of the content.
   * C# parity: like the C# Clone, the resource number is not copied.
   */
  clone(): EmbeddedFile {
    const efile = new EmbeddedFile();
    efile.fileName = this.fileName;
    efile.mimeType = this.mimeType;
    efile.description = this.description;
    efile.afRelationShip = this.afRelationShip;
    efile.creationDate = this.creationDate;
    efile.modificationDate = this.modificationDate;
    if (this.stream !== null) efile.stream = this.stream.slice();
    return efile;
  }
}

/**
 * A reference to a text that prints the page count (TotalPage): the count is only known when the
 * report is finished, then UpdateTotalPages writes it into the text.
 */
export interface TotalPage {
  /** Page index in the metafile. */
  pageIndex: number;
  /** Object index in the page. */
  objectIndex: number;
  /** Display format of the page count (a .NET numeric format string, empty for none). */
  displayFormat: string;
}

/**
 * Formats an integer with a .NET numeric format string, as Int32.ToString(format) does under the
 * current culture. Given by the engine, which owns the culture data.
 */
export type IntegerFormatter = (value: number, format: string) => string;

function isDelimiter(c: string): boolean {
  switch (c) {
    case ' ':
    case '.':
    case ',':
    case '-':
    case '/':
    case '\\':
    case '=':
    case ')':
    case '(':
    case '*':
    case '\n':
      return true;
  }
  return false;
}

/** Upper case one code point at a time, without changing the length (.NET simple case mapping). */
function simpleUpper(s: string): string {
  let result = '';
  for (const ch of s) {
    const up = ch.toUpperCase();
    result += up.length === ch.length ? up : ch;
  }
  return result;
}

/**
 * The metafile: the device independent pages a report is laid out into (MetaFile.cs).
 *
 * In C# a report fills the metafile through events (OnRequestPage, OnBeginPrint...) while the
 * pages are being read or printed, and the metafile can be read and saved in the binary .rpmf
 * format. In TypeScript the engine fills the metafile itself, so the metafile is data plus
 * helpers: the events and the asynchronous reading are not part of it, and the .rpmf format is
 * in rpmf.ts (writeRpmf, readRpmf).
 */
export class MetaFile {
  /** Page sizes by index, in thousandths of an inch. */
  static readonly PageSizeArray = PageSizeArray;
  static readonly AlignmentFlags_AlignLeft = AlignmentFlags.AlignLeft;
  static readonly AlignmentFlags_AlignRight = AlignmentFlags.AlignRight;
  static readonly AlignmentFlags_AlignHJustify = AlignmentFlags.AlignHJustify;
  static readonly AlignmentFlags_AlignHCenter = AlignmentFlags.AlignHCenter;
  static readonly AlignmentFlags_AlignVCenter = AlignmentFlags.AlignVCenter;
  static readonly AlignmentFlags_AlignBottom = AlignmentFlags.AlignBottom;
  static readonly AlignmentFlags_SingleLine = AlignmentFlags.SingleLine;
  /** Maximum number of pages of a metafile. */
  static readonly MAX_NUMBER_PAGES = 32000;

  private fSharedStream = new ByteBuffer();
  private searched = false;
  private objectsFound = new Set<number>();
  private pagesFound: number[] = [];
  private fVersion: MetaFileVersion = MetaFileVersion.MetaVersion2_4;
  private fFinished = false;
  private fPDFConformance: PDFConformanceType = PDFConformanceType.PDF_1_4;

  /** Information flag: the metafile is empty. */
  empty = false;
  /** No need to keep the printed pages (no effect, as in C#). */
  forwardOnly = false;
  /** Default page size index in PageSizeArray. */
  pageSizeIndex = 0;
  /** Page width in twips. */
  customX = 12047;
  /** Page height in twips. */
  customY = 17039;
  openDrawerBefore = false;
  openDrawerAfter = false;
  orientation: OrientationType = OrientationType.Default;
  /** Default page back color. */
  backColor = 0;
  paperSource = 0;
  copies = 0;
  linesPerInch = 0;
  collateCopies = false;
  duplex = 0;
  printerSelect: PrinterSelectType = PrinterSelectType.DefaultPrinter;
  autoScale: AutoScaleType = AutoScaleType.Wide;
  previewWindow: PreviewWindowStyleType = PreviewWindowStyleType.Normal;
  previewAbout = false;
  previewMargins = false;
  /** The PDF streams should be compressed. */
  pdfCompressed = false;
  /** Files embedded in the metafile, attached to the PDF. */
  embeddedFiles: EmbeddedFile[] = [];
  // Metadata (null in a new C# metafile)
  docAuthor: string | null = null;
  docTitle: string | null = null;
  docSubject: string | null = null;
  docProducer: string | null = null;
  docCreator: string | null = null;
  docKeywords: string | null = null;
  docXMPContent: string | null = null;
  /** Creation date, as ISO 8601 or as a PDF date; empty or not a date means now. */
  docCreationDate: string | null = null;
  /** Modification date; empty or not a date means the creation date. */
  docModificationDate: string | null = null;
  /** The pages. */
  readonly pages: MetaPages;
  /** Index of the page being generated. */
  currentPage = 0;
  /** Default printer fonts selection. */
  printerFonts: PrinterFontsType = PrinterFontsType.Default;

  constructor() {
    this.pages = new MetaPages(this);
  }

  /** Stream with the images shared by several pages. */
  get sharedStream(): ByteBuffer {
    return this.fSharedStream;
  }

  /** Format version of the metafile. */
  get version(): MetaFileVersion {
    return this.fVersion;
  }
  set version(value: MetaFileVersion) {
    this.fVersion = value;
  }

  /** The report processing has finished. */
  get finished(): boolean {
    return this.fFinished;
  }

  /** PDF conformance of the document; PDF/A-3 raises the version to 3.0. */
  get pdfConformance(): PDFConformanceType {
    return this.fPDFConformance;
  }
  set pdfConformance(value: PDFConformanceType) {
    if (value === PDFConformanceType.PDF_A_3) {
      if (this.fVersion < MetaFileVersion.MetaVersion3_0) this.fVersion = MetaFileVersion.MetaVersion3_0;
    }
    this.fPDFConformance = value;
  }

  /** Adds an embedded file (a copy of the content); raises the version to 3.0. */
  newEmbeddedFile(
    fileName: string,
    mimeType: string,
    afRelationShip: PDFAFRelationShip,
    description: string,
    creationDate: string,
    modificationDate: string,
    stream: Uint8Array,
  ): void {
    if (this.fVersion < MetaFileVersion.MetaVersion3_0) this.fVersion = MetaFileVersion.MetaVersion3_0;
    const efile = new EmbeddedFile();
    efile.fileName = fileName;
    efile.afRelationShip = afRelationShip;
    efile.creationDate = creationDate;
    efile.modificationDate = modificationDate;
    efile.description = description;
    efile.stream = stream.slice();
    efile.mimeType = mimeType;
    this.embeddedFiles.push(efile);
  }

  /** Removes every page, embedded file and shared stream. */
  clear(): void {
    this.fFinished = false;
    this.pages.clear();
    this.embeddedFiles.length = 0;
    this.fSharedStream.setLength(0);
  }

  /** Marks the report processing as finished. */
  finish(): void {
    this.fFinished = true;
  }

  /** Marks the report processing as not finished. */
  unFinish(): void {
    this.fFinished = false;
  }

  /**
   * Writes the page count into the texts that print it (UpdateTotalPages), with the number of
   * pages generated. A display format needs `formatInteger`.
   */
  updateTotalPages(list: readonly TotalPage[], formatInteger?: IntegerFormatter): void {
    this.updateTotalPagesPCount(list, this.pages.currentCount, formatInteger);
  }

  /**
   * Writes a page count into the texts that print it (UpdateTotalPagesPCount): the first nine
   * characters of each text in the pool are overwritten with the count, padded with spaces, and
   * the length of the text becomes the length of the count.
   * C# parity: texts that share the pool position (the same placeholder string) all change, and
   * a count longer than nine characters keeps its length but only nine characters are written.
   */
  updateTotalPagesPCount(list: readonly TotalPage[], pcount: number, formatInteger?: IntegerFormatter): void {
    for (const aobject of list) {
      const apage = this.pages.get(aobject.pageIndex);
      if (aobject.objectIndex < 0 || aobject.objectIndex >= apage.objects.length)
        throw new RangeError('Index was out of range of the objects of the page');
      const objx = apage.objects[aobject.objectIndex];
      if (!(objx instanceof MetaObjectText))
        throw new TypeError('The page count object is not a text object');
      const index = objx.textP - 1;
      let astring: string;
      if (aobject.displayFormat.length > 0) {
        if (formatInteger === undefined)
          throw new Error('UpdateTotalPages: a page count with a display format needs an integer formatter');
        astring = formatInteger(pcount, aobject.displayFormat);
      } else astring = String(pcount);
      const oldtexts = 9;
      objx.textS = astring.length;
      astring = astring + '                                      ';
      const pool = apage.pool;
      for (let j = 0; j < oldtexts; j++) {
        if (index + j < 0 || index + j >= pool.length) throw new RangeError('Index was outside the bounds of the array.');
        pool[index + j] = astring.charCodeAt(j);
      }
    }
  }

  /**
   * How much of a text fits in an extent (CalcTextExtent): the position where the text must be
   * cut, at a delimiter, so the part before it is not taller than maxextent. The text is measured
   * with the device.
   */
  static calcTextExtent(adriver: TextExtentDevice, maxextent: Point, objt: TextObjectStruct): number {
    const obj = { ...objt };
    let newextent: Point;
    let currentpos = obj.text.length;
    const originalstring = obj.text;
    newextent = adriver.textExtent({ ...obj }, { ...maxextent });
    let lasttested = currentpos;
    let minpos = -1;
    let maxpos = currentpos;
    let oldcurrentpos = -1;
    // Speed enhancement to cut at least a lot of size testing
    while (minpos < maxpos) {
      currentpos = intDiv(minpos + maxpos, 2);
      // Word break
      while (currentpos > 0) {
        currentpos--;
        if (isDelimiter(originalstring.charAt(currentpos))) break;
      }
      if (oldcurrentpos === currentpos) break;
      oldcurrentpos = currentpos;
      obj.text = originalstring.substring(0, currentpos);
      newextent = adriver.textExtent({ ...obj }, { ...maxextent });
      if (newextent.y <= maxextent.y) minpos = currentpos;
      else {
        lasttested = currentpos;
        maxpos = lasttested;
      }
    }
    currentpos = lasttested;
    obj.text = originalstring.substring(0, currentpos);
    newextent = adriver.textExtent({ ...obj }, { ...maxextent });
    while (newextent.y > maxextent.y) {
      if (currentpos < obj.text.length && isDelimiter(obj.text.charAt(currentpos))) {
        currentpos--;
      } else {
        while (currentpos > 0) {
          currentpos--;
          if (currentpos < 0) break;
          if (isDelimiter(obj.text.charAt(currentpos))) break;
        }
      }
      if (currentpos <= 0) break;
      obj.text = originalstring.substring(0, currentpos);
      newextent = adriver.textExtent({ ...obj }, { ...maxextent });
    }
    if (currentpos < 0) return obj.text.length;
    return currentpos;
  }

  /** The object was found by the last search. */
  objectFound(aobject: MetaObject): boolean {
    if (!this.searched) return false;
    return this.objectsFound.has(aobject.id);
  }

  /**
   * The next page index where the last search found something, after a page.
   * C# parity: a page that is not in the list of found pages gives the first found page.
   */
  nextPageFound(currpage: number): number {
    if (!this.searched) return 0;
    if (this.pagesFound.length === 0) return 0;
    let index = this.pagesFound.indexOf(currpage);
    if (index >= this.pagesFound.length - 1) index = 0;
    else index++;
    return this.pagesFound[index] as number;
  }

  /**
   * Searches a text (case insensitive) in every text object; objectFound and nextPageFound
   * answer from the result. The found objects get consecutive Ids from 1, the other texts 0.
   * C# parity: C# upper cases and searches with the current culture; here the case mapping is
   * one character at a time and the search is ordinal.
   */
  doSearch(svalue: string): void {
    this.objectsFound.clear();
    this.pagesFound = [];
    svalue = simpleUpper(svalue);
    if (svalue.length === 0) {
      this.searched = false;
      return;
    }
    this.searched = true;
    let id = 1;
    for (let i = 0; i < this.pages.count; i++) {
      const apage: MetaPage = this.pages.get(i);
      let foundinpage = false;
      for (const aobj of apage.objects) {
        if (aobj.metaType === MetaObjectType.Text) {
          if (!(aobj instanceof MetaObjectText)) throw new TypeError('A text object is not a MetaObjectText');
          aobj.id = 0;
          const atext = simpleUpper(apage.getText(aobj));
          if (atext.indexOf(svalue) >= 0) {
            aobj.id = id;
            id++;
            foundinpage = true;
            this.objectsFound.add(aobj.id);
          }
        }
      }
      if (foundinpage) this.pagesFound.push(i);
    }
  }
}
