// Port of Reportman.Drawing.PrintOutText: the device of a report printed as text on a line
// printer, a dot matrix printer or a receipt printer. It is both the layout device (each text is
// measured on a character grid: a fixed width per character at the step its font size selects,
// and one print line per 1/LinesPerInch of an inch) and the device that writes the pages as the
// bytes of the printer, with the escape codes of its driver (text-escapes.ts). The layout of a
// report run with this device is not the PDF one, so a report is printed as text by running it
// with this device (printReport), not by writing the metafile of a PDF run.
//
// The drivers: PLAIN (the default) and PLAINFULL, EPSON, EPSON-MASTER, EPSON-ESCP, EPSON-ESCPQ,
// IBMPROPRINTER, HP-PCL, VT100, and the receipt drivers EPSONTMU210 and the TM88 family, which draw
// barcodes by themselves (ESC/POS, text-escpos.ts). Images are skipped, as the C# device does
// without a bitmap decoder (its BitmapInfoProvider, null by default): the raster images of the
// ESC/POS drivers are not ported.

import {
  AlignmentFlags,
  MetaBarcodeSymbology,
  MetaObjectBarcode,
  MetaObjectType,
  OrientationType,
  PageSizeArray,
  PrintOut,
  PrinterRawOperation as Op,
  PrinterSelectType,
  PrintStepType,
  TWIPS_PER_INCH,
  newLineInfo,
  roundHalfEven,
  toInt32,
} from '@reportman/metafile';
import type {
  DevicePageSize,
  LineInfo,
  MetaFile,
  MetaObject,
  MetaObjectText,
  MetaPage,
  PageSizeDetail,
  Point,
  TextObjectStruct,
} from '@reportman/metafile';
import { dec, decDivide, decMultiply, decRound, decToInteger } from './text-decimal.js';
import { fillEscapes, isReceiptDriver, isTm88Driver } from './text-escapes.js';
import { encodeEscPos1D, encodeEscPosPdf417, encodeEscPosQr } from './text-escpos.js';
import { encodeOem, encodeText, encodeUtf8, type TextCodePage } from './text-encoding.js';

export { decodeCp437, encodeLatin1, encodeOem, encodeUtf8 } from './text-encoding.js';
export { ESCPOS_DPI, encodeEscPos1D, encodeEscPosPdf417, encodeEscPosQr } from './text-escpos.js';
export { isReceiptDriver, isTm88Driver } from './text-escapes.js';

/** Default lines per inch before a document starts (DEFAULT_LINESPERINCH). */
const DEFAULT_LINESPERINCH = 6;
const EMPTY = new Uint8Array(0);
const SPACE = 32;
/** The names of KnownColor (.NET 10) and the index of Red among them sorted, as a color (-143). */
const KNOWN_COLOR_COUNT = 175;
const KNOWN_COLOR_RED = -143;

/**
 * The printer configuration the C# device reads from reportman.ini (PrinterConfig), by printer
 * selection. The host gives it; the default is what C# answers when there is no reportman.ini.
 */
export interface TextPrinterConfig {
  /** The driver of a printer selection (PrinterDriver): used when no driver is forced. */
  driverName(select: PrinterSelectType): string;
  /** Write the text in code page 850 (PrinterEscapeOem); otherwise in UTF-8. */
  oemConvert(select: PrinterSelectType): boolean;
  /** Cut the paper at the end of the document (CutPaperOn). */
  cutPaperOption(select: PrinterSelectType): boolean;
  /** The bytes that cut the paper (CutPaper, decoded); empty for the driver's own. */
  cutPaperOperation(select: PrinterSelectType): Uint8Array;
  /** Open the drawer at the end of the document (OpenDrawerOn). */
  openDrawerOption(select: PrinterSelectType): boolean;
  /** The bytes that open the drawer (OpenDrawer, decoded). */
  openDrawerOperation(select: PrinterSelectType): Uint8Array;
}

/** PrinterConfig without a reportman.ini: the character printer is EPSON, the plain ones PLAIN... */
export const defaultTextPrinterConfig: TextPrinterConfig = {
  driverName(select) {
    switch (select) {
      case PrinterSelectType.Characterprinter:
        return 'EPSON';
      case PrinterSelectType.PlainPrinter:
        return 'PLAIN';
      case PrinterSelectType.PlainFullPrinter:
        return 'PLAINFULL';
      default:
        return '';
    }
  },
  oemConvert: () => true,
  cutPaperOption: () => false,
  cutPaperOperation: () => EMPTY,
  openDrawerOption: () => false,
  openDrawerOperation: () => EMPTY,
};

/** Options of a TextDevice. */
export interface TextDeviceOptions {
  /**
   * The printer driver (ForceDriverName): PLAIN by default. An empty string lets the printer
   * configuration choose by the printer selection of the report, as C# does without a forced
   * driver (with the default configuration that is no driver at all: not even line ends).
   */
  driver?: string;
  /**
   * Write the text in code page 850 (true) or UTF-8 (false) (OverrideOemConvert); by default the
   * printer configuration says, which is true without a reportman.ini. The TM88 drivers that
   * declare their character set (CP850, CP858, UTF8) always write in it.
   */
  oemConvert?: boolean;
  /** Write each text trimmed and without the closing style codes (FullPlain); false by default. */
  fullPlain?: boolean;
  /** The printer configuration (reportman.ini of C#); defaultTextPrinterConfig by default. */
  printerConfig?: TextPrinterConfig;
}

