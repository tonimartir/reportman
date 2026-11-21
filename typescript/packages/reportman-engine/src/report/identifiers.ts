// Ports of the report identifiers of Reportman.Reporting.BaseReport (IdenReportVar, IdenEof,
// IdenSetLanguage, IdenTextHeight, IdenParamInfo, IdenGraphicOp, IdenTextOp, IdenImageOp,
// IdenOrientationOp, IdenPageOp, IdenReOpen and IdenGetValueFromSQL; the chart functions are in
// chart/chartidens.ts) and of EvalIdenExpression (an expression item read by its identifier).

import { IdenFunction } from '../eval/identifiers.js';
import type { Evaluator } from '../eval/evaluator.js';
import { CsDecimal } from '../util/decimal.js';
import { argumentOutOfRangeException, NamedException } from '../util/netexception.js';
import { Variant, VariantType } from '../variant/variant.js';
import type { ReportRuntime } from './report.js';

/** Translator.TranslateStr: the identifiers are created before the evaluator, with no evaluator. */
function T(report: ReportRuntime, index: number): string {
  return report.translator.translateStr(index);
}

abstract class IdenFunctionReport extends IdenFunction {
  readonly report: ReportRuntime;
  // C# parity: BaseReport creates its identifiers before InitEvaluator, with a null evaluator.
  constructor(report: ReportRuntime) {
    super(null);
    this.report = report;
  }

  protected get ctx() {
    return this.report.evaluator.context;
  }

  protected typeError(name: string): NamedException {
    return new NamedException(T(this.report, 438), name);
  }

  protected int(i: number): number {
    return this.params[i]!.toInt(this.ctx);
  }

  protected bool(i: number): boolean {
    return this.params[i]!.toBool(this.ctx);
  }

  protected dbl(i: number): number {
    return this.params[i]!.toDouble(this.ctx);
  }

  protected str(i: number): string {
    return this.params[i]!.toString(this.ctx);
  }

  /** Convert.ToInt32((double)Params[i]). */
  protected intOfDouble(i: number): number {
    return this.report.convertToInt32(this.params[i]!.toDouble(this.ctx));
  }
}

const TWIPS_PER_CM = CsDecimal.fromInteger(1440).div(CsDecimal.parseInvariant('2.54'));
const TWIPS_PER_INCH = CsDecimal.fromInteger(1440);

/** IdenReportVar: PAGE, PAGENUM, FREE_SPACE_*, CURRENTPOSX/Y, CURRENTGROUP, FIRSTSECTION... */
export class IdenReportVar extends IdenFunctionReport {
  readonly varname: string;

  constructor(report: ReportRuntime, varname: string) {
    super(report);
    this.varname = varname;
  }

  protected getValue(): Variant {
    const r = this.report;
    switch (this.varname) {
      case 'PAGE':
      case 'PAGINA':
        return Variant.fromInteger(r.pageNum + 1);
      case 'PAGENUM':
      case 'NUMPAGINA':
        return Variant.fromInteger(r.pageNumGroup + 1);
      case 'FREE_SPACE_TWIPS':
        return Variant.fromInteger(r.freeSpace);
      case 'CURRENTPOSX':
        return Variant.fromInteger(r.pageposx);
      case 'CURRENTPOSY':
        return Variant.fromInteger(r.pageposy);
      case 'FREE_SPACE_CMS':
        return Variant.fromDecimal(CsDecimal.fromInteger(r.freeSpace).div(TWIPS_PER_CM));
      case 'FREE_SPACE_INCH':
        return Variant.fromDecimal(CsDecimal.fromInteger(r.freeSpace).div(TWIPS_PER_INCH));
      case 'CURRENTGROUP': {
        const index = r.currentSubReportIndex >= r.subReports.length ? r.currentSubReportIndex - 1 : r.currentSubReportIndex;
        const subrep = r.subReports[index];
        if (subrep === undefined)
          throw argumentOutOfRangeException(
            "Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')",
          );
        if (subrep.lastRecord) return Variant.fromInteger(subrep.groupCount);
        return Variant.fromInteger(subrep.currentGroupIndex);
      }
      case 'FIRSTSECTION':
        return Variant.fromBoolean(!r.printedSomething);
      case 'PAGEWIDTH':
        return Variant.fromInteger(r.internalPageWidth);
      case 'PAGEHEIGHT':
        return Variant.fromInteger(r.internalPageHeight);
      case 'LANGUAGE':
        return Variant.fromInteger(r.language);
    }
    return Variant.null;
  }
}

/** EOF(alias): the dataset has no more records (True when it is not open). */
export class IdenEof extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(1);
    this.name = 'EOF';
    this.fModel = 'function Eof(alias:string):Boolean';
  }

  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw new NamedException(T(this.report, 438), this.name);
    let aresult = true;
    const aliasname = this.report.toUpper(this.params[0]!.toImplicitString(this.ctx) ?? '');
    const index = this.report.dataInfoIndexOf(aliasname);
    if (index < 0) throw new NamedException(T(this.report, 283) + ':' + aliasname, this.name);
    const data = this.report.dataInfos[index]!.data;
    if (data.active) aresult = data.eof;
    return Variant.fromBoolean(aresult);
  }
}

