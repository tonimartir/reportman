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
} from '@reportman/lib';
import {
  AlignmentFlags,
  HtmlTextParser,
  roundHalfEven,
  MetaFile,
  MetaFileVersion,
  MetaObjectDraw,
  MetaObjectText,
  MetaObjectType,
  type HtmlFormatRun,
  type MetaObject,
  type MetaPage,
  type Point,
  type PrintOut,
  type TextObjectStruct,
} from '@reportman/metafile';
import { toUpperNet, trimNet } from '../util/chars.js';
import { messageOf } from '../util/netexception.js';
import { sampleStandardDeviation, standardDeviation } from '../util/doubleutil.js';
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

  /**
   * HTML text needs a device that lays it out (the TrueType provider of the PDF device: the
   * FreeType driver); with the standard 14 fonts it fails clearly, where the C# standard driver
   * fails with a NullReferenceException.
   */
  protected checkHtml(adriver: PrintOut | null = null): void {
    if (!this.isHtml) return;
    const driver = this.report.driver ?? adriver;
    if (driver === null || !driver.supportsHtmlText()) throw new NotSupportedYetError('HTML text (the item ' + this.name + ')');
  }

  /**
   * Replaces the {{expression}} placeholders of an HTML text with their values
   * (EvaluateHtmlExpressions); a placeholder that fails to evaluate is kept as it is.
   */
  protected evaluateHtmlExpressions(text: string): string {
    if (text === '') return text;
    const ev = this.report.evaluator;
    let sb = '';
    let pos = 0;
    while (pos < text.length) {
      const start = text.indexOf('{{', pos);
      if (start < 0) {
        sb += text.substring(pos);
        break;
      }
      const end = text.indexOf('}}', start + 2);
      if (end < 0) {
        sb += text.substring(pos);
        break;
      }
      sb += text.substring(pos, start);
      const expr = trimNet(text.substring(start + 2, end));
      try {
        const result = ev.evaluateText(expr);
        sb += result.toString(ev.context);
      } catch {
        sb += text.substring(start, end + 2);
      }
      pos = end + 2;
    }
    return sb;
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
    this.checkHtml(adriver);
    const apage = metafile.pages.get(metafile.currentPage);
    const metaobj = new MetaObjectText();
    this.fillAnnotation(metaobj, apage);
    const finalText = this.isHtml ? this.evaluateHtmlExpressions(this.text) : this.text;
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
    this.checkHtml(adriver);
    const atext = this.textObject(this.isHtml ? this.evaluateHtmlExpressions(this.text) : this.text);
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
  /** The rest of an HTML text that continues on the next page (FHtmlPartialText). */
  private fHtmlPartialText: string | null = null;
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
      if (this.isHtml) aresult = this.evaluateHtmlExpressions(aresult);
    } catch (e) {
      if (e instanceof ReportException) throw e;
      throw new ReportException(messageOf(e) + '\n' + this.name + ' Prop:Expression', this.name, 'Expression');
    }
    // The rest of an HTML text that continues on this page
    if (this.isHtml && this.fIsPartial && this.fHtmlPartialText !== null) return this.fHtmlPartialText;
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
      if (this.isHtml) {
        let split = this.trySplitHtmlForMultipage(adriver, textObj, extent);
        if (split === null) split = { current: textObj.text, remaining: '' };
        textObj.text = split.current;
        if (split.remaining !== '') {
          this.fIsPartial = true;
          partialPrint.value = true;
          this.fHtmlPartialText = split.remaining;
        } else {
          this.fIsPartial = false;
          this.fForcedPartial = false;
          this.fHtmlPartialText = null;
        }
      } else {
        this.fHtmlPartialText = null;
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
    // The page counts are written into their text later: each one in a place of its own (shared,
    // the last one written was the text of all the counts of the page)
    aobj.textP = this.isPageCount || this.isGroupPageCount ? apage.addNewString(textObj.text) : apage.addString(textObj.text);
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
        this.fHtmlPartialText = null;
        this.fOldString = '';
        this.fUpdated = false;
        this.fDataCount = 0;
        this.fValues.length = 0;
        if (this.aggregate !== Aggregate.None) iniValue();
        break;
      case SubReportEvent.SubReportStart:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fHtmlPartialText = null;
        this.fOldString = '';
        this.fUpdated = false;
        this.fDataCount = 0;
        this.fValues.length = 0;
        if (this.aggregate !== Aggregate.None && this.aggregate !== Aggregate.General) iniValue();
        break;
      case SubReportEvent.DataChange:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fHtmlPartialText = null;
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
                // The first value starts the minimum, as in the Delphi engine: compared with the
                // initial value (0 by default) the minimum of positive values was 0
                if (result.varType === VariantType.Null) this.fDataCount--;
                else if (this.fDataCount === 1 || Variant.greaterThan(this.value, result, ctx)) this.value = result;
                break;
              case AggregateType.Maximum:
                if (result.varType === VariantType.Null) this.fDataCount--;
                else if (this.fDataCount === 1 || Variant.lessThan(this.value, result, ctx)) this.value = result;
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
                  this.fValues.push(result.toDouble(ctx));
                  // A report converted from Delphi: the sample deviation of its Math.StdDev
                  this.value = Variant.fromDouble(
                    this.report.convertedFromDelphi ? sampleStandardDeviation(this.fValues) : standardDeviation(this.fValues),
                  );
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
        this.fHtmlPartialText = null;
        this.fUpdated = false;
        this.fOldString = '';
        if (this.aggregate === Aggregate.Group) {
          if (toUpperNet(this.groupName) === toUpperNet(newgroup)) {
            iniValue();
            // The group starts counting again, as in the Delphi engine: the average divided by the
            // rows of every group so far, and the deviation kept their values
            this.fDataCount = 0;
            this.fValues.length = 0;
          }
        }
        break;
      case SubReportEvent.PageChange:
        this.fOldString = '';
        // Page variable must be recalculated
        if (this.aggregate === Aggregate.None) this.fUpdated = false;
        if (this.aggregate === Aggregate.Page) {
          iniValue();
          // The page starts counting again, as in the Delphi engine
          this.fDataCount = 0;
          this.fValues.length = 0;
          this.subReportChanged(SubReportEvent.DataChange, '');
        }
        break;
      case SubReportEvent.InvalidateValue:
        this.fIsPartial = false;
        this.fForcedPartial = false;
        this.fHtmlPartialText = null;
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
      if (this.isHtml) {
        let split = this.trySplitHtmlForMultipage(adriver, atext, extent);
        if (split === null) split = { current: atext.text, remaining: '' };
        isPartial = split.remaining !== '';
        atext.text = split.current;
        aresult = adriver.textExtent(atext, aresult);
        if (isPartial) aresult.y = extent.y;
      } else {
        const aposition = MetaFile.calcTextExtent(adriver, extent, atext);
        if (aposition < atext.text.length) isPartial = true;
        atext.text = atext.text.substring(0, aposition);
        aresult = adriver.textExtent(atext, aresult);
        if (isPartial) aresult.y = extent.y;
      }
    } else aresult = adriver.textExtent(atext, aresult);
    this.lastExtent = { ...aresult };
    return aresult;
  }

  /**
   * The part of an HTML text that fits the height of the extent and the rest (TrySplitHtmlForMultipage):
   * the lines of the layout that fit give the length of plain text that fits, the runs are split
   * there, a blank at the start of the rest is skipped and both parts are written again as HTML.
   * Null when the text cannot be split (the whole text then goes on this page).
   */
  private trySplitHtmlForMultipage(adriver: PrintOut, textObj: TextObjectStruct, maxExtent: Point): { current: string; remaining: string } | null {
    const all = { current: textObj.text, remaining: '' };
    if (textObj.text === '' || maxExtent.y <= 0) return all;
    const measureExtent = { ...maxExtent };
    if (measureExtent.x <= 0) measureExtent.x = this.printWidth;
    const lines = adriver.textExtentLineInfo(textObj, measureExtent).lines;
    if (lines === null || lines.length === 0) return null;
    let visibleLength = 0;
    let consumedHeight = 0;
    for (const line of lines) {
      const lineHeight = line.height > 0 ? line.height : roundHalfEven(line.lineHeight);
      if (lineHeight <= 0) continue;
      if (consumedHeight + lineHeight > maxExtent.y) break;
      consumedHeight += lineHeight;
      const lineEnd = line.position + line.size;
      if (lineEnd > visibleLength) visibleLength = lineEnd;
    }
    if (visibleLength <= 0) return null;
    const runs = HtmlTextParser.parse(textObj.text, this.wFontName);
    let totalPlainLength = 0;
    for (const run of runs) totalPlainLength += run.text.length;
    if (totalPlainLength <= 0) return all;
    if (visibleLength >= totalPlainLength) return all;
    const currentRuns: HtmlFormatRun[] = [];
    const remainingRuns: HtmlFormatRun[] = [];
    let remainingVisible = visibleLength;
    for (const run of runs) {
      const runText = run.text;
      if (remainingVisible <= 0) {
        if (runText.length > 0) remainingRuns.push({ ...run });
        continue;
      }
      if (runText.length <= remainingVisible) {
        if (runText.length > 0) currentRuns.push({ ...run });
        remainingVisible -= runText.length;
        continue;
      }
      currentRuns.push({ ...run, text: runText.substring(0, remainingVisible) });
      remainingRuns.push({ ...run, text: runText.substring(remainingVisible) });
      remainingVisible = 0;
    }
    // A blank at the start of the rest is skipped
    for (let index = 0; index < remainingRuns.length; index++) {
      const run = remainingRuns[index] as HtmlFormatRun;
      if (run.text === '') continue;
      const first = run.text.charAt(0);
      if (first === ' ' || first === '\n') {
        run.text = run.text.substring(1);
        if (run.text === '') remainingRuns.splice(index, 1);
      }
      break;
    }
    if (!hasPrintableHtmlContent(remainingRuns)) return all;
    const current = buildHtmlFromRuns(currentRuns);
    const remaining = buildHtmlFromRuns(remainingRuns);
    if (current === '' || remaining === '') return null;
    return { current, remaining };
  }
}

