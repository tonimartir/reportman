// Port of the runtime part of Reportman.Reporting.BarcodeItem (BarcodeItem.cs) and of
// BaseReport.BarcodeOp: the text of the item encoded with its symbology and drawn into the
// metafile, each bar (or dark QR module) a filled rectangle; a rotation turns the corners of
// each bar and draws the rectangle that bounds them.
//
// C# parity: the item draws no human-readable text, MSI, PostNet and Codabar draw nothing (their
// encoders are empty in C#) and the item has no GetExtension of its own (PrintPosItem's).

import { BarcodeItem as BarcodeModel, BarcodeType } from 'reportman-lib';
import {
  BrushType,
  MetaBarcodeEcc,
  MetaBarcodeSymbology,
  MetaObjectBarcode,
  MetaObjectDraw,
  MetaObjectType,
  PenType,
  ShapeType,
  type MetaFile,
  type Point,
  type PrintOut,
} from 'reportman-metafile';
import { substringNet, trimNet } from '../../util/chars.js';
import { messageOf, NamedException } from '../../util/netexception.js';
import { NumberStyles, parseInt32 } from '../../util/numberparse.js';
import { ParamType, Variant } from '../../variant/variant.js';
import { NotSupportedYetError } from '../../data/errors.js';
import { ReportException } from '../errors.js';
import { PrintPosItem, type PartialRef, type SubReportEvent } from '../items.js';
import type { ReportRuntime } from '../report.js';
import { CODE128_PATTERNS, CODE128_START_A, CODE128_START_B, CODE128_START_C, CODE128_STOP, encodeCode128 } from './code128.js';
import { castInt32, charAt, convertToInt16, convertToInt32, i32, idiv, indexOutOfRange, mathRound, type IntPoint } from './netutil.js';
import { draw2DBarcode } from './pdf417.js';
import { qrMatrix } from './qrcode.js';

// ---------------------------------------------------------------------------------------------
// Tables

/** A [rows, columns] table of characters (a C# char[,]) with the .NET bounds checks. */
function cell(table: readonly string[], row: number, column: number): string {
  if (row < 0 || row >= table.length) throw indexOutOfRange();
  const r = table[row]!;
  if (column < 0 || column >= r.length) throw indexOutOfRange();
  return r.charAt(column);
}

const PARITY_EAN13 = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'];
// Pattern for Barcode EAN A: L1 S1 L2 S2
const EAN_A = ['2605', '1615', '1516', '0805', '0526', '0625', '0508', '0706', '0607', '2506'];
// Pattern for Barcode EAN B: L1 S1 L2 S2
const EAN_B = ['0517', '0616', '1606', '0535', '1705', '0715', '3505', '1525', '2515', '1507'];
// Pattern for Barcode EAN C: S1 L1 S2 L2
const EAN_C = ['7150', '6160', '6061', '5350', '5071', '5170', '5053', '5251', '5152', '7051'];
// Pattern for Barcode 2 of 5
const TABLE_2_5 = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

interface Code39Entry {
  c: string;
  data: string;
  chk: number;
}

const TABLE_39: readonly Code39Entry[] = (
  [
    ['0', '505160605', 0], ['1', '605150506', 1], ['2', '506150506', 2], ['3', '606150505', 3],
    ['4', '505160506', 4], ['5', '605160505', 5], ['6', '506160505', 6], ['7', '505150606', 7],
    ['8', '605150605', 8], ['9', '506150605', 9], ['A', '605051506', 10], ['B', '506051506', 11],
    ['C', '606051505', 12], ['D', '505061506', 13], ['E', '605061505', 14], ['F', '506061505', 15],
    ['G', '505051606', 16], ['H', '605051605', 17], ['I', '506051605', 18], ['J', '505061605', 19],
    ['K', '605050516', 20], ['L', '506050516', 21], ['M', '606050515', 22], ['N', '505060516', 23],
    ['O', '605060515', 24], ['P', '506060515', 25], ['Q', '505050616', 26], ['R', '605050615', 27],
    ['S', '506050615', 28], ['T', '505060615', 29], ['U', '615050506', 30], ['V', '516050506', 31],
    ['W', '616050505', 32], ['X', '515060506', 33], ['Y', '615060505', 34], ['Z', '516060505', 35],
    ['-', '515050606', 36], ['.', '615050605', 37], [' ', '516050605', 38], ['*', '515060605', 0],
    ['$', '515151505', 39], ['/', '515150515', 40], ['+', '515051515', 41], ['%', '505151515', 42],
  ] as const
).map(([c, data, chk]) => ({ c, data, chk }));