/** SETLANGUAGE(lang): changes the report language. */
export class IdenSetLanguage extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(1);
    this.name = 'SETLANGUAGE';
    this.fModel = 'function SetLanguage(newlang:integer):integer';
  }

  protected getValue(): Variant {
    if (!this.params[0]!.isInteger()) throw new NamedException(T(this.report, 438), 'SETLANGUAGE');
    this.report.language = this.int(0);
    return Variant.null;
  }
}

/** SETPAGEORIENTATION(orientation): the orientation of the current page. */
export class IdenOrientationOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(1);
    this.name = 'SETPAGEORIENTATION';
    this.fModel = 'function SetPageOrientation(orientation:integer):integer';
  }

  protected getValue(): Variant {
    if (!this.params[0]!.isInteger()) throw new NamedException(T(this.report, 438), 'SETPAGEORIENTATION');
    this.report.orientationOp(this.int(0));
    return Variant.null;
  }
}

/** GRAPHICOP: draws a shape in the current page. */
export class IdenGraphicOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(10);
    this.name = 'GRAPHICOP';
    this.fModel =
      'function GraphicOp(Top,Left,Width,Height:integer;\n' +
      'DrawStyle:integer;BrushStyle:integer;BrushColor:integer;\n' +
      "PenStyle:integer;PenWidth:integer; PenColor:integer):Boolean'";
  }

  protected getValue(): Variant {
    for (let i = 0; i < 4; i++) if (!this.params[i]!.isNumber()) throw this.typeError(this.name);
    for (let i = 4; i < this.paramCount; i++) if (!this.params[i]!.isInteger()) throw this.typeError(this.name);
    return Variant.fromBoolean(
      this.report.graphicOp(
        this.intOfDouble(0),
        this.intOfDouble(1),
        this.intOfDouble(2),
        this.intOfDouble(3),
        this.int(4),
        this.int(5),
        this.int(6),
        this.int(7),
        this.int(8),
        this.int(9),
      ),
    );
  }
}

/** IMAGEOP: draws an image in the current page. */
export class IdenImageOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(8);
    this.name = 'IMAGEOP';
    this.fModel =
      'function ImageOp(Top,Left,Width,Height:integer;\n' + 'DrawStyle,PixelsPerinch:integer;PreviewOnly:Boolean;\n' + 'Image:String):Boolean';
  }

  protected getValue(): Variant {
    for (let i = 0; i < 4; i++) if (!this.params[i]!.isNumber()) throw this.typeError('IMAGEOP');
    for (let i = 4; i < 6; i++) if (!this.params[i]!.isInteger()) throw this.typeError('IMAGEOP');
    if (!this.params[6]!.isBoolean()) throw this.typeError('IMAGEOP');
    if (!this.params[7]!.isString()) throw this.typeError('IMAGEOP');
    return Variant.fromBoolean(
      this.report.imageOp(this.int(0), this.int(1), this.int(2), this.int(3), this.int(4), this.int(5), this.bool(6), this.str(7)),
    );
  }
}

/** TEXTOP: draws a text in the current page. */
export class IdenTextOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(19);
    this.name = 'TEXTOP';
    this.fModel =
      'function TextOp(Top,Left,Width,Height:integer;\n' +
      'Text,LFontName,WFontName:WideString;\n' +
      'FontSize,FontRotation,FontStyle,FontColor,Type1Font:integer;\n' +
      'CutText:boolean;Alignment:integer;WordWrap,RightToLeft:Boolean;\n' +
      'PrintStep,BackColor:integer;transparent:boolean)';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) {
      const p = this.params[i]!;
      switch (i) {
        case 0:
        case 1:
        case 2:
        case 3:
          if (!p.isNumber()) throw this.typeError('TEXTOP');
          break;
        case 7:
        case 8:
        case 9:
        case 10:
        case 11:
        case 13:
        case 16:
        case 17:
          if (!p.isInteger()) throw this.typeError('TEXTOP');
          break;
        case 12:
        case 14:
        case 15:
        case 18:
          if (!p.isBoolean()) throw this.typeError('TEXTOP');
          break;
        case 4:
        case 5:
        case 6:
          if (!p.isString()) throw this.typeError('TEXTOP');
          break;
      }
    }
    return Variant.fromBoolean(
      this.report.textOp(
        this.int(0),
        this.int(1),
        this.int(2),
        this.int(3),
        this.str(4),
        this.str(5),
        this.str(6),
        this.int(7),
        this.int(8),
        this.int(9),
        this.int(10),
        this.int(11),
        this.bool(12),
        this.int(13),
        this.bool(14),
        this.bool(15),
        this.int(16),
        this.int(17),
        this.bool(18),
      ),
    );
  }
}

