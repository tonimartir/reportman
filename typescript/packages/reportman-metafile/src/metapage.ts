import { ByteBuffer } from './bytebuffer.js';
import {
  BrushType,
  ImageDrawStyleType,
  MetaFileVersion,
  MetaObjectType,
  OrientationType,
  PDFConformanceType,
  PDFFontType,
  PenType,
  PrintStepType,
  ShapeType,
  TextAlignType,
  TextAlignVerticalType,
} from './enums.js';
import { AlignmentFlags } from './alignment.js';
import {
  MetaObject,
  MetaObjectBarcode,
  MetaObjectDraw,
  MetaObjectImage,
  MetaObjectText,
} from './metaobject.js';
import { codeUnitsToString } from './numeric.js';
import type { MetaFile } from './metafile.js';

/** Page size information of a page (PageSizeDetail), used when UpdatedPageSize is true. */
export class PageSizeDetail {
  /** Index into PageSizeArray. */
  index = 0;
  /** The page does not match a predefined size: CustomWidth and CustomHeight are used. */
  custom = false;
  customWidth = 0;
  customHeight = 0;
  physicWidth = 0;
  physicHeight = 0;
  /** Paper source, an index the printer driver understands. */
  paperSource = 0;
  /** Paper name to force when working with custom sizes (null in a new C# instance). */
  forcePaperName: string | null = null;
  duplex = 0;
}

const FIRST_ALLOCATED_WIDESTRING = 1000;

/**
 * A page of the metafile (MetaPage): its objects, the pool of strings they reference and the
 * stream of its (not shared) images.
 */
export class MetaPage {
  /** Format version of the page (binary format only). */
  version: MetaFileVersion = MetaFileVersion.MetaVersion3_0;
  /** True when the size of the page differs from the default page size of the metafile. */
  updatedPageSize = false;
  /** The objects of the page, in drawing order. */
  objects: MetaObject[] = [];
  orientation: OrientationType = OrientationType.Default;
  /** Page size information, used when UpdatedPageSize is true. */
  pageDetail: PageSizeDetail = new PageSizeDetail();

  private fPool: Uint16Array = new Uint16Array(FIRST_ALLOCATED_WIDESTRING);
  private fPoolPos = 0;
  /**
   * The strings already in the pool and their (1 based) positions, so a repeated string is
   * stored once.
   * C# parity: the C# SortedList compares keys with the culture-aware comparer, under which
   * canonically equivalent strings or strings that differ only in ignorable characters
   * (U+0000, soft hyphen...) are the same key; here keys are compared exactly.
   */
  readonly stringList = new Map<string, number>();
  private fMemStream = new ByteBuffer();
  private readonly fMetafile: MetaFile;

  constructor(meta: MetaFile) {
    this.fMetafile = meta;
  }

  /** The stream with the images of the page that are not shared. */
  get memStream(): ByteBuffer {
    return this.fMemStream;
  }

  /**
   * The pool: the characters (UTF-16 code units) of all the strings of the page. Objects
   * reference strings by 1 based position and length. Its length is the capacity, not the used
   * size, as the char[] of the C# engine.
   */
  get pool(): Uint16Array {
    return this.fPool;
  }

  /** Number of pool characters in use. */
  get poolPos(): number {
    return this.fPoolPos;
  }

  /** The metafile owner of the page. */
  get metaFile(): MetaFile {
    return this.fMetafile;
  }

  /** Physical width of the page. */
  get physicWidth(): number {
    if (this.updatedPageSize) return this.pageDetail.physicWidth;
    return this.fMetafile.customX;
  }

  /** Physical height of the page. */
  get physicHeight(): number {
    if (this.updatedPageSize) return this.pageDetail.physicHeight;
    return this.fMetafile.customY;
  }

  /** Removes every object, string and stream of the page. */
  clear(): void {
    this.objects.length = 0;
    this.stringList.clear();
    this.fPoolPos = 0;
    this.fMemStream.setLength(0);
  }