const CODE39X: readonly string[] = [
  '%U', '$A', '$B', '$C', '$D', '$E', '$F', '$G', '$H', '$I', '$J', '$K', '$L', '$M', '$N', '$O',
  '$P', '$Q', '$R', '$S', '$T', '$U', '$V', '$W', '$X', '$Y', '$Z', '%A', '%B', '%C', '%D', '%E',
  ' ', '/A', '/B', '/C', '/D', '/E', '/F', '/G', '/H', '/I', '/J', '/K', '/L', '/M', '/N', '/O',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '/Z', '%F', '%G', '%H', '%I', '%J',
  '%V', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
  'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '%K', '%L', '%M', '%N', '%O',
  '%W', '+A', '+B', '+C', '+D', '+E', '+F', '+G', '+H', '+I', '+J', '+K', '+L', '+M', '+N', '+O',
  '+P', '+Q', '+R', '+S', '+T', '+U', '+V', '+W', '+X', '+Y', '+Z', '%P', '%Q', '%R', '%S', '%T',
];

const TABLE_93: readonly (readonly [string, string])[] = [
  ['0', '131112'], ['1', '111213'], ['2', '111312'], ['3', '111411'], ['4', '121113'], ['5', '121212'],
  ['6', '121311'], ['7', '111114'], ['8', '131211'], ['9', '141111'], ['A', '211113'], ['B', '211212'],
  ['C', '211311'], ['D', '221112'], ['E', '221211'], ['F', '231111'], ['G', '112113'], ['H', '112212'],
  ['I', '112311'], ['J', '122112'], ['K', '132111'], ['L', '111123'], ['M', '111222'], ['N', '111321'],
  ['O', '121122'], ['P', '131121'], ['Q', '212112'], ['R', '212211'], ['S', '211122'], ['T', '211221'],
  ['U', '221121'], ['V', '222111'], ['W', '112122'], ['X', '112221'], ['Y', '122121'], ['Z', '123111'],
  ['-', '121131'], ['.', '311112'], [' ', '311211'], ['$', '321111'], ['/', '112131'], ['+', '113121'],
  ['%', '211131'],
  // only used for Extended Code 93
  ['[', '121221'], [']', '312111'], ['{', '311121'], ['}', '122211'],
];

const CODE93X: readonly string[] = [
  ']U', '[A', '[B', '[C', '[D', '[E', '[F', '[G', '[H', '[I', '[J', '[K', '[L', '[M', '[N', '[O',
  '[P', '[Q', '[R', '[S', '[T', '[U', '[V', '[W', '[X', '[Y', '[Z', ']A', ']B', ']C', ']D', ']E',
  ' ', '{A', '{B', '{C', '{D', '{E', '{F', '{G', '{H', '{I', '{J', '{K', '{L', '{M', '{N', '{O',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '{Z', ']F', ']G', ']H', ']I', ']J',
  ']V', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
  'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', ']K', ']L', ']M', ']N', ']O',
  ']W', '}A', '}B', '}C', '}D', '}E', '}F', '}G', '}H', '}I', '}J', '}K', '}L', '}M', '}N', '}O',
  '}P', '}Q', '}R', '}S', '}T', '}U', '}V', '}W', '}X', '}Y', '}Z', ']P', ']Q', ']R', ']S', ']T',
];

/** The line types of DoLines: half is a black line with 2/5 height (used for PostNet). */
const enum LineType {
  White,
  Black,
  Half,
}

// ---------------------------------------------------------------------------------------------
// The item

/**
 * EccToMeta: the item's error correction level as the metafile vocabulary (2 = L, 3 = M, 4 = Q,
 * 5 = H; anything else, the -1 automatic default included, is L).
 */
export function eccToMeta(eccLevel: number): MetaBarcodeEcc {
  switch (eccLevel) {
    case 3:
      return MetaBarcodeEcc.M;
    case 4:
      return MetaBarcodeEcc.Q;
    case 5:
      return MetaBarcodeEcc.H;
    default:
      return MetaBarcodeEcc.L;
  }
}

/**
 * NativeSymbology: the device symbology of a barcode type, or Unknown for the ones no receipt
 * printer draws natively (MSI, PostNet, industrial and matrix 2 of 5).
 */
