// Ports of the runtime part of Reportman.Reporting.PrintItem, PrintPosItem, PrintItemText,
// LabelItem, ExpressionItem and ShapeItem: how an item measures itself (GetExtension) and draws
// itself into the metafile (Print / DoPrint) while a report is laid out.

import type {
  ExpressionItem as ExpressionModel,
  LabelItem as LabelModel,
  PrintItem as PrintItemModel,
  PrintItemText as PrintItemTextModel,
  PrintPosItem as PrintPosModel,
  ShapeItem as ShapeModel,
} from 'reportman-lib';
import {
  AlignmentFlags,
  MetaFile,
  MetaFileVersion,
  MetaObjectDraw,
  MetaObjectText,
  MetaObjectType,
  type MetaObject,
  type MetaPage,
  type Point,
  type PrintOut,
  type TextObjectStruct,
} from 'reportman-metafile';
import { toUpperNet, trimNet } from '../util/chars.js';
import { messageOf } from '../util/netexception.js';
import { standardDeviation } from '../util/doubleutil.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import { NotSupportedYetError } from '../data/errors.js';
import { ReportException } from './errors.js';
import { EvalIdenExpression } from './identifiers.js';
import type { ReportRuntime } from './report.js';

/** The notifications a subreport sends to its sections and items (SubReportEvent). */
export enum SubReportEvent {
  Start,
  DataChange,
  GroupChange,
  PageChange,
  InvalidateValue,
  SubReportStart,
  SubReportEnd,
}

/** PrintItemAlign. */
export enum PrintItemAlign {
  None,
  Bottom,
  Right,
  BottomRight,
  LeftRight,
  TopBottom,
  AllClient,
}

/** ref bool PartialPrint. */
export interface PartialRef {
  value: boolean;
}

/** A C# Point (a struct): copied on assignment. */
export function pt(x: number, y: number): Point {
  return { x, y };
}

/** PrintItem: an item with a size, a print condition and the before/after print expressions. */
export class PrintItem {
  readonly report: ReportRuntime;
  name: string;
  width: number;
  height: number;
  printCondition: string;
  doBeforePrint: string;
  doAfterPrint: string;
  /** The size of the last print. */
  printWidth = 0;
  printHeight = 0;
  /** The extent of the last measurement. */
  lastExtent: Point = pt(0, 0);

  constructor(report: ReportRuntime, model: PrintItemModel) {
    this.report = report;
    this.name = model.name;
    this.width = model.width;
    this.height = model.height;
    this.printCondition = model.printCondition ?? '';
    this.doBeforePrint = model.doBeforePrint ?? '';
    this.doAfterPrint = model.doAfterPrint ?? '';
  }

  /** EvaluatePrintCondition: true when the condition is empty or evaluates to true. */
  evaluatePrintCondition(): boolean {
    if (this.printCondition.length === 0) return true;
    const fevaluator = this.report.evaluator;
    try {
      fevaluator.expression = this.printCondition;
      fevaluator.evaluate();
      return fevaluator.result.toBool(fevaluator.context);
    } catch (e) {
      throw new ReportException(
        messageOf(e) + '\n' + this.name + ' Prop:PrintCondition \n' + this.printCondition,
        this.name,
        'PrintCondition',
      );
    }
  }

  /** A subreport event (the base item does nothing). */
  subReportChanged(_newstate: SubReportEvent, _newgroup: string): void {}

  getExtension(_adriver: PrintOut, _maxExtent: Point, _forcePartial: boolean): Point {
    const aresult = pt(this.width, this.height);
    this.lastExtent = { ...aresult };
    return aresult;
  }

  protected doPrint(
    _adriver: PrintOut,
    _aposx: number,
    _aposy: number,
    newwidth: number,
    newheight: number,
    _metafile: MetaFile,
    _maxExtent: Point,
    partialPrint: PartialRef,
  ): void {
    this.printWidth = newwidth >= 0 ? newwidth : this.width;
    this.printHeight = newheight >= 0 ? newheight : this.height;
    partialPrint.value = false;
  }