  /**
   * Adds a string to the pool and returns its 1 based position; a string already in the pool
   * returns the position it already has.
   */
  addString(value: string): number {
    if (typeof value !== 'string') throw new TypeError('MetaPage.addString: the value must be a string');
    const existing = this.stringList.get(value);
    if (existing !== undefined) return existing;
    if (this.fPool.length < this.fPoolPos + value.length + 2) {
      const npool = new Uint16Array((this.fPool.length + value.length + 2) * 2);
      npool.set(this.fPool);
      this.fPool = npool;
    }
    const oldPos = this.fPoolPos;
    for (let i = 0; i < value.length; i++) {
      this.fPool[this.fPoolPos] = value.charCodeAt(i);
      this.fPoolPos++;
    }
    const newValue = oldPos + 1;
    this.stringList.set(value, newValue);
    return newValue;
  }

  private poolString(position: number, size: number): string {
    // As new string(char[], startIndex, length): the range must be inside the array
    const start = position - 1;
    if (start < 0 || size < 0 || start + size > this.fPool.length)
      throw new RangeError('Index and length must refer to a location within the string pool');
    return codeUnitsToString(this.fPool, start, size);
  }

  /** The text of a text object, or the data of a barcode object. */
  getText(obj: MetaObjectText | MetaObjectBarcode): string {
    return this.poolString(obj.textP, obj.textS);
  }

  /** The Windows font name of a text object. */
  getWFontNameText(obj: MetaObjectText): string {
    return this.poolString(obj.wFontNameP, obj.wFontNameS);
  }

  /** The Linux font name of a text object. */
  getLFontNameText(obj: MetaObjectText): string {
    return this.poolString(obj.lFontNameP, obj.lFontNameS);
  }

  /** The annotation of an object, null when it has none. */
  getAnnotationText(obj: MetaObject): string | null {
    if (obj.annotationP === 0) return null;
    return this.poolString(obj.annotationP, obj.annotationS);
  }

  /**
   * The bytes of an image object, from the page stream or the shared stream of the metafile.
   * C# parity: a range past the end of the stream gives zero bytes for the missing part.
   */
  getStream(obj: MetaObjectImage): Uint8Array {
    const size = obj.streamSize | 0;
    const source = obj.sharedImage ? this.fMetafile.sharedStream : this.fMemStream;
    const result = new Uint8Array(Math.max(0, size));
    const available = Math.max(0, Math.min(size, source.length - obj.streamPos));
    if (available > 0) result.set(source.read(obj.streamPos, available));
    return result;
  }

  /**
   * Appends bytes to the stream of the page, or to the shared stream of the metafile, and
   * returns the position where they start.
   */
  addStream(data: Uint8Array, shared: boolean): number {
    const target = shared ? this.fMetafile.sharedStream : this.fMemStream;
    const result = target.length;
    target.write(data);
    return result;
  }

  /** Adds a text object to the page (MetaPage.DrawText). */
  drawText(
    posX: number,
    posY: number,
    printWidth: number,
    printHeight: number,
    text: string,
    wFontName: string,
    lFontName: string,
    fontSize: number,
    fontRotation: number,
    fontColor: number,
    backColor: number,
    transparent: boolean,
    fontStyle: number,
    type1Font: PDFFontType,
    horzAlign: TextAlignType,
    vertAlign: TextAlignVerticalType,
    singleLine: boolean,
    wordWrap: boolean,
    cutText: boolean,
    printStep: PrintStepType,
  ): MetaObjectText {
    const obj = new MetaObjectText();
    obj.textP = this.addString(text);
    obj.textS = text.length;
    obj.lFontNameP = this.addString(lFontName);
    obj.lFontNameS = lFontName.length;
    obj.wFontNameP = this.addString(wFontName);
    obj.wFontNameS = wFontName.length;
    obj.fontSize = fontSize;
    obj.backColor = backColor;
    obj.fontRotation = fontRotation;
    obj.fontStyle = (fontStyle << 16) >> 16; // (short)FontStyle
    obj.fontColor = fontColor;
    if (this.fMetafile.pdfConformance === PDFConformanceType.PDF_A_3) obj.type1Font = PDFFontType.Embedded;
    else obj.type1Font = type1Font;
    obj.cutText = cutText;
    obj.transparent = transparent;
    obj.wordWrap = wordWrap;
    obj.top = posY;
    obj.left = posX;
    obj.width = printWidth;
    obj.height = printHeight;
    obj.printStep = printStep;
    let align = MetaObject.getIntHorizAlignment(horzAlign) | MetaObject.getIntVertAlignment(vertAlign);
    if (singleLine) align = align | AlignmentFlags.SingleLine;
    obj.alignment = align;
    this.objects.push(obj);
    return obj;
  }