export function nativeSymbology(type: BarcodeType): MetaBarcodeSymbology {
  switch (type) {
    case BarcodeType.CodeQR:
      return MetaBarcodeSymbology.QR;
    case BarcodeType.CodePDF417:
      return MetaBarcodeSymbology.PDF417;
    case BarcodeType.Code128:
    case BarcodeType.Code128A:
    case BarcodeType.Code128B:
    case BarcodeType.Code128C:
      return MetaBarcodeSymbology.Code128;
    case BarcodeType.CodeEAN13:
      return MetaBarcodeSymbology.EAN13;
    case BarcodeType.CodeEAN8:
      return MetaBarcodeSymbology.EAN8;
    case BarcodeType.Code39:
    case BarcodeType.Code39Extended:
      return MetaBarcodeSymbology.Code39;
    case BarcodeType.Code93:
    case BarcodeType.Code93Extended:
      return MetaBarcodeSymbology.Code93;
    case BarcodeType.Code_2_5_interleaved:
      return MetaBarcodeSymbology.ITF;
    case BarcodeType.CodeCodabar:
      return MetaBarcodeSymbology.Codabar;
    default:
      return MetaBarcodeSymbology.Unknown;
  }
}

function translate2D(a: IntPoint, b: IntPoint): IntPoint {
  return { x: i32(a.x + b.x), y: i32(a.y + b.y) };
}

function rotate2D(p: IntPoint, alpha: number): IntPoint {
  const sinus = Math.sin(alpha);
  const cosinus = Math.cos(alpha);
  const x = convertToInt32(mathRound(p.x * cosinus + p.y * sinus));
  const y = convertToInt32(mathRound(-p.x * sinus + p.y * cosinus));
  return { x, y };
}

/**
 * The rectangle a, b, c, d of a bar or module, rotated around the origin (its bounds) or moved
 * to it; returns the top left and bottom right corners.
 */