  /** Print: the print condition, the before print expression, the item, the after print expression. */
  print(
    adriver: PrintOut,
    aposx: number,
    aposy: number,
    newwidth: number,
    newheight: number,
    metafile: MetaFile,
    maxExtent: Point,
    partialPrint: PartialRef,
  ): void {
    if (!this.evaluatePrintCondition()) return;
    this.executeBeforePrint();
    this.doPrint(adriver, aposx, aposy, newwidth, newheight, metafile, { ...maxExtent }, partialPrint);
    this.executeAfterPrint();
  }

  protected executeBeforePrint(): void {
    if (this.doBeforePrint.length > 0) {
      try {
        const fevaluator = this.report.evaluator;
        fevaluator.expression = this.doBeforePrint;
        fevaluator.evaluate();
      } catch (e) {
        throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:BeforePrint', this.name, 'BeforePrint');
      }
    }
  }

  protected executeAfterPrint(): void {
    if (this.doAfterPrint.length > 0) {
      try {
        const fevaluator = this.report.evaluator;
        fevaluator.expression = this.doAfterPrint;
        fevaluator.evaluate();
      } catch (e) {
        throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:AfterPrint', this.name, 'AfterPrint');
      }
    }
  }
}

/** PrintPosItem: an item placed in a section. */
export class PrintPosItem extends PrintItem {
  hidden: boolean;
  posX: number;
  posY: number;
  align: PrintItemAlign;
  /** Print it at the last page of a partial print (aligned to bottom). */
  partialFlag: boolean;
  annotationExpression: string | null;

  constructor(report: ReportRuntime, model: PrintPosModel) {
    super(report, model);
    this.hidden = model.hidden;
    this.posX = model.posX;
    this.posY = model.posY;
    this.align = model.align as number as PrintItemAlign;
    this.partialFlag = model.partialFlag;
    this.annotationExpression = model.annotationExpression ?? null;
  }

  override getExtension(_adriver: PrintOut, _maxExtent: Point, _forcePartial: boolean): Point {
    const aresult = pt(0, 0);
    if (this.align !== PrintItemAlign.LeftRight) aresult.x = this.width;
    if (this.align !== PrintItemAlign.TopBottom) aresult.y = this.height;
    this.lastExtent = { ...aresult };
    return aresult;
  }

  /** FillAnnotation: the annotation expression of the item, attached to its object. */
  fillAnnotation(meta: MetaObject, page: MetaPage): void {
    if (this.annotationExpression === null || this.annotationExpression.length === 0) return;
    try {
      const fevaluator = this.report.evaluator;
      const newValue = fevaluator.evaluateText(this.annotationExpression);
      if (newValue.varType === VariantType.String) {
        const annotation = newValue.toImplicitString(fevaluator.context) ?? '';
        if (annotation.length > 0) {
          const pos = page.addString(annotation);
          meta.annotationP = pos;
          meta.annotationS = annotation.length;
          if (page.metaFile.version < MetaFileVersion.MetaVersion4_0) page.metaFile.version = MetaFileVersion.MetaVersion4_0;
        }
      }
    } catch (e) {
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:AnnotationExpression', this.name, 'AnnotationExpression');
    }
  }
}

/** The bidirectional mode of a text in a language (BidiModeType). */
enum BidiModeType {
  No,
  Partial,
  Full,
}

/** PrintItemText: an item with a text, its font and format. */
export class PrintItemText extends PrintPosItem {
  wFontName: string;
  lFontName: string;
  fontSize: number;
  fontRotation: number;
  fontStyle: number;
  fontColor: number;
  backColor: number;
  transparent: boolean;
  cutText: boolean;
  wordWrap: boolean;
  isHtml: boolean;
  alignment: number;
  vAlignment: number;
  singleLine: boolean;
  type1Font: number;
  multiPage: boolean;
  printStep: number;
  bidiModes: string[];