/** BARCODEOP: draws a barcode in the current page. */
export class IdenBarcodeOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(12);
    this.name = 'BARCODEOP';
    this.fModel =
      'function BarcodeOp(Top,Left,Width,Height:integer;\n' +
      'Expression,DisplayFormat:WideString;\n' +
      'BarType,Modul:Integer; Ratio,Rotation:Currency;\n' +
      'CalcChecksum:Boolean; BColor:Integer):Boolean';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) {
      const p = this.params[i]!;
      switch (i) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 8:
        case 9:
          if (!p.isNumber()) throw this.typeError('BARCODEOP');
          break;
        case 6:
        case 7:
        case 11:
          if (!p.isInteger()) throw this.typeError('BARCODEOP');
          break;
        case 5:
        case 4:
          if (!p.isString()) throw this.typeError('BARCODEOP');
          break;
        case 10:
          if (!p.isBoolean()) throw this.typeError('BARCODEOP');
          break;
      }
    }
    return Variant.fromBoolean(
      this.report.barcodeOp(
        this.int(0),
        this.int(1),
        this.int(2),
        this.int(3),
        this.str(4),
        this.str(5),
        this.int(6),
        this.int(7),
        this.dbl(8),
        this.dbl(9),
        this.bool(10),
        this.int(11),
      ),
    );
  }
}

/** SETPAGESOURCE: the page size and paper source of a page. */
export class IdenPageOp extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(7);
    this.name = 'SETPAGESOURCE';
    this.fModel =
      'function SetPageSource(QtIndex:integer;\n' +
      'Custom:Boolean;CustomWidth,CustomHeight,PaperSource:integer;\n' +
      'ForcePaperName:String;Duplex:integer):Boolean';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) {
      const p = this.params[i]!;
      switch (i) {
        case 0:
          if (!p.isNumber()) throw this.typeError('SETPAGESOURCE');
          break;
        case 2:
        case 3:
        case 4:
        case 6:
          if (!p.isInteger()) throw this.typeError('SETPAGESOURCE');
          break;
        case 5:
          if (!p.isString()) throw this.typeError('SETPAGESOURCE');
          break;
        case 1:
          if (!p.isBoolean()) throw this.typeError('SETPAGESOURCE');
          break;
      }
    }
    return Variant.fromBoolean(
      this.report.pageOp(this.int(0), this.bool(1), this.int(2), this.int(3), this.int(4), this.str(5), this.int(6)),
    );
  }
}

/** PARAMINFO(name, index): what a parameter holds. */
export class IdenParamInfo extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(2);
    this.name = 'PARAMLIST';
    this.fModel = 'function ParamInfo(paramname:String;index:integer)';
  }

  protected getValue(): Variant {
    if (!this.params[1]!.isInteger()) throw this.typeError('PARAMLIST');
    if (!this.params[0]!.isString()) throw this.typeError('PARAMLIST');
    return this.report.paramInfoOp(this.str(0), this.int(1));
  }
}

/** TEXTHEIGHT: the height of a text measured with the report's device. */
export class IdenTextHeight extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(8);
    this.name = 'TEXTHEIGHT';
    this.fModel =
      'function OnTextheight(Text,LFontName,WFontName:WideString;\n' + 'RectWidth,FontSize,FontStyle,Type1Font:integer;\n' + 'PrintStep:integer):integer';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) {
      const p = this.params[i]!;
      if (i >= 3) {
        if (!p.isInteger()) throw this.typeError('TEXTHEIGHT');
      } else if (!p.isString()) throw this.typeError('TEXTHEIGHT');
    }
    return Variant.fromInteger(
      this.report.textHeightOp(this.str(0), this.str(1), this.str(2), this.int(3), this.int(4), this.int(5), this.int(6), this.int(7)),
    );
  }
}

/** REOPEN(dataset, sql): opens a dataset again with another SQL. */
export class IdenReOpen extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(2);
    this.name = 'REOPEN';
    this.fModel = 'function ReOpen(dataset, sql:string):Boolean';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) if (!this.params[i]!.isString()) throw this.typeError('TEXTHEIGHT');
    return Variant.fromBoolean(this.report.reOpenOp(this.str(0), this.str(1)));
  }
}

/** GETVALUEFROMSQL(connection, sql): the first column of the first row of a query. */
export class IdenGetValueFromSQL extends IdenFunctionReport {
  constructor(report: ReportRuntime) {
    super(report);
    this.setParamCount(2);
    this.name = 'GETVALUEFROMSQL';
    this.fModel = 'function GetValueFromSQL(connectionname, sql:string):Variant';
  }

  protected getValue(): Variant {
    for (let i = 0; i < this.paramCount; i++) if (!this.params[i]!.isString()) throw this.typeError('GETVALUEFROMSQL');
    return this.report.getSQLValueOp(this.str(0), this.str(1));
  }
}

/** EvalIdenExpression: an expression item read by its identifier (evaluated on demand). */
export class EvalIdenExpression extends IdenFunction {
  private readonly evaluate: () => Variant;

  constructor(evaluator: Evaluator | null, evaluate: () => Variant) {
    super(evaluator);
    this.evaluate = evaluate;
  }

  protected getValue(): Variant {
    return this.evaluate();
  }
}