/** Whether runs have a character that is not white space (HasPrintableHtmlContent). */
function hasPrintableHtmlContent(runs: HtmlFormatRun[]): boolean {
  for (const run of runs) {
    for (const ch of run.text) {
      const c = ch.charCodeAt(0);
      const white = c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
      if (!white && c !== 0xa0) return true;
    }
  }
  return false;
}

function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** The HTML of styled runs (BuildHtmlFromRuns). */
function buildHtmlFromRuns(runs: HtmlFormatRun[]): string {
  let builder = '';
  for (const run of runs) {
    if (run.text === '') continue;
    let segment = encodeHtmlText(run.text);
    if (segment === '') continue;
    if (run.hasColor) segment = '<font color="#' + hex2(run.color) + hex2(run.color >> 8) + hex2(run.color >> 16) + '">' + segment + '</font>';
    if (run.hasFontSize) segment = '<span style="font-size:' + formatSize(run.fontSize) + 'pt">' + segment + '</span>';
    if (run.fontFamily !== null && run.fontFamily !== '') segment = '<font face="' + encodeHtmlAttribute(run.fontFamily) + '">' + segment + '</font>';
    if (run.strikeOut) segment = '<strike>' + segment + '</strike>';
    if (run.underline) segment = '<u>' + segment + '</u>';
    if (run.italic) segment = '<i>' + segment + '</i>';
    if (run.bold) segment = '<b>' + segment + '</b>';
    builder += segment;
  }
  return builder;
}

/** float.ToString("0.##"): at most two decimals, rounded half away from zero, no trailing zeros. */
function formatSize(v: number): string {
  const r = Math.round(Math.abs(v) * 100) / 100;
  let s = r.toFixed(2).replace(/\.?0+$/, '');
  if (v < 0 && s !== '0') s = '-' + s;
  return s;
}

function encodeHtmlText(text: string): string {
  let b = '';
  for (const ch of text) {
    switch (ch) {
      case '&':
        b += '&amp;';
        break;
      case '<':
        b += '&lt;';
        break;
      case '>':
        b += '&gt;';
        break;
      case '"':
        b += '&quot;';
        break;
      case '\r':
        break;
      case '\n':
        b += '<br>';
        break;
      case ' ':
        b += '&nbsp;';
        break;
      default:
        b += ch;
    }
  }
  return b;
}

function encodeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
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
 * An item the TypeScript engine does not draw yet (images, charts): the report fails
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