  constructor(report: ReportRuntime, model: PrintItemTextModel) {
    super(report, model);
    this.wFontName = model.wFontName;
    this.lFontName = model.lFontName;
    this.fontSize = model.fontSize;
    this.fontRotation = model.fontRotation;
    this.fontStyle = model.fontStyle;
    this.fontColor = model.fontColor;
    this.backColor = model.backColor;
    this.transparent = model.transparent;
    this.cutText = model.cutText;
    this.wordWrap = model.wordWrap;
    this.isHtml = model.isHtml;
    this.alignment = model.alignment;
    this.vAlignment = model.vAlignment;
    this.singleLine = model.singleLine;
    this.type1Font = model.type1Font;
    this.multiPage = model.multiPage;
    this.printStep = model.printStep;
    this.bidiModes = [...model.bidiModes];
  }

  /** The index of the report language in BidiModes: Language + 1, 0 out of range. */
  private bidiLanguageIndex(): number {
    let langindex = this.report.language + 1;
    if (langindex < 0 || langindex > 256) langindex = 0;
    return langindex;
  }

  get bidiMode(): BidiModeType {
    const langindex = this.bidiLanguageIndex();
    if (this.bidiModes.length > langindex) {
      if (this.bidiModes[langindex] === 'BidiPartial') return BidiModeType.Partial;
      if (this.bidiModes[langindex] === 'BidiFull') return BidiModeType.Full;
    }
    return BidiModeType.No;
  }

  /** Right to left text in the current report language. */
  get rightToLeft(): boolean {
    return this.bidiMode !== BidiModeType.No;
  }

  /** PrintAlignment: the horizontal alignment flags, mirrored for BidiFull. */
  get printAlignment(): number {
    let aresult = 0;
    // TextAlignType: Left 0, Right 1, Center 2, Justify 3
    if (this.alignment === 1) aresult = AlignmentFlags.AlignRight;
    else if (this.alignment === 2) aresult = AlignmentFlags.AlignHCenter;
    else if (this.alignment === 3) aresult = AlignmentFlags.AlignHJustify;
    if (this.bidiMode === BidiModeType.Full) {
      if (this.alignment === 0) aresult = AlignmentFlags.AlignRight;
      else if (this.alignment === 1) aresult = AlignmentFlags.AlignLeft;
    }
    return aresult;
  }

  /** VPrintAlignment: the vertical alignment flags (TextAlignVerticalType: Top 0, Bottom 1, Center 2). */
  get vPrintAlignment(): number {
    let aresult = 0;
    if (this.vAlignment === 2) aresult = AlignmentFlags.AlignVCenter;
    else if (this.vAlignment === 1) aresult = AlignmentFlags.AlignBottom;
    return aresult;
  }

  protected checkHtml(): void {
    // The HTML text needs the HTML layout and the shaper of the PDF writer, not ported yet
    if (this.isHtml) throw new NotSupportedYetError('HTML text (the item ' + this.name + ')');
  }

  protected textObject(text: string): TextObjectStruct {
    let aalign = this.printAlignment | this.vPrintAlignment;
    if (this.singleLine) aalign = aalign | AlignmentFlags.SingleLine;
    return {
      text,
      lFontName: this.lFontName,
      wFontName: this.wFontName,
      fontSize: this.fontSize,
      fontRotation: this.fontRotation,
      fontStyle: (this.fontStyle << 16) >> 16,
      type1Font: this.type1Font,
      fontColor: this.fontColor,
      cutText: this.cutText,
      alignment: aalign,
      wordWrap: this.wordWrap,
      rightToLeft: this.rightToLeft,
      printStep: this.printStep,
      isHtml: this.isHtml,
    };
  }
}

/** LabelItem: a fixed text, one per report language. */
export class LabelItem extends PrintItemText {
  allStrings: string[];

  constructor(report: ReportRuntime, model: LabelModel) {
    super(report, model);
    this.allStrings = [...model.allStrings];
  }