/** A report run the text device prints: the ReportRun of @reportman/engine. */
export interface TextReportRun {
  readonly metaFile: MetaFile;
  /** Begins the layout (BeginPrint); fails with NoDataToPrintException when there is nothing to print. */
  begin(): Promise<void>;
  /** Generates pages until the one asked for exists. */
  requestPage(pageIndex: number): Promise<boolean>;
  /** Closes the connections of the run. */
  close?(): Promise<void>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A text placed at a column of a print line (PosText). */
interface PosText {
  position: number;
  nSize: number;
  underline: boolean;
  italic: boolean;
  red: boolean;
  bold: boolean;
  strokeout: boolean;
  regular: boolean;
}

/** A print line of the page being written (PrintLine). */
class PrintLine {
  /** The texts by column (a SortedList in C#: written in the order of their columns). */
  readonly texts = new Map<number, PosText>();
  fontStep: PrintStepType = PrintStepType.cpi10;
  /** The characters of the line, padded with spaces to the page width. */
  value = '';
  /** Device codes written before the text of the line (native barcodes and images). */
  rawBefore: Uint8Array[] | null = null;
  /** A native symbol already fed the paper of this line. */
  consumed = false;
}

/** Bytes appended one array after the other (a MemoryStream). */
class ByteWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  write(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  toArray(): Uint8Array {
    const out = new Uint8Array(this.size);
    let pos = 0;
    for (const c of this.chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}

/** Math.Round(double, MidpointRounding.AwayFromZero). */
function roundAwayFromZero(x: number): number {
  const t = Math.trunc(x);
  const f = x - t;
  if (Math.abs(f) >= 0.5) return t + Math.sign(f);
  return t;
}

/** char.IsWhiteSpace of .NET, which String.Trim removes. */
function isNetWhiteSpace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** String.Trim of .NET. */
function netTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isNetWhiteSpace(s.charCodeAt(start))) start++;
  while (end > start && isNetWhiteSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

/** The characters reversed, code unit by code unit (PDFCanvas.DoReverseString). */
function reverseString(s: string): string {
  let r = '';
  for (let i = 0; i < s.length; i++) r = s[i] + r;
  return r;
}

const isSign = (c: string): boolean => c === ',' || c === '.' || c === '-' || c === ' ' || c === ':' || c === ';';

/**
 * Whether one more laid-out line of a clipped text is kept: never past the height of the object,
 * except the first line, which always prints (LineFits).
 */
function lineFits(already: number, lineheight: number, rectheight: number): boolean {
  if (already === 0) return true;
  return lineheight * already + lineheight <= rectheight;
}

/** A NoDataToPrintException of the engine (this package does not depend on it). */
function isNoDataToPrint(e: unknown): boolean {
  return e instanceof Error && e.name === 'NoDataToPrintException';
}

/**
 * The text device (PrintOutText). Run a report with it as the layout device and print the run:
 *
 *   const device = new TextDevice();                       // PLAIN, code page 850
 *   const run = await prepareReport(model, { device, data });
 *   await device.printReport(run);
 *   device.printResult;                                    // the bytes for the printer
 *
 * print(meta) writes a metafile that is already complete (laid out with this device).
 */
export class TextDevice extends PrintOut {
  private allowedsteps: Map<PrintStepType, PrintStepType> | null = null;
  private fLinesPerInch = DEFAULT_LINESPERINCH;
  private currpageStream = new ByteWriter();
  private fDrawerBefore = false;
  private fDrawerAfter = false;
  /** Width of the page in twips. */
  pageWidth = 0;
  private pageQt = 0;
  /** Height of the page in twips. */
  pageHeight = 0;
  private lines: PrintLine[] = [];
  private fPrinterSelect: PrinterSelectType = PrinterSelectType.DefaultPrinter;
  /** The driver forced (ForceDriverName); empty: the printer configuration decides. */
  forceDriverName: string;
  /** The driver whose codes are written (FPrinterDriver), known when a document starts. */
  printerDriver = 'PLAIN';
  private loadOEMConvert = true;
  private oemConvert = false;
  /** Forced OEM conversion (OverrideOemConvert), null: the printer configuration decides. */
  overrideOemConvert: boolean | null;
  /** Texts trimmed and without closing style codes (FullPlain). */
  fullPlain: boolean;
  /** The printer configuration. */
  printerConfig: TextPrinterConfig;
  /** Lines written with text in the last print. */
  blacklines = 0;
  /** Lines written without text in the last print. */
  whitelines = 0;
  private previousLine: { fontStep: PrintStepType } | null = null;
  private linfos: LineInfo[] = [];
  private masterselect = false;
  private limitedmaster = false;
  private condensedmaster = false;
  private printResultStream = new ByteWriter();
  private escapecodes = new Map<Op, Uint8Array>();
  private readonly master10 = 0;
  private readonly master12 = 1;
  private readonly mastercond = 4;
  private readonly masterwide = 32;
  private linefeeds = 0;
  /** The code page the driver forces for its text (0: the OEM conversion decides). */
  driverCodePage = 0;

  constructor(options: TextDeviceOptions = {}) {
    super();
    this.forceDriverName = options.driver ?? 'PLAIN';
    this.overrideOemConvert = options.oemConvert ?? null;
    this.fullPlain = options.fullPlain ?? false;
    this.printerConfig = options.printerConfig ?? defaultTextPrinterConfig;
  }

  /** The bytes written for the printer (PrintResultStream), after a print. */
  get printResult(): Uint8Array {
    return this.printResultStream.toArray();
  }

  /** The escape code of an operation for the current driver; empty when it has none. */
  getEscape(op: Op): Uint8Array {
    return this.escapecodes.get(op) ?? EMPTY;
  }

  /** Draws every object of a page into the print lines. */
  override drawPage(_meta: MetaFile, page: MetaPage): void {
    for (const obj of page.objects) this.drawObject(page, obj);
  }

  /**
   * Draws an object of a page: texts, and on the ESC/POS receipt drivers the barcodes they draw
   * by themselves. Images are skipped (see the summary of the file).
   */
  drawObject(page: MetaPage, aobj: MetaObject): void {
    switch (aobj.metaType) {
      case MetaObjectType.Text: {
        const obj = aobj as MetaObjectText;
        const rec: Rect = { left: aobj.left, top: aobj.top, width: obj.width, height: obj.height };
        const astring = page.getText(obj);
        const fontstep = TextDevice.fontSizeToStep(obj.fontSize, obj.printStep);
        this.textRect(rec, astring, obj.alignment, obj.cutText, obj.wordWrap, obj.rightToLeft, fontstep, obj.fontStyle, this.isRed(obj.fontColor));
        break;
      }
      case MetaObjectType.Barcode: {
        const bar = aobj as MetaObjectBarcode;
        if (this.supportsNativeBarcode(bar.symbology)) this.nativeBarcodeOut(bar, page.getText(bar));
        break;
      }
      case MetaObjectType.Image:
        // C# parity: without a bitmap decoder (BitmapInfoProvider, null by default) the C# device
        // skips the images, which is all this port does
        break;
    }
  }

  /**
   * GraphicUtils.ColorFromInteger(c) == Color.Red. The equality of Color includes the known
   * color, so an RGB value is never Red, not even 255: only a known color index is, the negative
   * index of Red among the 175 names of KnownColor sorted (.NET 10, the same in every culture
   * tried). And -175, one past the last name, fails in C#.
   */
  private isRed(fontColor: number): boolean {
    if (fontColor === -KNOWN_COLOR_COUNT)
      throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
    return fontColor === KNOWN_COLOR_RED;
  }

  /** The driver in force when the document prints, also before it starts (EffectiveDriverName). */
  private effectiveDriverName(): string {
    if (this.forceDriverName.length > 0) return this.forceDriverName;
    if (this.currentMetafile !== null) return this.printerConfig.driverName(this.currentMetafile.printerSelect);
    return this.printerConfig.driverName(this.fPrinterSelect);
  }

  /**
   * The ESC/POS receipt drivers (the TM88 family) draw every symbology by themselves: QR, PDF417
   * and the linear ones of GS k (SupportsNativeBarcode). Asked while the report is laid out.
   */
  override supportsNativeBarcode(symbology: MetaBarcodeSymbology): boolean {
    return symbology !== MetaBarcodeSymbology.Unknown && isTm88Driver(this.effectiveDriverName());
  }

  /**
   * A barcode the printer draws (NativeBarcodeOut): its codes go before the print line its top
   * falls on, and the lines its box covers are consumed, so the paper the printer feeds while
   * drawing it is not followed by the blank lines the layout reserved. Text on those lines still
   * prints, after the symbol. ESC/POS aligns whole lines, so the box says left, centre or right.
   */
  private nativeBarcodeOut(bar: MetaObjectBarcode, data: string): void {
    const lines = this.lines;
    if (lines.length === 0) return;
    let first = this.getLineIndex(bar.top);
    if (first >= lines.length) first = lines.length - 1;
    let last = this.getLineIndex(bar.top + bar.height) - 1;
    if (last >= lines.length) last = lines.length - 1;
    if (last < first) last = first;
    // The centred case is the receipt case; the tolerance is one column at 12 cpi
    const center = bar.left + Math.trunc(bar.width / 2);
    const half = Math.trunc(this.pageWidth / 2);
    let align = 0;
    if (Math.abs(center - half) <= 120) align = 1;
    else if (center > half) align = 2;
    const symbol =
      bar.symbology === MetaBarcodeSymbology.QR
        ? encodeEscPosQr(data, bar, align)
        : bar.symbology === MetaBarcodeSymbology.PDF417
          ? encodeEscPosPdf417(data, bar, align)
          : encodeEscPos1D(data, bar, align);
    const line = lines[first]!;
    if (line.rawBefore === null) line.rawBefore = [];
    line.rawBefore.push(symbol);
    for (let i = first; i <= last; i++) lines[i]!.consumed = true;
  }

  /**
   * Lays out a text in a rectangle (alignment, clipping, word wrap, justification, right to left)
   * and places each line on the print lines (TextRect).
   */
  textRect(
    arect: Rect,
    text: string,
    alignment: number,
    clipping: boolean,
    wordbreak: boolean,
    righttoleft: boolean,
    fontstep: PrintStepType,
    fontstyle: number,
    red: boolean,
  ): void {
    text = text.split('\r\n').join('\n');
    const singleline = (alignment & AlignmentFlags.SingleLine) > 0;
    if (singleline) wordbreak = false;
    // The step the printer will use: measure, columns and escape codes on the same step
    fontstep = this.nearestFontStep(fontstep);
    const recsize = this.calculateTextExtent(text, arect, wordbreak, singleline, fontstep, clipping);
    const right = arect.left + arect.width;
    const bottom = arect.top + arect.height;
    let posy = arect.top;
    if ((alignment & AlignmentFlags.AlignBottom) > 0) posy = bottom - recsize.height;
    if ((alignment & AlignmentFlags.AlignVCenter) > 0) posy = arect.top + Math.trunc((bottom - arect.top - recsize.height) / 2);
    for (const linfo of this.linfos) {
      let posx = arect.left;
      if ((alignment & AlignmentFlags.AlignRight) > 0) posx = right - linfo.width;
      if ((alignment & AlignmentFlags.AlignHCenter) > 0) posx = arect.left + Math.trunc((right - arect.left - linfo.width) / 2);
      const astring = linfo.size <= 0 ? '' : text.substring(linfo.position, linfo.position + linfo.size);
      if ((alignment & AlignmentFlags.AlignHJustify) > 0) {
        const lwords = astring.split(' ').filter((w) => w.length > 0);
        let alinesize = 0;
        const lwidths: number[] = [];
        for (const nword of lwords) {
          const w = toInt32(roundHalfEven(nword.length * this.stepToTwips(fontstep)));
          lwidths.push(righttoleft ? -w : w);
          alinesize += w;
        }
        let alinedif = arect.width - alinesize;
        if (alinedif > 0) {
          if (lwords.length > 1) alinedif = Math.trunc(alinedif / (lwords.length - 1));
          let currpos: number;
          if (righttoleft) {
            currpos = right;
            alinedif = -alinedif;
          } else currpos = posx;
          for (let idx = 0; idx < lwords.length; idx++) {
            // C# parity: the line of a justified word is taken from its x (posx), not from posy
            this.doTextOut(currpos, posx + linfo.topPos, lwords[idx]!, linfo.width, fontstep, righttoleft, fontstyle, red);
            currpos = currpos + lwidths[idx]! + alinedif;
          }
        } else this.doTextOut(posx, posy + linfo.topPos, astring, linfo.width, fontstep, righttoleft, fontstyle, red);
      } else this.doTextOut(posx, posy + linfo.topPos, astring, linfo.width, fontstep, righttoleft, fontstyle, red);
    }
  }

  /** The print line of a vertical position in twips (GetLineIndex). */
  getLineIndex(posy: number): number {
    let nresult = 0;
    if (this.pageHeight <= 0) return nresult;
    const amax = this.lines.length;
    // The position over the line pitch, halves away from zero (see the C# comment)
    const pitch = TWIPS_PER_INCH / (this.fLinesPerInch / 100.0);
    nresult = toInt32(roundAwayFromZero(posy / pitch));
    if (nresult < 0) nresult = 0;
    if (nresult > amax - 1) nresult = amax - 1;
    return nresult;
  }

  /** The column of a horizontal position in twips at a step (GetColumnNumber). */
  getColumnNumber(posx: number, fontstep: PrintStepType): number {
    let nresult = toInt32(roundHalfEven(posx / this.stepToTwips(fontstep)));
    if (nresult < 0) nresult = 0;
    return nresult;
  }

  /** A line of spaces as wide as the page at a step (GetBlankLine). */
  getBlankLine(fontstep: PrintStepType): string {
    const charcount = toInt32(roundHalfEven(this.pageWidth / this.stepToTwips(fontstep)));
    return charcount > 0 ? ' '.repeat(charcount) : '';
  }

  private line(index: number): PrintLine {
    const l = this.lines[index];
    if (l === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
    return l;
  }

  /** Places a text at a position on its print line, over what the line had (DoTextOut). */
  doTextOut(
    x: number,
    y: number,
    text: string,
    _linewidth: number,
    fontstep: PrintStepType,
    rightoleft: boolean,
    fontstyle: number,
    red: boolean,
  ): void {
    let astring = text;
    if (rightoleft) astring = reverseString(astring);
    const nline = this.line(this.getLineIndex(y));
    if (nline.texts.size < 1) {
      nline.fontStep = fontstep;
      nline.value = this.getBlankLine(fontstep);
    }
    const columnnumber = this.getColumnNumber(x, nline.fontStep);
    const atpos = columnnumber;
    const existing = nline.texts.get(atpos);
    let npostext: PosText;
    if (existing === undefined) {
      const bold = (fontstyle & 1) > 0;
      const underline = (fontstyle & 4) > 0;
      const italic = (fontstyle & 2) > 0;
      const strokeout = (fontstyle & 8) > 0;
      // C# parity: underline does not count, and strikeout is tested twice
      const regular = !bold && !strokeout && !italic && !strokeout;
      npostext = { position: columnnumber, nSize: 0, underline, italic, red, bold, strokeout, regular };
    } else npostext = { ...existing };
    let toposition = astring.length;
    // A text that ends at the last column fits
    if (columnnumber + toposition > nline.value.length) toposition = nline.value.length - columnnumber;
    if (toposition < 0) toposition = 0;
    npostext.nSize = toposition;
    const oldvalue = nline.value;
    nline.value = '';
    if (columnnumber > 0) {
      if (columnnumber > oldvalue.length) {
        nline.value = oldvalue;
        return;
      }
      nline.value = oldvalue.substring(0, columnnumber);
    }
    nline.value = nline.value + astring.substring(0, toposition);
    if (nline.value.length < oldvalue.length) nline.value = nline.value + oldvalue.substring(nline.value.length);
    nline.texts.set(atpos, npostext);
  }

  /** Starts a document: the page, lines per inch and drawer of the metafile, and the driver. */
  override newDocument(meta: MetaFile): void {
    this.printResultStream = new ByteWriter();
    this.whitelines = 0;
    this.blacklines = 0;
    this.previousLine = null;
    this.fLinesPerInch = meta.linesPerInch;
    this.fDrawerBefore = meta.openDrawerBefore;
    this.fDrawerAfter = meta.openDrawerAfter;
    this.pageWidth = meta.customX;
    this.pageHeight = meta.customY;
    this.fPrinterSelect = meta.printerSelect;
    this.updatePrinterConfig();
    this.recalcSize();
  }

  private updatePrinterConfig(): void {
    if (this.forceDriverName.length === 0) this.printerDriver = this.printerConfig.driverName(this.fPrinterSelect);
    else this.printerDriver = this.forceDriverName;
    if (this.overrideOemConvert !== null) this.oemConvert = this.overrideOemConvert;
    else if (this.loadOEMConvert) this.oemConvert = this.printerConfig.oemConvert(this.fPrinterSelect);
    this.fillEscapes();
  }

  /** Loads the escape codes, steps and code page of the current driver (FillEscapes). */
  fillEscapes(): void {
    const e = fillEscapes(this.printerDriver);
    this.escapecodes = e.codes;
    this.masterselect = e.masterselect;
    this.limitedmaster = e.limitedmaster;
    this.condensedmaster = e.condensedmaster;
    this.driverCodePage = e.driverCodePage;
    this.allowedsteps = e.allowedSteps;
  }

  /** Ends the document: the end of print, tear off, drawer and paper cut codes (EndDocument). */
  override endDocument(_meta: MetaFile): void {
    const out = this.printResultStream;
    out.write(this.getEscape(Op.EndPrint));
    out.write(this.getEscape(Op.TearOff));
    if (this.fDrawerAfter) out.write(this.getEscape(Op.Pulse));
    const config = this.printerConfig;
    if (config.cutPaperOption(this.fPrinterSelect)) {
      let init = config.cutPaperOperation(this.fPrinterSelect);
      if (init.length === 0) init = this.getEscape(Op.CutPaper);
      out.write(init);
    }
    if (config.openDrawerOption(this.fPrinterSelect)) {
      let init = config.openDrawerOperation(this.fPrinterSelect);
      if (init.length === 0) init = this.getEscape(Op.OpenDrawer);
      // C# parity: the operation of the configuration is replaced by the escape code of the
      // driver, which no driver defines, so nothing is written
      if (init.length > 0) out.write(this.getEscape(Op.OpenDrawer));
    }
  }

  /** Writes the lines of the current page into the page stream (WriteCurrentPage). */
  writeCurrentPage(cutclearlines: boolean): void {
    const lines = this.lines;
    let lastline = lines.length - 1;
    if (cutclearlines) {
      while (lastline > 0) {
        // A line with a native symbol attached is not blank
        const l = lines[lastline]!;
        if (l.texts.size === 0 && l.rawBefore === null) lastline--;
        else break;
      }
    }
    for (let i = 0; i <= lastline; i++) {
      const l = lines[i]!;
      if (l.rawBefore !== null) for (const raw of l.rawBefore) this.currpageStream.write(raw);
      // The paper under a native symbol was already fed by the printer
      if (l.consumed && l.texts.size === 0) continue;
      const codedstring = this.encodeLine(l, i, this.fullPlain);
      if (l.texts.size === 0) this.whitelines++;
      else this.blacklines++;
      this.currpageStream.write(codedstring);
    }
    if (lastline < lines.length - 1 && !cutclearlines) {
      const escapeff = this.getEscape(Op.FF);
      const escapelf = this.getEscape(Op.LineFeed);
      if (escapeff.length > 0) this.currpageStream.write(escapeff);
      else {
        while (lastline < lines.length - 1) {
          lastline++;
          this.currpageStream.write(escapelf);
          this.linefeeds++;
        }
      }
    }
  }

  /** The codes that select a step (GetFontStepEscape): master select or the cpi codes. */
  getFontStepEscape(nstep: PrintStepType): Uint8Array {
    if (this.masterselect) {
      const condcode = this.limitedmaster ? 0 : this.mastercond;
      let aselect = 0;
      if (this.limitedmaster && this.condensedmaster) {
        switch (nstep) {
          case PrintStepType.cpi17:
            aselect = this.master12;
            break;
          case PrintStepType.cpi12:
            aselect = this.master10;
            break;
          case PrintStepType.cpi6:
            aselect = this.master10 | this.masterwide;
            break;
          default:
            aselect = 0;
        }
      } else {
        switch (nstep) {
          case PrintStepType.cpi20:
            aselect = this.master12 | condcode;
            break;
          case PrintStepType.cpi17:
            aselect = this.master10 | condcode;
            break;
          case PrintStepType.cpi12:
            aselect = this.master12;
            break;
          case PrintStepType.cpi10:
            aselect = this.master10;
            break;
          case PrintStepType.cpi6:
            aselect = this.master12 | this.masterwide;
            break;
          case PrintStepType.cpi5:
            aselect = this.master10 | this.masterwide;
            break;
        }
      }
      return Uint8Array.of(27, 0x21, aselect & 0xff);
    }
    switch (nstep) {
      case PrintStepType.cpi5:
        return this.getEscape(Op.cpi5);
      case PrintStepType.cpi6:
        return this.getEscape(Op.cpi6);
      case PrintStepType.cpi10:
        return this.getEscape(Op.cpi10);
      case PrintStepType.cpi12:
        return this.getEscape(Op.cpi12);
      case PrintStepType.cpi15:
        return this.getEscape(Op.cpi15);
      case PrintStepType.cpi17:
        return this.getEscape(Op.cpi17);
      case PrintStepType.cpi20:
        return this.getEscape(Op.cpi20);
      default:
        return EMPTY;
    }
  }

  /** The bytes of a text: in the driver's code page, in 850 (OEM conversion) or in UTF-8. */
  private encode(text: string): Uint8Array {
    if (this.driverCodePage > 0) return encodeText(text, this.driverCodePage as TextCodePage);
    if (this.oemConvert) return encodeOem(text, 850);
    return encodeUtf8(text);
  }

  /**
   * The bytes of a print line (EncodeLine): the step code when it changes, each text at its
   * column with its style codes, and the carriage return and line feed.
   */
  encodeLine(line: PrintLine, _index: number, plain: boolean): Uint8Array {
    const nline = new ByteWriter();
    if (this.previousLine === null || this.previousLine.fontStep !== line.fontStep) {
      nline.write(this.getFontStepEscape(line.fontStep));
      this.previousLine = { fontStep: line.fontStep };
    }
    let linepos = 0;
    const columns = [...line.texts.keys()].sort((a, b) => a - b);
    for (const column of columns) {
      const npos = line.texts.get(column)!;
      if (linepos < npos.position) {
        nline.write(new Uint8Array(npos.position - linepos).fill(SPACE));
        linepos = npos.position;
      }
      if (!npos.regular) {
        if (npos.underline) nline.write(this.getEscape(Op.Underline));
        if (npos.bold) nline.write(this.getEscape(Op.Bold));
        if (npos.red) nline.write(this.getEscape(Op.RedFont));
        if (npos.strokeout) nline.write(this.getEscape(Op.StrikeOut));
        if (npos.italic) nline.write(this.getEscape(Op.Italic));
      }
      let newstring = line.value.substring(npos.position, npos.position + npos.nSize);
      if (plain) newstring = netTrim(newstring);
      const nbytes = this.encode(newstring);
      nline.write(nbytes);
      // C# parity: the column advances by bytes, not characters (UTF-8 shifts what follows)
      linepos = linepos + nbytes.length;
      if (!npos.regular && !plain) {
        nline.write(this.getEscape(Op.Normal));
        if (npos.red) nline.write(this.getEscape(Op.BlackFont));
      }
    }
    nline.write(this.getEscape(Op.CR));
    const escapeff = this.getEscape(Op.FF);
    nline.write(this.getEscape(Op.LineFeed));
    if (escapeff.length > 0) this.linefeeds++;
    return nline.toArray();
  }

  /** Appends the page to the result (EndPage). */
  override endPage(_meta: MetaFile): void {
    this.printResultStream.write(this.currpageStream.toArray());
  }

  /** The page size: A4 until a size is set (GetPageSize, index 0). */
  override getPageSize(): DevicePageSize {
    if (this.pageWidth === 0) {
      const a4 = PageSizeArray[0]!;
      this.pageWidth = toInt32(roundHalfEven((a4[0] / 1000) * TWIPS_PER_INCH));
      this.pageHeight = toInt32(roundHalfEven((a4[1] / 1000) * TWIPS_PER_INCH));
    }
    return { size: { x: this.pageWidth, y: this.pageHeight }, indexqt: 0 };
  }

  /** The text device measures no images (C# throws NotImplementedException). */
  override graphicExtent(_stream: Uint8Array, _extent: Point, _dpi: number): Point {
    const e = new Error('The method or operation is not implemented.');
    e.name = 'NotImplementedException';
    throw e;
  }

  /** Sets the page size, swapped for landscape (SetPageSize). */
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
    if (this.fOrientation === OrientationType.Landscape) {
      this.pageWidth = newheight;
      this.pageHeight = newwidth;
    } else {
      this.pageWidth = newwidth;
      this.pageHeight = newheight;
    }
    return { x: this.pageWidth, y: this.pageHeight };
  }

  /** The step of a font size, when the text selects it by size (FontSizeToStep). */
  static fontSizeToStep(fontSize: number, select: PrintStepType): PrintStepType {
    if (select !== PrintStepType.BySize) return select;
    switch (fontSize) {
      case 8:
        return PrintStepType.cpi17;
      case 9:
        return PrintStepType.cpi15;
      case 10:
        return PrintStepType.cpi12;
      case 11:
      case 12:
        return PrintStepType.cpi10;
      case 13:
      case 14:
      case 15:
        return PrintStepType.cpi6;
      default:
        if (fontSize < 8) return PrintStepType.cpi20;
        if (fontSize > 15) return PrintStepType.cpi5;
        return PrintStepType.cpi10;
    }
  }

  /** The extent of a text on the character grid of the driver (TextExtent). */
  override textExtent(aobj: TextObjectStruct, extent: Point): Point {
    if (aobj.fontRotation !== 0) return { x: extent.x, y: extent.y };
    const maxextent = { x: extent.x, y: extent.y };
    const singleline = (aobj.alignment & AlignmentFlags.SingleLine) > 0;
    const fontstep = TextDevice.fontSizeToStep(aobj.fontSize, aobj.printStep);
    const ntext = aobj.text.split('\r\n').join('\n');
    const rect = this.calculateTextExtent(ntext, { left: 0, top: 0, width: extent.x, height: 0 }, aobj.wordWrap, singleline, fontstep, aobj.cutText);
    let result: Point = { x: rect.left + rect.width, y: rect.top + rect.height };
    if (aobj.cutText && maxextent.y < result.y) result = { x: result.x, y: maxextent.y };
    return result;
  }

  /** Writes the init code of the driver and the drawer pulse before printing (WriteInit). */
  writeInit(): void {
    this.currpageStream.write(this.getEscape(Op.InitPrinter));
    if (this.fDrawerBefore) this.currpageStream.write(this.getEscape(Op.Pulse));
  }

  /** The n/216 (or n/180) code of the lines per inch, in the decimal arithmetic of C#. */
  private lineSpacingCode(escape: Uint8Array, units: number): Uint8Array {
    const n = decRound(decMultiply(decDivide({ m: 10n, s: 1 }, decDivide(dec(this.fLinesPerInch), dec(100))), dec(units)));
    const out = new Uint8Array(escape.length + 1);
    out.set(escape);
    out[escape.length] = decToInteger(n, 0, 255, 'an unsigned byte');
    return out;
  }

  /** Writes the line spacing code of the lines per inch (WriteInterLine). */
  writeInterLine(): void {
    let s: Uint8Array;
    switch (this.fLinesPerInch) {
      case 600:
        s = this.getEscape(Op.LineSpace6);
        break;
      case 800:
        s = this.getEscape(Op.LineSpace8);
        break;
      default:
        s = this.getEscape(Op.LineSpace7_72);
        if (this.fLinesPerInch !== 972 || s.length === 0) {
          s = this.getEscape(Op.LineSpacen_216);
          if (s.length > 0) s = this.lineSpacingCode(s, 216);
          else {
            s = this.getEscape(Op.LineSpacen_180);
            if (s.length > 0) s = this.lineSpacingCode(s, 180);
            else {
              s = this.getEscape(Op.Linespacen_60);
              // C# parity: n/60 is computed as n/180 too
              if (s.length > 0) s = this.lineSpacingCode(s, 180);
            }
          }
        }
        break;
    }
    this.currpageStream.write(s);
  }

  /**
   * Prints a metafile laid out with this device (Print): the pages from fromPage to toPage, each
   * one written as all its print lines. False when the metafile has fewer pages than fromPage.
   */
  override print(meta: MetaFile): boolean {
    this.currpageStream = new ByteWriter();
    super.print(meta);
    let current = this.fromPage - 1;
    if (meta.pages.currentCount < this.fromPage) return false;
    this.startPages(meta);
    while (meta.pages.currentCount > current) {
      if (this.printPage(meta, current++)) break;
    }
    this.endDocument(meta);
    return true;
  }

  /**
   * Runs a report prepared with this device and prints it, as C# Print does with a report: the
   * layout begins (BeginPrint), the document starts, and each page is drawn as soon as it is
   * generated (the totals of a later page are not on it yet, as in C#). False when the report
   * has nothing to print (NoDataToPrintException, unless emptyReportThrowException) or fewer
   * pages than fromPage; the bytes are in printResult.
   */
  async printReport(run: TextReportRun): Promise<boolean> {
    const meta = run.metaFile;
    this.currpageStream = new ByteWriter();
    this.currentMetafile = meta;
    try {
      await run.begin();
    } catch (e) {
      if (this.emptyReportThrowException || !isNoDataToPrint(e)) throw e;
      if (this.noData === null || !this.noData()) this.processNoDataToPrint();
      this.printResultStream = new ByteWriter();
      return false;
    }
    this.newDocument(meta);
    let current = this.fromPage - 1;
    await run.requestPage(current);
    if (meta.pages.currentCount < this.fromPage) {
      await run.close?.();
      return false;
    }
    this.startPages(meta);
    while (meta.pages.currentCount > current) {
      const index = current++;
      this.beginPage(meta, index);
      await run.requestPage(current);
      if (this.finishPage(meta, current)) break;
    }
    this.endDocument(meta);
    await run.close?.();
    return true;
  }

  /** The page size and orientation of the first page, set before the pages are written. */
  private startPages(meta: MetaFile): void {
    this.setPageSize(meta.pages.get(0).pageDetail);
    this.setOrientation(meta.orientation);
  }

  /** One turn of the C# print loop for a complete metafile; true when it was the last page. */
  private printPage(meta: MetaFile, index: number): boolean {
    this.beginPage(meta, index);
    return this.finishPage(meta, index + 1);
  }

  /** The init codes before the first page, or a new page; then the page drawn. */
  private beginPage(meta: MetaFile, index: number): void {
    const apage = meta.pages.get(index);
    if (index === this.fromPage - 1) {
      this.writeInit();
      this.writeInterLine();
      this.writePageSize();
    } else if (index <= this.toPage - 1 && index >= this.fromPage - 1) this.newPage(meta, apage);
    this.drawPage(meta, apage);
  }

  /** Writes the page; true when it was the last one to print. */
  private finishPage(meta: MetaFile, next: number): boolean {
    if (next > this.toPage - 1 || next >= meta.pages.currentCount) {
      this.writeCurrentPage(isReceiptDriver(this.printerDriver));
      this.endPage(meta);
      return true;
    }
    this.writeCurrentPage(false);
    this.endPage(meta);
    return false;
  }

  /** Starts a page: a new page stream and new print lines (NewPage). */
  override newPage(_meta: MetaFile, _page: MetaPage): void {
    this.currpageStream = new ByteWriter();
    this.recalcSize();
  }

  /** The print lines of a page: its height at the lines per inch (RecalcSize, in decimal). */
  recalcSize(): void {
    const inches = decDivide(dec(this.pageHeight), dec(TWIPS_PER_INCH));
    const lpi = decDivide(dec(this.fLinesPerInch), dec(100));
    const numberoflines = decToInteger(decRound(decMultiply(inches, lpi)), -2147483648, 2147483647, 'an Int32');
    this.lines = [];
    for (let i = 0; i < numberoflines; i++) this.lines.push(new PrintLine());
    this.linefeeds = 0;
  }

  /** Writes the page length code of the driver and selects the regular font (WritePageSize). */
  writePageSize(): void {
    if (this.lines.length > 255) throw new Error('Se ha excedido el máximo número de líneas 255 en writepagesize');
    const plinecount = this.lines.length;
    switch (this.printerDriver) {
      case 'EPSON':
      case 'EPSON-ESCPQ':
      case 'EPSON-ESCP':
      case 'EPSON-MASTER':
      case 'IBMPROPRINTER':
        this.currpageStream.write(Uint8Array.of(27, 0x43, plinecount));
        break;
      case 'HP-PCL':
        this.currpageStream.write(Uint8Array.of(27, 38, 108, plinecount, 80));
        break;
    }
    this.currpageStream.write(this.getEscape(Op.Normal));
  }

  /** The step the driver prints a step at (NearestFontStep). */
  nearestFontStep(fontstep: PrintStepType): PrintStepType {
    if (this.allowedsteps === null) throw new Error('TextDevice: newDocument was not called');
    const r = this.allowedsteps.get(fontstep);
    if (r === undefined) throw new Error('The given key was not present in the dictionary.');
    return r;
  }

  /** The width of a character at a step, in twips (StepToTwips). */
  stepToTwips(step: PrintStepType): number {
    switch (step) {
      case PrintStepType.cpi20:
        return TWIPS_PER_INCH / 20.0;
      case PrintStepType.cpi17:
        return TWIPS_PER_INCH / 17.14;
      case PrintStepType.cpi15:
        return TWIPS_PER_INCH / 15.0;
      case PrintStepType.cpi12:
        return TWIPS_PER_INCH / 12.0;
      case PrintStepType.cpi6:
        return TWIPS_PER_INCH / 6.0;
      case PrintStepType.cpi5:
        return TWIPS_PER_INCH / 5.0;
      default:
        return TWIPS_PER_INCH / 10.0;
    }
  }

  /** The width of a character; null, carriage return and line feed have none (CalcCharWidth). */
  calcCharWidth(charcode: string, step: PrintStepType): number {
    if (charcode === '\0' || charcode === '\r' || charcode === '\n') return 0;
    return this.stepToTwips(step);
  }

  /** The lines of the last measured text (linfos). */
  get lineInfo(): readonly LineInfo[] {
    return this.linfos;
  }

  /**
   * Measures a text in a rectangle and fills the lines of the layout (CalculateTextExtent): word
   * wrap, single line, and the lines past the height dropped when it clips. Returns the extent:
   * the left and top of the rectangle, the widest line and the height of the lines.
   */
  calculateTextExtent(text: string, rect: Rect, wordbreak: boolean, singleline: boolean, fontstep: PrintStepType, doclip: boolean): Rect {
    const linespacing = toInt32(roundHalfEven(TWIPS_PER_INCH / (this.fLinesPerInch / 100.0)));
    const leading = 0;
    let maxrightindex = -1;
    fontstep = this.nearestFontStep(fontstep);
    let currentwidth = 0;
    let maxwidth = 0;
    let newsize = 0;
    let linebreakpos = 0;
    let wasspace = false;
    let infocount = 0;
    let lastsize = 0;
    let lastsizewithoutspace = 0;
    let lastindexwithoutspace = 0;
    let currenttoppos = 0;
    const recwidth = rect.width;
    const linfos: LineInfo[] = [];
    this.linfos = linfos;
    let astring = text;
    if (singleline) astring = astring.replace(/\r/g, ' ').replace(/\n/g, ' ');
    const addLine = (lastLine: boolean, startposition: number, cutindex: number): void => {
      const linfo = newLineInfo();
      linfo.lastLine = lastLine;
      linfo.position = startposition;
      linfo.step = fontstep;
      linfo.size = cutindex - startposition;
      if (linfo.size < 0) linfo.size = 0;
      linfo.width = toInt32(roundHalfEven(currentwidth));
      if (currentwidth > maxwidth) maxwidth = currentwidth;
      linfo.topPos = currenttoppos - leading;
      linfo.height = linespacing;
      currenttoppos = currenttoppos + linespacing;
      if (!doclip || lineFits(linfos.length, linfo.height, rect.height)) {
        linfos.push(linfo);
        infocount++;
      }
    };
    let i = 0;
    let startposition = 0;
    while (i < astring.length) {
      const ch = astring[i]!;
      if (ch === '\n') {
        let cutindex = i;
        if (wasspace) {
          cutindex = lastindexwithoutspace + 1;
          currentwidth = lastsizewithoutspace;
        }
        if (maxrightindex >= 0) cutindex = maxrightindex;
        addLine(true, startposition, cutindex);
        currentwidth = 0;
        startposition = i + 1;
        maxrightindex = -1;
      } else {
        newsize = this.calcCharWidth(ch, fontstep);
        if (currentwidth + newsize <= recwidth || !wordbreak) {
          // The character fits in the line (or nothing wraps)
          if (currentwidth + newsize > recwidth) if (maxrightindex < 0) maxrightindex = i - 1;
          if (ch === ' ') {
            if (!wasspace) {
              wasspace = true;
              lastsizewithoutspace = currentwidth;
              if (i > startposition) {
                lastindexwithoutspace = i - 1;
                linebreakpos = i - 1;
              } else lastindexwithoutspace = 0;
            }
          } else {
            wasspace = false;
            if (isSign(ch)) {
              linebreakpos = i;
              lastsize = currentwidth + newsize;
            }
          }
          currentwidth = currentwidth + newsize;
        } else if (wordbreak) {
          // The character does not fit: the line ends
          if (currentwidth === 0 && startposition === i) i++;
          let cutindex = i;
          if (linebreakpos > 0) {
            cutindex = linebreakpos + 1;
            i = linebreakpos;
            currentwidth = lastsize;
          } else i--;
          if (wasspace) {
            cutindex = lastindexwithoutspace + 1;
            currentwidth = lastsizewithoutspace;
          }
          if (maxrightindex >= 0) cutindex = maxrightindex;
          addLine(false, startposition, cutindex);
          currentwidth = 0;
          linebreakpos = 0;
          startposition = i + 1;
          maxrightindex = -1;
          // Skip spaces
          while (startposition < astring.length - 1) {
            if (astring[startposition] === ' ') {
              startposition++;
              i = startposition - 1;
            } else break;
          }
        } else if (maxrightindex < 0) maxrightindex = i - 1;
      }
      i++;
    }
    if (startposition < astring.length) {
      let cutindex = i;
      if (wasspace) {
        cutindex = lastindexwithoutspace + 1;
        currentwidth = lastsizewithoutspace;
      }
      if (maxrightindex >= 0) cutindex = maxrightindex;
      addLine(true, startposition, cutindex);
      maxrightindex = -1;
    }
    let totalheight = 0;
    if (infocount > 0) totalheight = infocount * linespacing + leading;
    return { left: rect.left, top: rect.top, width: toInt32(roundHalfEven(maxwidth)), height: totalheight };
  }
}

/**
 * Runs a report prepared with a TextDevice and returns the bytes for the printer (an empty array
 * when it has nothing to print).
 */
export async function runReportToText(run: TextReportRun & { readonly device: PrintOut }): Promise<Uint8Array> {
  const device = run.device;
  if (!(device instanceof TextDevice)) throw new TypeError('runReportToText: the report was not prepared with a TextDevice');
  await device.printReport(run);
  return device.printResult;
}