  /** Adds a shape to the page (MetaPage.DrawShape). */
  drawShape(
    posX: number,
    posY: number,
    printWidth: number,
    printHeight: number,
    shape: ShapeType,
    brushStyle: BrushType,
    penStyle: PenType,
    penWidth: number,
    penColor: number,
    brushColor: number,
  ): MetaObjectDraw {
    const obj = new MetaObjectDraw();
    obj.metaType = MetaObjectType.Draw;
    obj.top = posY;
    obj.left = posX;
    obj.width = printWidth;
    obj.height = printHeight;
    obj.drawStyle = shape;
    obj.brushStyle = brushStyle;
    obj.penStyle = penStyle;
    obj.penWidth = penWidth;
    obj.penColor = penColor;
    obj.brushColor = brushColor;
    this.objects.push(obj);
    return obj;
  }

  /** Adds an image to the page, its bytes to the page stream (MetaPage.DrawImage). */
  drawImage(
    posX: number,
    posY: number,
    printWidth: number,
    printHeight: number,
    drawStyle: ImageDrawStyleType,
    dpiRes: number,
    data: Uint8Array,
  ): MetaObjectImage {
    const obj = new MetaObjectImage();
    obj.metaType = MetaObjectType.Image;
    obj.top = posY;
    obj.left = posX;
    obj.width = printWidth;
    obj.height = printHeight;
    obj.copyMode = 20;
    obj.drawImageStyle = drawStyle;
    obj.dpiRes = dpiRes;
    obj.previewOnly = false;
    obj.streamPos = this.addStream(data, false);
    obj.streamSize = data.length;
    this.objects.push(obj);
    return obj;
  }
}

/** The pages of a metafile (MetaPages). */
export class MetaPages {
  private fPages: MetaPage[] = [];

  /** The pages of a metafile (the C# collection keeps the metafile to ask it for pages). */
  constructor(readonly metafile: MetaFile) {}

  /** Clears and removes every page. */
  clear(): void {
    for (const page of this.fPages) page.clear();
    this.fPages = [];
  }

  /** Removes every page from the collection without clearing them. */
  clearCollection(): void {
    this.fPages = [];
  }

  /** Number of pages generated so far. */
  get currentCount(): number {
    return this.fPages.length;
  }

  /**
   * Number of pages. In C# reading it asks the report to generate every page (RequestPage); in
   * TypeScript the engine fills the metafile itself, so it is the number of pages added.
   */
  get count(): number {
    return this.fPages.length;
  }

  private checkRange(index: number): void {
    if (index < 0 || index >= this.fPages.length || !Number.isInteger(index))
      throw new RangeError('Index out of range on MetaPage collection');
  }

  /** The page at an index. */
  get(index: number): MetaPage {
    this.checkRange(index);
    return this.fPages[index] as MetaPage;
  }

  /** Replaces the page at an index. */
  set(index: number, page: MetaPage): void {
    this.checkRange(index);
    this.fPages[index] = page;
  }

  /** Appends a page. */
  add(page: MetaPage): void {
    // C# parity: MetaFile.ForwardOnly has no effect here either (its code is commented out).
    this.fPages.push(page);
  }

  /** The pages, in order. */
  [Symbol.iterator](): IterableIterator<MetaPage> {
    return this.fPages[Symbol.iterator]();
  }
}