  /** The text of the report language (item Language + 1), else the default one. */
  get text(): string {
    let lang = this.report.language + 1;
    if (lang < 0) lang = 0;
    if (lang < this.allStrings.length) return this.allStrings[lang]!;
    if (this.allStrings.length > 0) return this.allStrings[0]!;
    return '';
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
    this.checkHtml();
    const apage = metafile.pages.get(metafile.currentPage);
    const metaobj = new MetaObjectText();
    this.fillAnnotation(metaobj, apage);
    const finalText = this.text;
    metaobj.textP = apage.addString(finalText);
    metaobj.textS = finalText.length;
    metaobj.lFontNameP = apage.addString(this.lFontName);
    metaobj.lFontNameS = this.lFontName.length;
    metaobj.wFontNameP = apage.addString(this.wFontName);
    metaobj.wFontNameS = this.wFontName.length;
    metaobj.fontSize = this.fontSize;
    metaobj.backColor = this.backColor;
    metaobj.fontRotation = this.fontRotation;
    metaobj.fontStyle = (this.fontStyle << 16) >> 16;
    metaobj.fontColor = this.fontColor;
    metaobj.type1Font = this.type1Font;
    metaobj.cutText = this.cutText;
    metaobj.transparent = this.transparent;
    metaobj.wordWrap = this.wordWrap;
    metaobj.top = aposy;
    metaobj.left = aposx;
    metaobj.width = this.printWidth;
    metaobj.height = this.printHeight;
    metaobj.rightToLeft = this.rightToLeft;
    metaobj.printStep = this.printStep;
    metaobj.isHtml = this.isHtml;
    let aalign = this.printAlignment | this.vPrintAlignment;
    if (this.singleLine) aalign = aalign | AlignmentFlags.SingleLine;
    metaobj.alignment = aalign;
    apage.objects.push(metaobj);
  }

  override getExtension(adriver: PrintOut, maxExtent: Point, forcePartial: boolean): Point {
    this.checkHtml();
    const atext = this.textObject(this.text);
    let aresult = super.getExtension(adriver, maxExtent, forcePartial);
    aresult = adriver.textExtent(atext, aresult);
    this.lastExtent = { ...aresult };
    return aresult;
  }
}

/** Aggregate and AggregateType of an expression item. */
export enum Aggregate {
  None,
  Group,
  Page,
  General,
}

export enum AggregateType {
  Summary,
  Minimum,
  Maximum,
  Average,
  StandardDeviation,
}

const PAGE_COUNT_PLACEHOLDER = '                    ';

/** ExpressionItem: the formatted value of an expression, with aggregates and multipage text. */
export class ExpressionItem extends PrintItemText {
  private readonly fValues: number[] = [];
  readonly idenExpression: EvalIdenExpression;
  private fIsPartial = false;
  // C# parity: FForcedPartial is only ever cleared, so a forced partial measurement (a section
  // that does not fit an empty page) is not printed partially.
  private fForcedPartial = false;
  private fOldString = '';
  private fUpdated = false;
  private fDataCount = 0;
  private fSumValue: Variant = Variant.null;
  readonly expression: string;
  groupName: string;
  aggregate: Aggregate;
  agType: AggregateType;
  identifier: string;
  autoExpand: boolean;
  autoContract: boolean;
  displayFormat: string;
  exportDisplayFormat: string;
  dataType: ParamType;
  value: Variant = Variant.null;
  agIniValue: string;
  printOnlyOne: boolean;
  printNulls: boolean;
  partialPos = 0;
  exportExpression: string;
  isPageCount = false;
  isGroupPageCount = false;
  lastMetaIndex = 0;