function placeRectangle(a: IntPoint, b: IntPoint, c: IntPoint, d: IntPoint, origin: IntPoint, rotation: number): [IntPoint, IntPoint] {
  if (rotation !== 0) {
    const alpha = ((rotation / 10) * Math.PI) / 180.0;
    a = translate2D(rotate2D(a, alpha), origin);
    b = translate2D(rotate2D(b, alpha), origin);
    c = translate2D(rotate2D(c, alpha), origin);
    d = translate2D(rotate2D(d, alpha), origin);
    const left = Math.min(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const top = Math.min(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const right = Math.max(Math.max(a.x, b.x), Math.max(c.x, d.x));
    const bottom = Math.max(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return [
      { x: left, y: top },
      { x: right, y: bottom },
    ];
  }
  return [translate2D(a, origin), translate2D(c, origin)];
}

/** A filled rectangle (PenType.Clear) from the corner a to the corner c. */
function filledRectangle(metafile: MetaFile, a: IntPoint, c: IntPoint, penWidth: number, penColor: number, brushColor: number): void {
  const metaobj = new MetaObjectDraw();
  metaobj.metaType = MetaObjectType.Draw;
  metaobj.top = a.y;
  metaobj.left = a.x;
  metaobj.width = i32(c.x - a.x);
  metaobj.height = i32(c.y - a.y);
  metaobj.drawStyle = ShapeType.Rectangle;
  metaobj.brushStyle = BrushType.Solid;
  metaobj.penStyle = PenType.Clear;
  metaobj.penWidth = penWidth;
  metaobj.penColor = penColor;
  metaobj.brushColor = brushColor;
  metafile.pages.get(metafile.currentPage).objects.push(metaobj);
}

/** BarcodeItem: an expression drawn as a barcode. */
export class BarcodeItem extends PrintPosItem {
  private readonly modules = [0, 1, 2, 3];
  private fUpdated = false;
  private fValue: Variant = Variant.null;
  expression: string;
  modul: number;
  ratio: number;
  barType: BarcodeType;
  checksum: boolean;
  displayFormat: string;
  /** In tenths of a degree. */
  rotation: number;
  bColor: number;
  backColor: number;
  transparent: boolean;
  numColumns: number;
  numRows: number;
  /** PDF417: -1 Auto, 0 to 8 the level. QR: 3 M, 4 Q, 5 H, any other value L. */
  eccLevel: number;
  truncated: boolean;
  /** The text last evaluated and encoded. */
  currentText = '';

  constructor(report: ReportRuntime, model: BarcodeModel) {
    super(report, model);
    this.expression = model.expression;
    this.modul = model.modul;
    this.ratio = model.ratio;
    this.barType = model.barType;
    this.checksum = model.checksum;
    this.displayFormat = model.displayFormat;
    this.rotation = model.rotation;
    this.bColor = model.bColor;
    this.backColor = model.backColor;
    this.transparent = model.transparent;
    this.numColumns = model.numColumns;
    this.numRows = model.numRows;
    this.eccLevel = model.eccLevel;
    this.truncated = model.truncated;
  }

  private evaluate(): void {
    if (this.fUpdated) return;
    try {
      this.fValue = this.report.evaluator.evaluateText(this.expression);
      this.fUpdated = true;
    } catch (e) {
      throw new ReportException(messageOf(e) + ':Barcode', this.name, 'Expression');
    }
  }

  override subReportChanged(newstate: SubReportEvent, newgroup: string): void {
    super.subReportChanged(newstate, newgroup);
    this.fUpdated = false;
  }

  private getText(): string {
    const expre = trimNet(this.expression);
    if (expre.length === 0) return '';
    try {
      this.evaluate();
      return this.fValue.toFormatString(this.report.evaluator.context, this.displayFormat, ParamType.Unknown, true);
    } catch (e) {
      // C# parity: an error of Evaluate is wrapped twice (":Barcode:Barcode")
      throw new ReportException(messageOf(e) + ':Barcode', this.name, 'Expression');
    }
  }

  protected override doPrint(
    adriver: PrintOut,
    aposx: number,
    aposy: number,
    newwidth: number,
    newheight: number,
    metafile: MetaFile,
    maxExtent: Point,
    partialPrint: PartialRef,
  ): void {
    super.doPrint(adriver, aposx, aposy, newwidth, newheight, metafile, maxExtent, partialPrint);
    this.currentText = this.getText();
    try {
      if (this.barType === BarcodeType.CodeQR) {
        this.printQr(adriver, aposx, aposy, metafile);
      } else {
        // The same door as the QR: a driver that draws this symbology by itself gets the barcode
        // object; the rest get the bars.
        const simbologia = nativeSymbology(this.barType);
        if (simbologia !== MetaBarcodeSymbology.Unknown && adriver.supportsNativeBarcode(simbologia) && this.emitNativeBarcode(simbologia))
          return;
        const data = this.calculateBarcode();
        // draw the barcode
        this.doLines(data, aposx, aposy, metafile);
      }
    } catch (e) {
      if (e instanceof NotSupportedYetError) throw e;
      throw new ReportException(messageOf(e) + ':' + this.report.translator.translateStr(573), this.name, 'Barcode');
    }
  }

  /**
   * EmitNativeBarcode: a linear barcode or PDF417 as a native object (for a receipt printer).
   * C# takes its module count from the ZXing.Net writers of each symbology (MultiFormatWriter),
   * which @zxing/library does not have: a device that draws them natively is not supported yet.
   */
  private emitNativeBarcode(simbologia: MetaBarcodeSymbology): boolean {
    // C# parity: an empty text is drawn as bars
    if (this.currentText.length === 0) return false;
    throw new NotSupportedYetError(
      'Barcodes drawn by the device itself (symbology ' + MetaBarcodeSymbology[simbologia] + ', the item ' + this.name + ')',
    );
  }

  private printQr(adriver: PrintOut, aposx: number, aposy: number, metafile: MetaFile): void {
    const qrResult = qrMatrix(this.currentText, this.eccLevel);
    const barcodeHeight = qrResult.height;
    const barcodeWidth = qrResult.width;
    const page = metafile.pages.get(metafile.currentPage);
    // The driver that draws the QR by itself gets the barcode, not its modules; Modules counts what
    // ZXing returned (the symbol plus its quiet zone), the grid the modules below spread over.
    if (adriver.supportsNativeBarcode(MetaBarcodeSymbology.QR)) {
      const nativo = new MetaObjectBarcode();
      nativo.metaType = MetaObjectType.Barcode;
      nativo.left = aposx;
      nativo.top = aposy;
      nativo.width = this.width;
      nativo.height = this.height;
      nativo.textP = page.addString(this.currentText);
      nativo.textS = this.currentText.length;
      nativo.symbology = MetaBarcodeSymbology.QR;
      nativo.ecc = eccToMeta(this.eccLevel);
      nativo.modules = barcodeWidth;
      nativo.rows = barcodeHeight;
      page.objects.push(nativo);
      return;
    }
    let squareWidth = idiv(this.width, barcodeWidth);
    let squareHeight = idiv(this.height, barcodeHeight);
    // Center barcode in rectangle
    if (squareWidth > squareHeight) {
      const dif = squareWidth - squareHeight;
      aposx = i32(aposx + idiv(Math.imul(dif, barcodeWidth), 2));
      squareWidth = squareHeight;
    } else {
      const dif = squareHeight - squareWidth;
      aposy = i32(aposy + idiv(Math.imul(dif, barcodeHeight), 2));
      squareHeight = squareWidth;
    }
    const origin: IntPoint = {
      x: i32(aposx + idiv(Math.imul(squareWidth, barcodeWidth), 2)),
      y: i32(aposy + idiv(Math.imul(squareHeight, barcodeHeight), 2)),
    };
    // The quiet background goes down once, as a single rectangle; only the dark modules follow
    if (!this.transparent) {
      const fondo = new MetaObjectDraw();
      fondo.metaType = MetaObjectType.Draw;
      fondo.left = aposx;
      fondo.top = aposy;
      fondo.width = Math.imul(squareWidth, barcodeWidth);
      fondo.height = Math.imul(squareHeight, barcodeHeight);
      fondo.drawStyle = ShapeType.Rectangle;
      fondo.brushStyle = BrushType.Solid;
      fondo.penStyle = PenType.Clear;
      fondo.penWidth = 0;
      fondo.penColor = this.backColor;
      fondo.brushColor = this.backColor;
      page.objects.push(fondo);
    }
    for (let rowIndex = 0; rowIndex < barcodeHeight; rowIndex++) {
      for (let column = 0; column < barcodeWidth; column++) {
        const xadd = i32(Math.imul(squareWidth, column) - idiv(Math.imul(squareWidth, barcodeWidth), 2));
        const yadd = i32(Math.imul(squareHeight, rowIndex) - idiv(Math.imul(squareHeight, barcodeHeight), 2));
        // a, b, c, d builds the rectangle we want to draw
        const [a, c] = placeRectangle(
          { x: xadd, y: yadd },
          { x: xadd, y: i32(yadd + squareHeight) },
          { x: i32(xadd + squareWidth), y: i32(yadd + squareHeight) },
          { x: i32(xadd + squareWidth), y: yadd },
          origin,
          this.rotation,
        );
        // Only the dark modules are painted, filled and not stroked
        if (qrResult.get(column, rowIndex)) filledRectangle(metafile, a, c, 0, this.bColor, this.bColor);
      }
      // C# parity: aposy moves down a row, and nothing reads it
      aposy = i32(aposy + squareHeight);
    }
  }

  /** CalculateBarcode: the bar and space widths of the text ('0'-'3' spaces, '5'-'8' bars). */
  calculateBarcode(): string {
    let data = '';
    if (this.barType === BarcodeType.CodePDF417) return this.currentText;
    // Calculate the with of lines
    this.makeModules();
    switch (this.barType) {
      case BarcodeType.Code_2_5_interleaved:
        data = this.code25Interleaved();
        break;
      case BarcodeType.Code_2_5_industrial:
        data = this.code25Industrial();
        break;
      case BarcodeType.Code_2_5_matrix:
        data = this.code25Matrix();
        break;
      case BarcodeType.Code39:
        data = this.code39();
        break;
      case BarcodeType.Code39Extended:
        data = this.code39Extended();
        break;
      case BarcodeType.Code128A:
      case BarcodeType.Code128B:
      case BarcodeType.Code128C:
      case BarcodeType.Code128:
        data = this.code128();
        break;
      case BarcodeType.Code93:
        data = this.code93();
        break;
      case BarcodeType.Code93Extended:
        data = this.code93Extended();
        break;
      case BarcodeType.CodeMSI:
      case BarcodeType.CodePostNet:
      case BarcodeType.CodeCodabar:
        // C# parity: Code_MSI, Code_PostNet and Code_Codabar return an empty pattern
        data = '';
        break;
      case BarcodeType.CodeEAN8:
        data = this.codeEAN8();
        break;
      case BarcodeType.CodeEAN13:
        data = this.codeEAN13();
        break;
    }
    return data;
  }

  private makeModules(): void {
    switch (this.barType) {
      case BarcodeType.Code_2_5_interleaved:
      case BarcodeType.Code_2_5_industrial:
      case BarcodeType.Code39:
      case BarcodeType.Code39Extended:
      case BarcodeType.CodeEAN8:
      case BarcodeType.CodeEAN13:
        if (this.ratio < 2.0) this.ratio = 2.0;
        if (this.ratio > 3.0) this.ratio = 3.0;
        break;
      case BarcodeType.Code_2_5_matrix:
        if (this.ratio < 2.25) this.ratio = 2.25;
        if (this.ratio > 3.25) this.ratio = 3.25;
        break;
    }
    const m = this.modules;
    m[0] = this.modul;
    m[1] = castInt32(mathRound(this.modul * this.ratio));
    m[2] = idiv(Math.imul(m[1]!, 3), 2);
    m[3] = Math.imul(m[1]!, 2);
    // Code 128 bars and spaces are 1, 2, 3 or 4 modules: the Ratio does not apply
    if (
      this.barType === BarcodeType.Code128 ||
      this.barType === BarcodeType.Code128A ||
      this.barType === BarcodeType.Code128B ||
      this.barType === BarcodeType.Code128C
    ) {
      m[1] = Math.imul(this.modul, 2);
      m[2] = Math.imul(this.modul, 3);
      m[3] = Math.imul(this.modul, 4);
    }
  }

  /** GetEAN: the text with its last digit replaced by the EAN check digit. */
  private getEAN(nr: string): string {
    let sum = 0;
    const tmp = substringNet(nr, 0, nr.length - 1);
    let fak = tmp.length;
    const nfi = this.report.evaluator.context.culture.number;
    for (let i = 0; i < tmp.length; i++) {
      const digit = parseInt32(tmp.charAt(i), NumberStyles.Integer, nfi);
      if (fak % 2 === 0) sum = i32(sum + digit * 1);
      else sum = i32(sum + Math.imul(digit, 3));
      fak--;
    }
    if (sum % 10 === 0) return tmp + '0';
    return tmp + String(10 - (sum % 10));
  }

  private code128(): string {
    const values = encodeCode128(this.currentText, this.barType);
    if (values.length === 0) return '';
    let achecksum = values[0]!;
    for (let i = 1; i < values.length; i++) achecksum = i32(achecksum + Math.imul(values[i]!, i));
    achecksum = achecksum % 103;
    let aresult = '';
    for (const v of values) {
      if (v === 103) aresult += doConvert(CODE128_START_A);
      else if (v === 104) aresult += doConvert(CODE128_START_B);
      else if (v === 105) aresult += doConvert(CODE128_START_C);
      else aresult += doConvert(patternAt(v));
    }
    aresult += doConvert(patternAt(achecksum));
    aresult += doConvert(CODE128_STOP);
    return aresult;
  }

  private codeEAN13(): string {
    let tmp: string;
    let retresult = '';
    if (this.checksum) {
      tmp = '0000000000000' + this.currentText;
      tmp = this.getEAN(substringNet(tmp, tmp.length - 12, 12) + '0');
    } else tmp = this.currentText;
    // Startcode
    let result = '505';
    // Avoid to process a code that is shorter to 13 characters
    if (tmp.length >= 13) {
      const lk = charAt(tmp, 0) - 48;
      tmp = substringNet(tmp, 1, 12);
      for (let i = 0; i < 6; i++) {
        const index = charAt(tmp, i) - 48;
        switch (cell(PARITY_EAN13, lk, i)) {
          case 'A':
            for (let j = 0; j < 4; j++) result += cell(EAN_A, index, j);
            break;
          case 'B':
            for (let j = 0; j < 4; j++) result += cell(EAN_B, index, j);
            break;
          case 'C':
            for (let j = 0; j < 4; j++) result += cell(EAN_C, index, j);
            break;
        }
      }
      result += '05050';
      for (let i = 6; i < 12; i++)
        for (let j = 0; j < 4; j++) {
          const index = charAt(tmp, i) - 48;
          result += cell(EAN_C, index, j);
        }
      // Stopcode
      result += '505';
      retresult = result;
    }
    return retresult;
  }

  private codeEAN8(): string {
    let tmp: string;
    let retResult = '';
    if (this.checksum) {
      tmp = '00000000' + this.currentText;
      tmp = this.getEAN(substringNet(tmp, tmp.length - 7, 7) + '0');
    } else tmp = this.currentText;
    // Startcode
    let result = '505';
    // Check to avoid the processing of code shorter than 8 characters
    if (tmp.length >= 8) {
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const index = charAt(tmp, i) - 48;
          result += cell(EAN_A, index, j);
        }
      result += '05050';
      for (let i = 4; i < 8; i++)
        for (let j = 0; j < 4; j++) {
          const index = charAt(tmp, i) - 48;
          result += cell(EAN_C, index, j);
        }
      // Stopcode
      result += '505';
      retResult = result;
    }
    return retResult;
  }

  private code25Interleaved(): string {
    const ftext = this.currentText;
    let result = '5050'; // Startcode
    for (let i = 0; i < Math.trunc(ftext.length / 2); i++)
      for (let j = 0; j < 5; j++) {
        let index = charAt(ftext, i * 2) - 48;
        result += cell(TABLE_2_5, index, j) === '1' ? '6' : '5';
        index = charAt(ftext, i * 2 + 1) - 48;
        result += cell(TABLE_2_5, index, j) === '1' ? '1' : '0';
      }
    result += '605'; // Stopcode
    return result;
  }

  private code25Industrial(): string {
    const ftext = this.currentText;
    let result = '606050'; // Startcode
    for (let i = 0; i < ftext.length; i++)
      for (let j = 0; j < 5; j++) {
        const index = charAt(ftext, i) - 48;
        result += cell(TABLE_2_5, index, j) === '1' ? '60' : '50';
      }
    result += '605060'; // Stopcode
    return result;
  }

  private code25Matrix(): string {
    const ftext = this.currentText;
    let result = '705050'; // Startcode
    for (let i = 0; i < ftext.length; i++) {
      for (let j = 0; j < 5; j++) {
        // C# parity: the digit read is the one at i * 2 + 1, past the end of any text of one
        // character or more (IndexOutOfRangeException)
        const index = charAt(ftext, i * 2 + 1) - 48;
        let c = cell(TABLE_2_5, index, j) === '1' ? 49 : 48;
        if (j % 2 !== 0) c = c + 5;
        result += String.fromCharCode(c);
      }
      result += '0';
    }
    result += '70505'; // Stopcode
    return result;
  }

  private code39(): string {
    let checksum = 0;
    const star = findCode39IDX('*');
    // Startcode
    let result = TABLE_39[star]!.data + '0';
    const ftext = this.currentText;
    for (let i = 0; i < ftext.length; i++) {
      const idx = findCode39IDX(ftext.charAt(i));
      if (idx >= 0) {
        result += TABLE_39[idx]!.data + '0';
        checksum = i32(checksum + TABLE_39[idx]!.chk);
      }
    }
    // Calculate Checksum Data
    if (this.checksum) {
      checksum = checksum % 43;
      for (let i = 0; i < 44; i++)
        if (checksum === TABLE_39[i]!.chk) {
          // C# parity: with the check character the symbol has no stop character
          result += TABLE_39[i]!.data + '0';
          return result;
        }
    }
    result += TABLE_39[star]!.data;
    return result;
  }

  private code39Extended(): string {
    const save = this.currentText;
    let ftext = '';
    for (let i = 0; i < save.length; i++) {
      const c = save.charCodeAt(i);
      if (c <= 127) ftext += CODE39X[c]!;
    }
    this.currentText = ftext;
    try {
      return this.code39();
    } finally {
      this.currentText = save;
    }
  }

  private code93(): string {
    const ftext = this.currentText;
    let result = doConvert('111141'); // Startcode
    for (let i = 0; i < ftext.length; i++) {
      const idx = findCode93(ftext.charAt(i));
      if (idx < 0) throw new NamedException('Code93 bad Data: ' + ftext, ftext);
      result += doConvert(TABLE_93[idx]![1]);
    }
    let checkC = 0;
    let checkK = 0;
    let weightC = 1;
    let weightK = 2;
    for (let i = ftext.length - 1; i >= 0; i--) {
      const idx = findCode93(ftext.charAt(i));
      checkC = i32(checkC + Math.imul(idx, weightC));
      checkK = i32(checkK + Math.imul(idx, weightK));
      weightC++;
      if (weightC > 20) weightC = 1;
      weightK++;
      // C# parity: the K weight never restarts (the weight of C is reset instead)
      if (weightK > 15) weightC = 1;
    }
    checkK = i32(checkK + checkC);
    checkC = checkC % 47;
    checkK = checkK % 47;
    result += doConvert(TABLE_93[checkC]![1]) + doConvert(TABLE_93[checkK]![1]);
    result += doConvert('1111411'); // Stopcode
    return result;
  }

  private code93Extended(): string {
    const save = this.currentText;
    let ftext = '';
    for (let i = 0; i < save.length; i++) {
      const c = save.charCodeAt(i);
      if (c <= 127) ftext += CODE93X[c]!;
    }
    this.currentText = ftext;
    try {
      return this.code93();
    } finally {
      this.currentText = save;
    }
  }

  /** DoLines: draws the bars of the pattern (or the PDF417 symbol) at Left, Top. */
  doLines(data: string, left: number, top: number, metafile: MetaFile): void {
    if (this.barType === BarcodeType.CodePDF417) {
      draw2DBarcode(
        this.currentText,
        this.eccLevel,
        this.numRows,
        this.numColumns,
        this.truncated,
        this.modul,
        left,
        top,
        this.height,
        metafile,
        this.bColor,
        this.rotation,
        this.report.evaluator.context.culture.number,
      );
      return;
    }
    let xadd = 0;
    const origin: IntPoint = { x: left, y: top };
    const penWidth = 0;
    const m = this.modules;
    for (let i = 0; i < data.length; i++) {
      let awidth: number;
      let lt: LineType;
      switch (data.charAt(i)) {
        case '0':
          awidth = m[0]!;
          lt = LineType.White;
          break;
        case '1':
          awidth = m[1]!;
          lt = LineType.White;
          break;
        case '2':
          awidth = m[2]!;
          lt = LineType.White;
          break;
        case '3':
          awidth = m[3]!;
          lt = LineType.White;
          break;
        case '5':
          awidth = m[0]!;
          lt = LineType.Black;
          break;
        case '6':
          awidth = m[1]!;
          lt = LineType.Black;
          break;
        case '7':
          awidth = m[2]!;
          lt = LineType.Black;
          break;
        case '8':
          awidth = m[3]!;
          lt = LineType.Black;
          break;
        case 'A':
          awidth = m[0]!;
          lt = LineType.Half;
          break;
        case 'B':
          awidth = m[1]!;
          lt = LineType.Half;
          break;
        case 'C':
          awidth = m[2]!;
          lt = LineType.Half;
          break;
        case 'D':
          awidth = m[3]!;
          lt = LineType.Half;
          break;
        default:
          throw new NamedException(this.report.translator.translateStr(582) + ':' + data, data);
      }
      const penColor = lt === LineType.Black || lt === LineType.Half ? this.bColor : 0xffffff;
      if (lt !== LineType.White || (lt === LineType.White && !this.transparent)) {
        const brushColor = penColor;
        const aheight = lt === LineType.Half ? idiv(Math.imul(this.printHeight, 2), 5) : this.printHeight;
        // a, b, c, d builds the rectangle we want to draw
        const [a, c] = placeRectangle(
          { x: xadd, y: 0 },
          { x: xadd, y: aheight },
          { x: i32(xadd + awidth), y: aheight },
          { x: i32(xadd + awidth), y: 0 },
          origin,
          this.rotation,
        );
        filledRectangle(metafile, a, c, penWidth, penColor, brushColor);
      }
      xadd = i32(xadd + awidth);
    }
  }
}

function findCode39IDX(z: string): number {
  for (let i = 0; i < 44; i++) if (TABLE_39[i]!.c === z) return i;
  return -1;
}

function findCode93(c: string): number {
  for (let i = 0; i < 47; i++) if (TABLE_93[i]![0] === c) return i;
  return -1;
}

/** Code128.table[v].data with the .NET bounds check. */
function patternAt(v: number): string {
  if (v < 0 || v >= CODE128_PATTERNS.length) throw indexOutOfRange();
  return CODE128_PATTERNS[v]!;
}

/**
 * DoConvert: a pattern of widths ('321') in the internal representation ('715'): the even
 * positions are bars (5 to 8), the odd ones spaces (0 to 3).
 */
function doConvert(s: string): string {
  let t = '';
  for (let i = 0; i < s.length; i++) {
    let v = s.charCodeAt(i) - 1;
    if (i % 2 === 0) v = v + 5;
    t += String.fromCharCode(v & 0xffff);
  }
  return t;
}

/**
 * BaseReport.BarcodeOp (the BARCODEOP function): a barcode of the value of an expression drawn
 * in the current page. A QR draws nothing (CalculateBarcode has no QR pattern).
 */
export function barcodeOp(
  report: ReportRuntime,
  left: number,
  top: number,
  width: number,
  height: number,
  expression: string,
  displayFormat: string,
  barType: number,
  modul: number,
  ratio: number,
  rotation: number,
  calcChecksum: boolean,
  brushColor: number,
): boolean {
  const barcode = new BarcodeItem(report, new BarcodeModel());
  barcode.width = width;
  barcode.height = height;
  barcode.barType = barType as BarcodeType;
  barcode.modul = modul;
  barcode.ratio = ratio;
  barcode.rotation = convertToInt16(rotation * 10);
  barcode.checksum = calcChecksum;
  const fValue = report.evaluator.evaluateText(expression);
  barcode.currentText = fValue.toFormatString(report.evaluator.context, displayFormat, ParamType.Unknown, true);
  const data = barcode.calculateBarcode();
  // Draws Barcode
  barcode.printHeight = height;
  barcode.bColor = brushColor;
  barcode.doLines(data, left, top, report.metaFile);
  return true;
}