  constructor(report: ReportRuntime, model: ExpressionModel) {
    super(report, model);
    this.expression = model.expression;
    this.groupName = model.groupName;
    this.aggregate = model.aggregate as number as Aggregate;
    this.agType = model.agType as number as AggregateType;
    this.identifier = model.identifier;
    this.autoExpand = model.autoExpand;
    this.autoContract = model.autoContract;
    this.displayFormat = model.displayFormat;
    this.exportDisplayFormat = model.exportDisplayFormat;
    this.dataType = model.dataType as number as ParamType;
    this.agIniValue = model.agIniValue;
    this.printOnlyOne = model.printOnlyOne;
    this.printNulls = model.printNulls;
    this.exportExpression = model.exportExpression;
    this.updateIsPageCount();
    this.idenExpression = new EvalIdenExpression(null, () => {
      this.evaluate();
      return this.value;
    });
  }

  /** The text was cut and the rest prints in the next page. */
  get isPartial(): boolean {
    return this.fIsPartial;
  }

  private updateIsPageCount(): void {
    this.isPageCount = false;
    this.isGroupPageCount = false;
    const astring = toUpperNet(trimNet(this.expression));
    if (astring === 'PAGECOUNT') this.isPageCount = true;
    else if (astring === 'GROUPPAGECOUNT') this.isGroupPageCount = true;
  }

  /** Evaluate: the value of the expression, cached until the item is invalidated. */
  evaluate(): void {
    if (this.fUpdated) return;
    const fevaluator = this.report.evaluator;
    try {
      this.value = fevaluator.evaluateText(this.expression);
      this.fUpdated = true;
    } catch (e) {
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:Expression', this.name, 'Expression');
    }
    if (this.exportExpression.length > 0) {
      try {
        // C# parity: the export expression is assigned to Value, not to the export value.
        this.value = fevaluator.evaluateText(this.exportExpression);
      } catch (e) {
        throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:ExportExpression', this.name, 'ExportExpression');
      }
    }
  }

  private getText(): string {
    const expre = trimNet(this.expression);
    if (expre.length === 0) return '';
    if (this.isPageCount || this.isGroupPageCount) return PAGE_COUNT_PLACEHOLDER;
    let aresult: string;
    try {
      this.evaluate();
      aresult = this.value.toFormatString(this.report.evaluator.context, this.displayFormat, this.dataType, this.printNulls);
    } catch (e) {
      if (e instanceof ReportException) throw e;
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:Expression', this.name, 'Expression');
    }
    if (this.isPartial) {
      if (this.partialPos < aresult.length && (aresult.charAt(this.partialPos) === ' ' || aresult.charCodeAt(this.partialPos) === 10))
        this.partialPos++;
      if (this.partialPos > aresult.length) this.partialPos = aresult.length;
      aresult = aresult.substring(this.partialPos);
    }
    return aresult;
  }

  private getTextObject(): TextObjectStruct {
    this.checkHtml();
    return this.textObject(this.getText());
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
    this.lastMetaIndex = -1;
    const textObj = this.getTextObject();
    if (this.printOnlyOne) {
      if (this.fOldString === textObj.text) return;
    }
    this.fOldString = textObj.text;
    if (this.multiPage || this.fForcedPartial) {
      const extent = { ...maxExtent, x: this.printWidth };
      const driver = this.report.driver;
      if (driver === null) throw new Error('Object reference not set to an instance of an object.');
      const newposition = MetaFile.calcTextExtent(driver, extent, textObj);
      if (newposition < textObj.text.length) {
        if (!this.fIsPartial) this.partialPos = 0;
        this.fIsPartial = true;
        partialPrint.value = true;
        this.partialPos = this.partialPos + newposition;
        textObj.text = textObj.text.substring(0, newposition);
      } else {
        this.fIsPartial = false;
        this.fForcedPartial = false;
      }
    }
    const apage = metafile.pages.get(metafile.currentPage);
    const aobj = new MetaObjectText();
    this.fillAnnotation(aobj, apage);
    aobj.metaType = MetaObjectType.Text;
    aobj.left = aposx;
    aobj.top = aposy;
    aobj.width = this.printWidth;
    aobj.height = this.printHeight;
    aobj.alignment = textObj.alignment;
    aobj.printStep = this.printStep;
    aobj.backColor = this.backColor;
    aobj.transparent = this.transparent;
    aobj.cutText = this.cutText;
    aobj.fontColor = this.fontColor;
    aobj.fontRotation = this.fontRotation;
    aobj.type1Font = this.type1Font;
    aobj.fontSize = this.fontSize;
    aobj.fontStyle = (this.fontStyle << 16) >> 16;
    aobj.textP = apage.addString(textObj.text);
    aobj.textS = textObj.text.length;
    aobj.wordWrap = this.wordWrap;
    aobj.lFontNameP = apage.addString(this.lFontName);
    aobj.lFontNameS = this.lFontName.length;
    aobj.wFontNameP = apage.addString(this.wFontName);
    aobj.wFontNameS = this.wFontName.length;
    aobj.rightToLeft = textObj.rightToLeft;
    aobj.isHtml = textObj.isHtml;
    apage.objects.push(aobj);
    this.lastMetaIndex = apage.objects.length - 1;
    // Is Total pages variable?
    if (this.isPageCount) this.report.addTotalPagesItem(metafile.currentPage, apage.objects.length - 1, this.displayFormat);
    // C# parity: DoPrint tests the ExportValue property, which nothing assigns (Evaluate keeps the
    // export value in a field of its own), so no export object is ever written.
  }

  override subReportChanged(newstate: SubReportEvent, newgroup: string): void {
    super.subReportChanged(newstate, newgroup);
    const ev = this.report.evaluator;
    const iniValue = (): void => {
      try {
        ev.expression = this.agIniValue;
        ev.evaluate();
        this.value = ev.result;
        this.fSumValue = this.value;
        this.fUpdated = true;
      } catch (e) {
        throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:AgIniValue', this.name, 'AgIniValue');
      }
    };
    switch (newstate) {
      case SubReportEvent.Start:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fOldString = '';
        this.fUpdated = false;
        this.fDataCount = 0;
        if (this.aggregate !== Aggregate.None) iniValue();
        break;
      case SubReportEvent.SubReportStart:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fOldString = '';
        this.fUpdated = false;
        this.fDataCount = 0;
        if (this.aggregate !== Aggregate.None && this.aggregate !== Aggregate.General) iniValue();
        break;
      case SubReportEvent.DataChange:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fUpdated = false;
        this.fDataCount++;
        if (this.aggregate !== Aggregate.None) {
          try {
            ev.expression = this.expression;
            ev.evaluate();
            const ctx = ev.context;
            const result = ev.result;
            switch (this.agType) {
              case AggregateType.Summary:
                if (result.varType !== VariantType.Null) this.value = Variant.add(this.value, result, ctx);
                break;
              case AggregateType.Minimum:
                if (result.varType !== VariantType.Null) {
                  if (Variant.greaterThan(this.value, result, ctx)) this.value = result;
                }
                break;
              case AggregateType.Maximum:
                if (result.varType !== VariantType.Null) {
                  if (Variant.lessThan(this.value, result, ctx)) this.value = result;
                }
                break;
              case AggregateType.Average:
                if (result.varType === VariantType.Null) this.fDataCount--;
                else {
                  this.fSumValue = Variant.add(this.fSumValue, result, ctx);
                  this.value = Variant.div(this.fSumValue, Variant.fromInteger(this.fDataCount), ctx);
                }
                break;
              case AggregateType.StandardDeviation:
                if (result.varType === VariantType.Null) this.fDataCount--;
                else {
                  // C# parity: the list of values is never cleared, not even by a group change
                  this.fValues.push(result.toDouble(ctx));
                  this.value = Variant.fromDouble(standardDeviation(this.fValues));
                }
                break;
            }
            this.fUpdated = true;
          } catch (e) {
            throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:Expression', this.name, 'Expression');
          }
        }
        break;
      case SubReportEvent.GroupChange:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fUpdated = false;
        this.fOldString = '';
        if (this.aggregate === Aggregate.Group) {
          if (toUpperNet(this.groupName) === toUpperNet(newgroup)) iniValue();
        }
        break;
      case SubReportEvent.PageChange:
        this.fOldString = '';
        // Page variable must be recalculated
        if (this.aggregate === Aggregate.None) this.fUpdated = false;
        if (this.aggregate === Aggregate.Page) {
          iniValue();
          this.subReportChanged(SubReportEvent.DataChange, '');
        }
        break;
      case SubReportEvent.InvalidateValue:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fOldString = '';
        this.fUpdated = false;
        break;
    }
  }

  override getExtension(adriver: PrintOut, maxExtent: Point, forcePartial: boolean): Point {
    const atext = this.getTextObject();
    // Items printed only one time, have no extension
    if (this.printOnlyOne) {
      if (this.fOldString === atext.text) return pt(0, 0);
    }
    let isPartial = false;
    let aresult = super.getExtension(adriver, maxExtent, forcePartial);
    if (this.multiPage || forcePartial) {
      const extent = { ...maxExtent, x: aresult.x };
      const aposition = MetaFile.calcTextExtent(adriver, extent, atext);
      if (aposition < atext.text.length) isPartial = true;
      atext.text = atext.text.substring(0, aposition);
      aresult = adriver.textExtent(atext, aresult);
      if (isPartial) aresult.y = extent.y;
    } else aresult = adriver.textExtent(atext, aresult);
    this.lastExtent = { ...aresult };
    return aresult;
  }
}

/** ShapeItem: a rectangle, an ellipse, a line... */
export class ShapeItem extends PrintPosItem {
  brushStyle: number;
  brushColor: number;
  penStyle: number;
  shape: number;
  penWidth: number;
  penColor: number;
  // C# parity: the reader never reads BrushColorExpression, so it is always empty
  brushColorExpression = '';

  constructor(report: ReportRuntime, model: ShapeModel) {
    super(report, model);
    this.brushStyle = model.brushStyle;
    this.brushColor = model.brushColor;
    this.penStyle = model.penStyle;
    this.shape = model.shape;
    this.penWidth = model.penWidth;
    this.penColor = model.penColor;
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
    const apage = metafile.pages.get(metafile.currentPage);
    const metaobj = new MetaObjectDraw();
    this.fillAnnotation(metaobj, apage);
    metaobj.metaType = MetaObjectType.Draw;
    metaobj.top = aposy;
    metaobj.left = aposx;
    metaobj.width = this.printWidth;
    metaobj.height = this.printHeight;
    metaobj.drawStyle = this.shape;
    metaobj.brushStyle = this.brushStyle;
    metaobj.penStyle = this.penStyle;
    metaobj.penWidth = this.penWidth;
    metaobj.penColor = this.penColor;
    if (this.brushColorExpression.length > 0) {
      try {
        const ev = this.report.evaluator;
        metaobj.brushColor = ev.evaluateText(this.brushColorExpression).toInt(ev.context);
      } catch {
        metaobj.brushColor = this.brushColor;
      }
    } else metaobj.brushColor = this.brushColor;
    apage.objects.push(metaobj);
  }

  override getExtension(adriver: PrintOut, maxExtent: Point, forcePartial: boolean): Point {
    const aresult = super.getExtension(adriver, maxExtent, forcePartial);
    // ShapeType.HorzLine
    if (this.shape === 6) aresult.y = this.penWidth;
    this.lastExtent = { ...aresult };
    return aresult;
  }
}

/**
 * An item the TypeScript engine does not draw yet (images, barcodes, charts): the report fails
 * with a clear error when the item is measured or printed, instead of printing something else.
 */
export class UnsupportedItem extends PrintPosItem {
  readonly what: string;

  constructor(report: ReportRuntime, model: PrintPosModel, what: string) {
    super(report, model);
    this.what = what;
  }

  private fail(): never {
    throw new NotSupportedYetError(this.what + ' (the item ' + this.name + ')');
  }

  override getExtension(_adriver: PrintOut, _maxExtent: Point, _forcePartial: boolean): Point {
    this.fail();
  }

  protected override doPrint(): void {
    this.fail();
  }
}
