// Port of the runtime part of Reportman.Reporting.BaseReport and Report: a report while it is
// laid out into a metafile (BeginPrint, the parameters, the datasets, PrintNextPage with its
// sections, groups, page headers and footers, columns, skips and page counts, EndPrint).
//
// The operations that may reach the data host are Ops (see data/op.ts); the rest, as the
// evaluator, is synchronous.

import type {
  ExpressionItem as ExpressionModel,
  LabelItem as LabelModel,
  PrintPosItem as PrintPosModel,
  Report as ReportModel,
  ShapeItem as ShapeModel,
} from 'reportman-lib';
import {
  type IntegerFormatter,
  MetaFile,
  MetaObjectDraw,
  MetaObjectImage,
  MetaObjectText,
  MetaObjectType,
  MetaPage,
  type OrientationType,
  PageSizeDetail,
  type Point,
  type PrintOut,
  type TotalPage,
} from 'reportman-metafile';
import { Evaluator, type EvalHost } from '../eval/evaluator.js';
import { DatasetAlias } from '../eval/fields.js';
import { type EvalIdentifier, EvalIdentifiers, IdenVariableParam } from '../eval/identifiers.js';
import { fromBase64String } from '../util/base64.js';
import { toUpperNet, trimNet, replaceNet } from '../util/chars.js';
import { CultureInfo } from '../util/culture.js';
import type { RpDateTime } from '../util/datetime.js';
import { formatDateTime, type LocalTimeZone, utcTimeZone } from '../util/dateformat.js';
import { messageOf, NamedException, nullReferenceException, UnNamedException } from '../util/netexception.js';
import { formatDecimal, formatDouble, formatInteger } from '../util/numberformat.js';
import { convertDoubleToInt32, NumberStyles, parseInt32 } from '../util/numberparse.js';
import { Translator } from '../util/translator.js';
import type { VariantContext } from '../variant/context.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import type { StoredValue } from '../data/columns.js';
import type { CsDecimal } from '../util/decimal.js';
import { DriverType } from 'reportman-lib';
import { ReportDatabase } from '../data/databaseinfo.js';
import { ReportDataInfo, variantDbType, variantParameterValue } from '../data/datainfo.js';
import { NotSupportedYetError } from '../data/errors.js';
import type { DataHost, ParameterValueType, QueryParameter } from '../data/host.js';
import { type Op, runSync, wait } from '../data/op.js';
import { ReportDataset } from '../data/reportdataset.js';
import { ReportParam } from '../params/param.js';
import { NoDataToPrintException, ReportException } from './errors.js';
import {
  IdenBarcodeOp,
  IdenEof,
  IdenGetValueFromSQL,
  IdenGraphicOp,
  IdenImageOp,
  IdenOrientationOp,
  IdenPageOp,
  IdenParamInfo,
  IdenReOpen,
  IdenReportVar,
  IdenSetLanguage,
  IdenTextHeight,
  IdenTextOp,
} from './identifiers.js';
import {
  ExpressionItem,
  LabelItem,
  type PartialRef,
  type PrintPosItem,
  pt,
  ShapeItem,
  SubReportEvent,
} from './items.js';
import { SectionRuntime, SectionType, SkipType } from './section.js';
import { ImageItem } from './imageitem.js';
import type { ImageItem as ImageModel } from 'reportman-lib';
import { SubReportRuntime } from './subreport.js';
import { barcodeOp, BarcodeItem } from './barcode/barcodeitem.js';
import type { BarcodeItem as BarcodeModel } from 'reportman-lib';
import { ChartItem } from './chart/chartitem.js';
import type { ChartItem as ChartModel } from 'reportman-lib';
import {
  IdenGraphicBounds,
  IdenGraphicClear,
  IdenGraphicColor,
  IdenGraphicNew,
  IdenGraphicNewFunction,
  IdenGraphicNewXY,
  IdenGraphicSerieColor,
} from './chart/chartidens.js';

/** BaseReport.MAX_PAGENUM. */
export const MAX_PAGENUM = 100000;
const INT_MAX = 2147483647;
const MILIS_PROGRESS_DEFAULT = 500;

/** PageSizeType. */
enum PageSizeType {
  Default,
  Custom,
  User,
}

/** Report progress: records and pages so far; return true to cancel the report. */
export type ReportProgress = (recordCount: number, pageCount: number) => boolean | void;

/** What a report run needs besides the report. */
export interface ReportRuntimeOptions {
  host: DataHost;
  /** The culture of numbers and dates (the C# thread culture). */
  culture: CultureInfo;
  /** The clock and file system of the expressions. */
  evalHost: EvalHost;
  /** The engine messages (Translator); by default the one the culture gives. */
  translator?: Translator;
  /** Report progress, called at most every half second, and at the end. */
  onProgress?: ReportProgress;
  /** Only these subreports (by index) and their children run (ExecuteSubReportIndexes). */
  subReportIndexes?: number[];
  /**
   * Add the pages to the metafile of another report (Compose). C# parity: a report that never
   * printed on its own has no initial page detail, and the first page fails (NullReferenceException)
   * as in C#; prepareReport does not offer it.
   */
  compose?: MetaFile;
  /** The local time zone of the expressions (dates with a zone, the "K" format); UTC by default. */
  timeZone?: LocalTimeZone;
}

/** A mutable context: the culture changes per page with the report language, as the thread culture. */
class RunContext implements VariantContext {
  culture: CultureInfo;
  readonly translator: Translator;
  readonly timeZone: LocalTimeZone;
  readonly now: () => RpDateTime;

  constructor(culture: CultureInfo, translator: Translator, now: () => RpDateTime, timeZone: LocalTimeZone) {
    this.culture = culture;
    this.translator = translator;
    this.now = now;
    this.timeZone = timeZone;
  }
}

/** The culture of a report language while a page prints (PrintNextPage), undefined to keep it. */
function languageCulture(language: number): CultureInfo | undefined {
  switch (language) {
    case 0:
      return CultureInfo.get('en-US');
    case 1:
      return CultureInfo.get('es-ES');
    case 2:
      // C# parity: C# selects the neutral culture "ca"; its formats are those of ca-ES
      return CultureInfo.get('ca-ES');
  }
  return undefined;
}

export class ReportRuntime {
  readonly model: ReportModel;
  readonly host: DataHost;
  readonly translator: Translator;
  private readonly context: RunContext;
  private readonly evalHost: EvalHost;
  /** DataTable.Locale of the datasets (the culture when the report was prepared). */
  readonly locale: CultureInfo;
  readonly invariant = CultureInfo.invariant;
  private readonly onProgress: ReportProgress | undefined;

  // The model, at run time
  readonly params: ReportParam[] = [];
  readonly databases: ReportDatabase[] = [];
  readonly dataInfos: ReportDataInfo[] = [];
  readonly subReports: SubReportRuntime[] = [];
  private readonly expressionItems: ExpressionItem[] = [];
  private readonly chartItems: ChartItem[] = [];
  /**
   * ChartingDriver: the device that draws the charts instead of the device the report prints
   * with (null: that device draws them, with its drawChart or else the vector chart).
   */
  chartingDriver: PrintOut | null = null;

  // BaseReport state
  metaFile: MetaFile;
  evaluator!: Evaluator;
  private fLanguage: number;
  private readonly fDataAlias = new DatasetAlias();
  private readonly evalIdens: EvalIdentifiers;
  private readonly openingDatasets = new Set<string>();
  private fDriver: PrintOut | null = null;
  private errorProcessing = false;
  private lastErrorProcessing = '';
  private readonly pendingSections: SectionRuntime[] = [];
  private readonly fGroupHeaders: SectionRuntime[] = [];
  private readonly gHeaders: SectionRuntime[] = [];
  private readonly gFooters: SectionRuntime[] = [];
  private readonly fTotalPages: TotalPage[] = [];
  private mmfirst = 0;
  private fCompose: boolean;
  lastPage = false;
  private section: SectionRuntime | null = null;
  private subreport: SubReportRuntime | null = null;
  printing = false;
  private fRecordCount = 0;
  currentSubReportIndex = 0;
  private currentSectionIndex = 0;
  private oldprintedsectionext: Point = pt(0, 0);
  private oldsubreport: SubReportRuntime | null = null;
  private havepagefooters = false;
  private sectionextevaluated = false;
  private oldprintedsection: SectionRuntime | null = null;
  pageposx = 0;
  pageposy = 0;
  private pagespacex = 0;
  private pagefooters: SectionRuntime[] | null = null;
  private asection: SectionRuntime | null = null;
  private pagefooterpos = 0;
  private sectionext: Point = pt(0, 0);
  private fintpageindex = 0;
  printedSomething = false;
  pageNum = 0;
  pageNumGroup = 0;
  internalPageWidth = 0;
  internalPageHeight = 0;
  freeSpace = 0;
  currentOrientation: OrientationType;
  updatePageSize = false;
  initialPageDetail: PageSizeDetail | null = null;
  /** ExecuteSubReportIndexes. */
  executeSubReportIndexes: number[] | null;
  pageSizeIndex: number;

  constructor(model: ReportModel, options: ReportRuntimeOptions) {
    this.model = model;
    this.host = options.host;
    this.locale = options.culture;
    this.translator = options.translator ?? Translator.forCulture(options.culture);
    this.evalHost = options.evalHost;
    this.context = new RunContext(options.culture, this.translator, () => this.evalHost.now(), options.timeZone ?? utcTimeZone);
    this.onProgress = options.onProgress;
    this.executeSubReportIndexes = options.subReportIndexes ?? null;
    this.fCompose = options.compose !== undefined;
    this.metaFile = options.compose ?? new MetaFile();
    this.fLanguage = model.language;
    this.pageSizeIndex = model.pageSizeIndex;
    this.currentOrientation = model.pageOrientation as number as OrientationType;
    // MetaFile settings the C# property setters copy at load time
    this.metaFile.linesPerInch = model.linesPerInch;
    this.metaFile.printerSelect = model.printerSelect as number;

    for (const db of model.databaseInfo) this.databases.push(new ReportDatabase(this, db));
    for (const di of model.dataInfo) this.dataInfos.push(new ReportDataInfo(this, di));
    for (const p of model.params) this.params.push(new ReportParam(this, p));
    this.buildSubReports();

    const iden = (name: string, i: EvalIdentifier): [string, EvalIdentifier] => [name, i];
    const idens: [string, EvalIdentifier][] = [
      iden('PAGE', new IdenReportVar(this, 'PAGE')),
      iden('PAGINA', new IdenReportVar(this, 'PAGE')),
      iden('LANGUAGE', new IdenReportVar(this, 'LANGUAGE')),
      iden('PAGENUM', new IdenReportVar(this, 'PAGENUM')),
      iden('PAGEWIDTH', new IdenReportVar(this, 'PAGEWIDTH')),
      iden('PAGEHEIGHT', new IdenReportVar(this, 'PAGEHEIGHT')),
      iden('FREE_SPACE_CMS', new IdenReportVar(this, 'FREE_SPACE_CMS')),
      iden('FREE_SPACE_INCH', new IdenReportVar(this, 'FREE_SPACE_INCH')),
      iden('FREE_SPACE_TWIPS', new IdenReportVar(this, 'FREE_SPACE_TWIPS')),
      iden('CURRENTGROUP', new IdenReportVar(this, 'CURRENTGROUP')),
      iden('CURRENTPOSX', new IdenReportVar(this, 'CURRENTPOSX')),
      iden('CURRENTPOSY', new IdenReportVar(this, 'CURRENTPOSY')),
      iden('FIRSTSECTION', new IdenReportVar(this, 'FIRSTSECTION')),
      iden('EOF', new IdenEof(this)),
      iden('SETLANGUAGE', new IdenSetLanguage(this)),
      iden('REOPEN', new IdenReOpen(this)),
      iden('GRAPHICOP', new IdenGraphicOp(this)),
      iden('IMAGEOP', new IdenImageOp(this)),
      iden('BARCODEOP', new IdenBarcodeOp(this)),
      iden('TEXTOP', new IdenTextOp(this)),
      iden('TEXTHEIGHT', new IdenTextHeight(this)),
      iden('PARAMINFO', new IdenParamInfo(this)),
      iden('SETPAGESOURCE', new IdenPageOp(this)),
      iden('SETPAGEORIENTATION', new IdenOrientationOp(this)),
      iden('GETVALUEFROMSQL', new IdenGetValueFromSQL(this)),
      iden('GRAPHICNEW', new IdenGraphicNew(this)),
      iden('GRAPHICNEWXY', new IdenGraphicNewXY(this)),
      iden('GRAPHICNEWFUNCTION', new IdenGraphicNewFunction(this)),
      iden('GRAPHICCLEAR', new IdenGraphicClear(this)),
      iden('GRAPHICCOLOR', new IdenGraphicColor(this)),
      iden('GRAPHICSERIECOLOR', new IdenGraphicSerieColor(this)),
      iden('GRAPHICBOUNDS', new IdenGraphicBounds(this)),
    ];
    this.evalIdens = new EvalIdentifiers(options.culture.name);
    for (const [k, v] of idens) this.evalIdens.add(k, v);
    this.initEvaluator();
  }

  // -------------------------------------------------------------------------------------------
  // Construction

  private buildSubReports(): void {
    const byName = new Map<string, SubReportRuntime | SectionRuntime>();
    for (const sm of this.model.subReports) {
      const sub = new SubReportRuntime(this, sm);
      this.subReports.push(sub);
      byName.set(toUpperNet(sm.name), sub);
      for (const secm of sm.sections) {
        const sec = new SectionRuntime(this, secm);
        sub.sections.push(sec);
        if (!byName.has(toUpperNet(secm.name))) byName.set(toUpperNet(secm.name), sec);
        for (const cm of secm.components) {
          const item = this.newItem(cm);
          sec.components.push(item);
        }
      }
    }
    // Reload links (ReportReader): parents, child subreports and the subreport of each section
    this.model.subReports.forEach((sm, i) => {
      const sub = this.subReports[i]!;
      if (sm.parentSub.length > 0) sub.parentSubReport = (byName.get(sm.parentSub) as SubReportRuntime) ?? null;
      if (sm.parentSec.length > 0) sub.parentSection = (byName.get(sm.parentSec) as SectionRuntime) ?? null;
      sm.sections.forEach((secm, j) => {
        const sec = sub.sections[j]!;
        if (secm.childSubReportName.length > 0) {
          const child = byName.get(secm.childSubReportName);
          if (!(child instanceof SubReportRuntime))
            throw new NamedException('ChildSubReport not found:' + secm.childSubReportName, secm.childSubReportName);
          sec.childSubReport = child;
          child.parentSection = sec;
          // C# parity: the parent of a child subreport is set to the child itself (only tested for null)
          child.parentSubReport = child;
        }
        if (secm.subReportName.length > 0) sec.subReport = sub;
      });
    });
  }

  private newItem(cm: PrintPosModel): PrintPosItem {
    switch (cm.className) {
      case 'TRPLABEL':
        return new LabelItem(this, cm as LabelModel);
      case 'TRPEXPRESSION': {
        const item = new ExpressionItem(this, cm as ExpressionModel);
        this.expressionItems.push(item);
        return item;
      }
      case 'TRPSHAPE':
        return new ShapeItem(this, cm as ShapeModel);
      case 'TRPIMAGE':
        return new ImageItem(this, cm as ImageModel);
      case 'TRPBARCODE':
        return new BarcodeItem(this, cm as BarcodeModel);
      case 'TRPCHART': {
        const item = new ChartItem(this, cm as ChartModel);
        this.chartItems.push(item);
        return item;
      }
      default:
        throw new Error('Unknown report item class: ' + String(cm.className));
    }
  }

  /** A new dataset buffer (DataInfo constructor: new ReportDataset). */
  newDataset(): ReportDataset {
    return new ReportDataset(this.locale, () => this.context.culture, this.invariant, () => this.evalHost.now());
  }

  /** The current culture (changes per page with the report language). */
  get culture(): CultureInfo {
    return this.context.culture;
  }

  get driver(): PrintOut | null {
    return this.fDriver;
  }

  /** Language: the evaluator follows it. */
  get language(): number {
    return this.fLanguage;
  }

  set language(value: number) {
    this.fLanguage = value;
    if (this.evaluator !== undefined) this.evaluator.language = value;
  }

  toUpper(s: string): string {
    return toUpperNet(s);
  }

  convertToInt32(value: number): number {
    return convertDoubleToInt32(value);
  }

  /** Int32.ToString(format) under the current culture, for the page counts. */
  readonly integerFormatter: IntegerFormatter = (value: number, format: string) =>
    formatInteger(value, format, this.context.culture.number, 32);

  /** object.ToString() of a value of a dataset row, under the current culture. */
  objectText(cell: { type: ParameterValueType; value: StoredValue }): string {
    const v = cell.value;
    const nfi = this.context.culture.number;
    switch (cell.type) {
      case 'DBNull':
      case 'Null':
        return '';
      case 'String':
        return v as string;
      case 'Int64':
      case 'Int32':
      case 'Byte':
        return formatInteger(v as bigint | number, '', nfi);
      case 'Double':
        return formatDouble(v as number, '', nfi);
      case 'Decimal':
        return formatDecimal(v as CsDecimal, '', nfi);
      case 'Boolean':
        return v ? 'True' : 'False';
      case 'DateTime':
        return formatDateTime(v as RpDateTime, '', this.context.culture);
      case 'Binary':
        return 'System.Byte[]';
      default:
        return String(v);
    }
  }

  paramIndexOf(alias: string): number {
    for (let i = 0; i < this.params.length; i++) if (this.params[i]!.alias === alias) return i;
    return -1;
  }

  paramByAlias(alias: string): ReportParam | null {
    const i = this.paramIndexOf(alias);
    return i < 0 ? null : this.params[i]!;
  }

  /** DataInfos.IndexOf: by alias, case-sensitive. */
  dataInfoIndexOf(alias: string): number {
    for (let i = 0; i < this.dataInfos.length; i++) if (this.dataInfos[i]!.alias === alias) return i;
    return -1;
  }

  dataInfoByAlias(alias: string): ReportDataInfo | null {
    const i = this.dataInfoIndexOf(alias);
    return i < 0 ? null : this.dataInfos[i]!;
  }

  /** DatabaseInfos.IndexOf: by alias. */
  private databaseIndexOf(alias: string): number {
    for (let i = 0; i < this.databases.length; i++) if (this.databases[i]!.alias === alias) return i;
    return -1;
  }

  /** Moves a dataset to its next record (its details may execute again). */
  *next(data: ReportDataset): Op<boolean> {
    return yield* data.next();
  }

  // -------------------------------------------------------------------------------------------
  // Evaluator, parameters, datasets

  /** InitEvaluator: a new evaluator, its dataset needed event and language. */
  initEvaluator(): void {
    this.evaluator = new Evaluator({ context: this.context, host: this.evalHost, language: this.fLanguage });
    this.evaluator.onDatasetNeeded = (args) => this.onDatasetNeeded(args.dataset);
    this.evaluator.language = this.fLanguage;
  }

  /** A field of a dataset that is not open: the dataset opens (inside the evaluation). */
  private onDatasetNeeded(dataset: string): void {
    if (this.openingDatasets.has(dataset)) return;
    this.openingDatasets.add(dataset);
    try {
      const dinfo = this.dataInfoByAlias(dataset);
      if (dinfo !== null) {
        if (dinfo.dataReader === null) {
          this.updateParamsBeforeOpen(this.dataInfoIndexOf(dataset), true);
          runSync(dinfo.connect(), 'Opening the dataset ' + dataset + ' from an expression');
        }
      }
    } finally {
      this.openingDatasets.delete(dataset);
    }
  }

  /** AddReportItemsToEvaluator: parameters, expression identifiers and the report identifiers. */
  addReportItemsToEvaluator(ev: Evaluator): void {
    for (const p of this.params) ev.addIden('M.' + p.alias, new IdenVariableParam(ev, p));
    for (const item of this.expressionItems) {
      if (item.identifier.length > 0) {
        // EvalIdenExpression of C# keeps the evaluator of the report (for its error messages)
        item.idenExpression.evalObject = ev;
        ev.addVariable(item.identifier, item.idenExpression);
      }
    }
    for (const c of this.chartItems) if (c.identifier.length > 0) ev.addVariable(c.identifier, c.idenChart);
    for (const aname of this.evalIdens.keys) {
      const i = this.evalIdens.get(aname)!;
      if (aname !== 'EOF') ev.addVariable(aname, i);
      else ev.addIden(aname, i);
    }
  }

  /** InitializeParams: the report items in the evaluator and the value of every parameter. */
  initializeParams(): void {
    this.addReportItemsToEvaluator(this.evaluator);
    const ctx = this.evaluator.context;
    for (const p of this.params) {
      p.updateInitialValue();
      if (p.paramType === ParamType.ExpreB) {
        const paramname = p.alias;
        try {
          if (p.value.varType !== VariantType.Null) {
            const text = 'M.' + paramname + ':=(' + p.value.toString(ctx) + ')';
            this.evaluator.evaluateText(text);
            p.lastValue = this.evaluator.evaluateText(paramname);
          }
        } catch (e) {
          throw new ReportException(messageOf(e) + 'Parameter error:' + p.alias, p.name, 'Value');
        }
      } else p.lastValue = p.listValue;
    }
    this.evaluator.language = this.fLanguage;
  }

  /** UpdateInitialValues: the initial expressions evaluated (what a parameters form shows). */
  updateInitialValues(): void {
    this.initEvaluator();
    this.addReportItemsToEvaluator(this.evaluator);
    for (const p of this.params) p.updateInitialValue();
  }

  /** RestoreInitialValues: the initial expressions back. */
  restoreInitialValues(): void {
    for (const p of this.params) p.restoreInitialValue();
  }

  /** CheckParameters: the alias of the first parameter whose validation fails ("" when none). */
  checkParameters(): string {
    let aresult = '';
    this.initEvaluator();
    this.addReportItemsToEvaluator(this.evaluator);
    for (const p of this.params) {
      p.updateInitialValue();
      if (p.paramType !== ParamType.ExpreB) p.lastValue = p.listValue;
    }
    for (const p of this.params) {
      const validation = trimNet(p.validation);
      if (validation.length > 0) {
        const evalresult = this.evaluator.evaluateText(validation);
        if (!evalresult.isNull) {
          if (evalresult.isBoolean()) {
            if (!evalresult.toBool(this.evaluator.context)) {
              aresult = p.alias;
              break;
            }
          }
        }
      }
    }
    return aresult;
  }

  /** UpdateParamsBeforeOpen: the expressions to evaluate before a dataset opens. */
  updateParamsBeforeOpen(index: number, doeval: boolean): void {
    const ctx = this.evaluator.context;
    const alias = this.dataInfos[index]!.alias;
    for (const aparam of this.params) {
      if (aparam.datasets.indexOf(alias) >= 0 && aparam.paramType === ParamType.ExpreB) {
        const paramname = aparam.alias;
        if (aparam.value.varType !== VariantType.Null) {
          if (doeval) {
            this.evaluator.evaluateText('M.' + paramname + ':=(' + aparam.value.toString(ctx) + ')');
            aparam.lastValue = this.evaluator.evaluateText('M.' + paramname);
          } else aparam.lastValue = this.evaluator.evaluateText(aparam.value.toString(ctx));
        }
      }
    }
    for (const aparam of this.params) {
      if (
        aparam.datasets.indexOf(alias) >= 0 &&
        (aparam.paramType === ParamType.SubstExpre || aparam.paramType === ParamType.SubsExpreList)
      ) {
        const paramname = aparam.alias;
        if (aparam.value.varType !== VariantType.Null) {
          if (doeval) {
            const oldvalue = aparam.lastValue;
            this.evaluator.evaluateText('M.' + paramname + ':=(' + aparam.value.toString(ctx) + ')');
            aparam.lastValue = oldvalue;
          } else aparam.lastValue = this.evaluator.evaluateText(aparam.value.toString(ctx));
        }
      }
    }
  }

  private updateParamsAfterOpen(index: number, doeval: boolean): void {
    const ctx = this.evaluator.context;
    const alias = this.dataInfos[index]!.alias;
    for (const aparam of this.params) {
      if (aparam.datasets.indexOf(alias) >= 0 && aparam.paramType === ParamType.ExpreA) {
        const paramname = aparam.alias;
        if (aparam.value.varType !== VariantType.Null) {
          if (doeval) {
            this.evaluator.evaluateText('M.' + paramname + ':=(' + aparam.value.toString(ctx) + ')');
            aparam.lastValue = this.evaluator.evaluateText('M.' + paramname);
          } else aparam.lastValue = this.evaluator.evaluateText(aparam.value.toString(ctx));
        }
      }
    }
  }

  private prepareParamsAfterOpen(): void {
    for (let i = 0; i < this.dataInfos.length; i++) this.updateParamsAfterOpen(i, false);
    const ctx = this.evaluator.context;
    for (const aparam of this.params) {
      if (aparam.paramType === ParamType.ExpreA && aparam.datasets.length === 0) {
        const paramname = aparam.alias;
        if (aparam.value.varType !== VariantType.Null) {
          this.evaluator.evaluateText('M.' + paramname + ':=(' + aparam.value.toString(ctx) + ')');
          aparam.lastValue = this.evaluator.evaluateText('M.' + paramname);
        }
      }
    }
  }

  /** CheckIfDataAvailable: PrintOnlyIfDataAvailable and no subreport dataset has rows. */
  private checkIfDataAvailable(): void {
    if (!this.model.printOnlyIfDataAvailable) return;
    let dataavail = false;
    for (const sub of this.subReports) {
      if (sub.alias.length > 0) {
        const index = this.dataInfoIndexOf(sub.alias);
        if (index >= 0) {
          const data = this.dataInfos[index]!.data;
          if (data.active && !data.eof) {
            dataavail = true;
            break;
          }
        }
      }
    }
    if (!dataavail) {
      this.metaFile.empty = true;
      throw new NoDataToPrintException(this.translator.translateStr(799));
    }
  }

  /** DeActivateDatasets: every dataset and connection closed (connections commit). */
  *deActivateDatasets(): Op<void> {
    for (const d of this.dataInfos) {
      d.disConnect();
      d.disConnectMem();
    }
    for (const db of this.databases) yield* db.disConnect();
  }

  /** Every connection closed, HTTP agents too (the end of a run). */
  *closeAll(): Op<void> {
    yield* this.deActivateDatasets();
    for (const db of this.databases) yield* db.close(true);
  }

  /** SubreportMustBeExecuted: the ExecuteSubReportIndexes filter. */
  subreportMustBeExecuted(nsubreport: SubReportRuntime): boolean {
    const list = this.executeSubReportIndexes;
    if (list === null || list.length === 0) return true;
    const idx = this.subReports.indexOf(nsubreport);
    for (const index of list) if (index === idx) return true;
    return false;
  }

  /** ActivateDatasets: the datasets that open on start. */
  private *activateDatasets(): Op<void> {
    try {
      for (const d of this.dataInfos) d.sqlOverride = '';
      for (let i = 0; i < this.dataInfos.length; i++) {
        const dinfo = this.dataInfos[i]!;
        dinfo.sqlOverride = '';
        if (dinfo.openOnStart) {
          let openDataset = true;
          const list = this.executeSubReportIndexes;
          if (list !== null && list.length > 0) {
            openDataset = false;
            for (const subrep of this.subReports) {
              if (subrep.alias === dinfo.alias && this.subreportMustBeExecuted(subrep)) openDataset = true;
            }
          }
          if (dinfo.dataReader === null && openDataset) {
            this.updateParamsBeforeOpen(i, true);
            yield* dinfo.connect();
          }
        }
      }
      for (const sub of this.subReports) {
        const alias = sub.alias;
        if (this.subreportMustBeExecuted(sub) && alias.length > 0) {
          if (this.dataInfoIndexOf(alias) < 0) throw new NamedException('Data alias not found:' + alias, alias);
        }
      }
    } catch (e) {
      yield* this.deActivateDatasets();
      throw e;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Printing

  private checkProgress(finished: boolean): void {
    const mmlast = Date.now();
    // C# parity: the milliseconds component of the elapsed time, not the total
    const difmilis = (mmlast - this.mmfirst) % 1000;
    if (difmilis >= MILIS_PROGRESS_DEFAULT || finished) {
      this.mmfirst = Date.now();
      if (this.onProgress !== undefined && this.onProgress(this.fRecordCount, this.metaFile.pages.currentCount) === true)
        throw new UnNamedException(this.translator.translateStr(503));
    }
  }

  /** AddTotalPagesItem: a text that prints the page count. */
  addTotalPagesItem(apageindex: number, aobjectindex: number, adisplayformat: string): void {
    this.fTotalPages.push({ pageIndex: apageindex, objectIndex: aobjectindex, displayFormat: adisplayformat });
  }

  private fillGlobalHeaders(): void {
    this.gHeaders.length = 0;
    this.gFooters.length = 0;
    for (const subrep of this.subReports) {
      let j = subrep.firstPageHeader;
      for (let k = 0; k < subrep.pageHeaderCount; k++) if (subrep.sections[j + k]!.global) this.gHeaders.push(subrep.sections[j + k]!);
      j = subrep.firstPageFooter;
      for (let k = 0; k < subrep.pageFooterCount; k++) if (subrep.sections[j + k]!.global) this.gFooters.push(subrep.sections[j + k]!);
    }
  }

  /** EndPrint: datasets closed, page counts written, the metafile finished. */
  *endPrint(): Op<void> {
    yield* this.deActivateDatasets();
    this.section = null;
    this.subreport = null;
    this.printing = false;
    this.fDriver = null;
    this.metaFile.updateTotalPages(this.fTotalPages, this.integerFormatter);
    this.metaFile.finish();
    this.lastPage = true;
  }

  /**
   * RequestPage: generates pages until the one asked for exists (every page for a two pass
   * report); true when the report has finished.
   */
  *requestPage(pageindex: number): Op<boolean> {
    if (pageindex === INT_MAX) pageindex--;
    if (this.lastPage) return true;
    if (this.model.twoPass) pageindex = INT_MAX - 1;
    if (pageindex < this.metaFile.pages.currentCount) return this.lastPage;
    this.fintpageindex = pageindex;
    yield* this.doPrintInternal();
    return this.lastPage;
  }

  private *doPrintInternal(): Op<void> {
    if (!this.lastPage) {
      this.checkProgress(false);
      while (!(yield* this.printNextPage())) {
        this.checkProgress(false);
        if (this.pageNum > MAX_PAGENUM) throw new UnNamedException('Maximum number of pages reached' + String(MAX_PAGENUM));
        if (this.pageNum >= this.fintpageindex) break;
        if (this.lastPage) break;
      }
    }
    this.checkProgress(false);
  }

  private updateChildSubreportIndexes(): void {
    const list = this.executeSubReportIndexes;
    if (list === null || list.length === 0) return;
    this.updateExecuteSubreportIndexes([...list], 0);
  }

  private updateExecuteSubreportIndexes(subreportIndexes: number[], recCount: number): void {
    recCount++;
    if (recCount > 100) throw new Error('Circular childsubreport reference');
    const list = this.executeSubReportIndexes!;
    for (const idx of subreportIndexes) {
      const subreport = this.subReports[idx];
      if (subreport === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
      for (const sec of subreport.sections) {
        if (sec.childSubReport !== null) {
          const newIdx = this.subReports.indexOf(sec.childSubReport);
          if (!list.includes(newIdx)) list.push(newIdx);
          this.updateExecuteSubreportIndexes([newIdx], recCount);
        }
      }
    }
  }

  /** DoUpdatePageSize: the page size of a page, asked to the device when it changes. */
  doUpdatePageSize(page: MetaPage, detail: PageSizeDetail | null): void {
    if (detail === null) throw nullReferenceException();
    const nd = new PageSizeDetail();
    page.pageDetail = nd;
    nd.paperSource = detail.paperSource;
    nd.duplex = detail.duplex;
    nd.forcePaperName = detail.forcePaperName;
    nd.physicWidth = detail.physicWidth;
    nd.physicHeight = detail.physicHeight;
    page.orientation = this.currentOrientation;
    nd.index = detail.index;
    nd.custom = detail.custom;
    if (detail.custom) {
      nd.customWidth = detail.customWidth;
      nd.customHeight = detail.customHeight;
    }
    if (!this.updatePageSize) return;
    page.updatedPageSize = true;
    const driver = this.requireDriver();
    driver.setOrientation(this.currentOrientation);
    let apagesize: Point;
    if ((this.model.pageSize as number) !== PageSizeType.Default) apagesize = driver.setPageSize(page.pageDetail);
    else {
      const r = driver.getPageSize();
      apagesize = r.size;
      this.pageSizeIndex = r.indexqt;
    }
    this.internalPageWidth = apagesize.x;
    this.pagespacex = this.internalPageWidth;
    this.internalPageHeight = apagesize.y;
  }

  private requireDriver(): PrintOut {
    if (this.fDriver === null) throw nullReferenceException();
    return this.fDriver;
  }

  /** BeginPrint: the metafile, the page size, the parameters and the datasets; the first section. */
  *beginPrint(driver: PrintOut): Op<void> {
    const model = this.model;
    const list = this.executeSubReportIndexes;
    if (list !== null && list.length > 0) this.updateChildSubreportIndexes();
    if (!this.fCompose) this.fTotalPages.length = 0;
    yield* this.endPrint();
    if (model.twoPass) this.metaFile.forwardOnly = false;
    this.mmfirst = Date.now();
    this.fDriver = driver;
    const meta = this.metaFile;
    if (!this.fCompose) {
      meta.clear();
      meta.pdfConformance = model.pdfConformance as number;
      meta.pdfCompressed = model.pdfCompressed;
      meta.docAuthor = model.docAuthor ?? null;
      meta.docProducer = model.docProducer ?? null;
      meta.docCreator = model.docCreator ?? null;
      meta.docCreationDate = model.docCreationDate ?? null;
      meta.docModificationDate = model.docModificationDate ?? null;
      meta.docSubject = model.docSubject ?? null;
      meta.docKeywords = model.docKeywords ?? null;
      meta.docTitle = model.docTitle ?? null;
      meta.docXMPContent = model.docXMPContent ?? null;
    }
    for (const efile of model.embeddedFiles) {
      if (efile.streamBase64 === undefined) throw nullReferenceException();
      meta.newEmbeddedFile(
        efile.fileName ?? '',
        efile.mimeType ?? '',
        efile.afRelationShip as number,
        efile.description ?? '',
        efile.creationDate ?? '',
        efile.modificationDate ?? '',
        fromBase64String(efile.streamBase64),
      );
    }
    meta.empty = false;
    try {
      meta.printerFonts = model.printerFonts as number;
      this.updatePageSize = false;
      this.fillGlobalHeaders();
      this.pendingSections.length = 0;
      this.errorProcessing = false;
      meta.printerSelect = model.printerSelect as number;
      driver.selectPrinter(model.printerSelect as number);
      if (this.fCompose) {
        meta.forwardOnly = false;
        this.internalPageWidth = meta.customX;
        this.internalPageHeight = meta.customY;
        this.pageNum = meta.pages.currentCount - 2;
      } else {
        let apagesize: Point;
        meta.empty = false;
        meta.printerFonts = model.printerFonts as number;
        meta.previewAbout = model.previewAbout;
        meta.previewMargins = model.previewMargins;
        meta.linesPerInch = model.linesPerInch;
        meta.paperSource = model.paperSource;
        // Sets page orientation
        this.currentOrientation = model.pageOrientation as number as OrientationType;
        if ((model.pageOrientation as number) !== 0) driver.setOrientation(model.pageOrientation as number as OrientationType);
        const pageDetail = new PageSizeDetail();
        this.initialPageDetail = pageDetail;
        pageDetail.paperSource = model.paperSource;
        pageDetail.duplex = model.duplex;
        pageDetail.forcePaperName = model.forcePaperName ?? null;
        if ((model.pageSize as number) !== PageSizeType.Default) {
          if ((model.pageSize as number) === PageSizeType.User) {
            meta.pageSizeIndex = -1;
            pageDetail.index = meta.pageSizeIndex;
            pageDetail.custom = true;
            pageDetail.customHeight = model.customPageHeight;
            pageDetail.customWidth = model.customPageWidth;
            meta.customX = model.customPageWidth;
            meta.customY = model.customPageHeight;
            pageDetail.physicHeight = model.customPageHeight;
            pageDetail.physicWidth = model.customPageWidth;
          } else {
            meta.pageSizeIndex = this.pageSizeIndex;
            pageDetail.index = this.pageSizeIndex;
            pageDetail.custom = false;
            pageDetail.customWidth = model.customPageWidth;
            pageDetail.customHeight = model.customPageHeight;
            meta.customX = model.customPageWidth;
            meta.customY = model.customPageHeight;
            pageDetail.physicHeight = model.customPageHeight;
            pageDetail.physicWidth = model.customPageWidth;
          }
          apagesize = driver.setPageSize(pageDetail);
        } else {
          const r = driver.getPageSize();
          apagesize = r.size;
          meta.pageSizeIndex = r.indexqt;
          meta.customX = model.customPageWidth;
          meta.customY = model.customPageHeight;
          pageDetail.physicHeight = apagesize.y;
          pageDetail.physicWidth = apagesize.x;
        }
        this.internalPageWidth = apagesize.x;
        this.internalPageHeight = apagesize.y;
        meta.orientation = model.pageOrientation as number as OrientationType;
        meta.backColor = model.pageBackColor;
        meta.customX = this.internalPageWidth;
        meta.customY = this.internalPageHeight;
        this.pageNum = -1;
      }
      meta.printerSelect = model.printerSelect as number;
      meta.autoScale = model.autoScale as number;
      meta.previewWindow = model.previewWindow as number;
      meta.openDrawerAfter = model.actionAfter;
      meta.openDrawerBefore = model.actionBefore;
      for (const sub of this.subReports) sub.lastRecord = false;
      this.lastPage = false;
      this.initEvaluator();
      this.pageNumGroup = -1;
      this.fRecordCount = 0;
      this.initializeParams();
      this.fDataAlias.list.length = 0;
      for (const d of this.dataInfos) this.fDataAlias.add(d.alias, d.data);
      try {
        yield* this.activateDatasets();
      } catch (e) {
        yield* this.deActivateDatasets();
        throw e;
      }
      this.checkIfDataAvailable();
      this.evaluator.aliasList = this.fDataAlias;
      this.prepareParamsAfterOpen();
      for (const sub of this.subReports) if (this.subreportMustBeExecuted(sub)) sub.subReportChanged(SubReportEvent.Start, '');
      this.currentSubReportIndex = -1;
      let dataavail = false;
      do {
        do {
          this.currentSubReportIndex++;
        } while (
          this.currentSubReportIndex < this.subReports.length &&
          !this.subreportMustBeExecuted(this.subReports[this.currentSubReportIndex]!)
        );
        if (this.currentSubReportIndex >= this.subReports.length) break;
        const subrep = this.subReports[this.currentSubReportIndex]!;
        if (subrep.parentSubReport === null) {
          if (subrep.alias.length === 0) dataavail = true;
          else if (subrep.printOnlyIfDataAvailable) {
            const index = this.dataInfoIndexOf(subrep.alias);
            if (!this.dataInfos[index]!.data.eof) dataavail = true;
          } else dataavail = true;
        }
        if (dataavail) {
          subrep.subReportChanged(SubReportEvent.SubReportStart, '');
          subrep.subReportChanged(SubReportEvent.DataChange, '');
          this.currentSectionIndex = -1;
          subrep.currentGroupIndex = -subrep.groupCount;
          if (subrep.currentGroupIndex < 0) this.currentSectionIndex = subrep.firstDetail + subrep.currentGroupIndex - 1;
          this.section = null;
          this.subreport = null;
          if (!(yield* this.nextSection(true))) dataavail = false;
        }
      } while (!dataavail);
      if (!dataavail) {
        yield* this.endPrint();
        meta.empty = true;
        throw new NoDataToPrintException(this.translator.translateStr(799));
      }
      this.printing = true;
    } catch (e) {
      meta.empty = true;
      throw e;
    }
  }

  private *nextSection(child: boolean): Op<boolean> {
    let searchGroupHeader = false;
    const oldsection = this.section;
    this.section = null;
    // If the old selected section has a child subreport then execute first
    if (oldsection !== null && child) {
      if (oldsection.childSubReport !== null) {
        let dataavail = false;
        const subrep = oldsection.childSubReport;
        if (subrep.alias.length === 0) dataavail = true;
        else {
          const index = this.dataInfoIndexOf(subrep.alias);
          if (index < 0) throw new NamedException('Data alias not found:' + subrep.alias, subrep.alias);
          const dinfo = this.dataInfos[index]!;
          if (dinfo.dataSource.length === 0) {
            dinfo.disConnect();
            this.updateParamsBeforeOpen(index, true);
            yield* dinfo.connect();
            dinfo.goFirstMem();
          } else if (dinfo.data.eof) {
            if (subrep.reOpenOnPrint) {
              dinfo.disConnect();
              this.updateParamsBeforeOpen(index, true);
              yield* dinfo.connect();
              dinfo.goFirstMem();
            }
          }
          if (!dinfo.data.eof) dataavail = true;
          else searchGroupHeader = true;
        }
        subrep.lastRecord = !dataavail;
        if (dataavail || !subrep.printOnlyIfDataAvailable) {
          subrep.subReportChanged(SubReportEvent.SubReportStart, '');
          this.subreport = subrep;
          this.section = null;
          this.currentSectionIndex = -1;
          this.pendingSections.push(oldsection);
          this.currentSubReportIndex = this.subReports.indexOf(subrep);
          subrep.subReportChanged(SubReportEvent.DataChange, '');
          subrep.currentGroupIndex = -subrep.groupCount;
          if (subrep.currentGroupIndex < 0) this.currentSectionIndex = subrep.firstDetail + subrep.currentGroupIndex - 1;
        }
      } else searchGroupHeader = true;
    } else searchGroupHeader = true;
    if (this.fGroupHeaders.length === 0) searchGroupHeader = false;
    if (searchGroupHeader) {
      const index = oldsection === null ? -1 : this.fGroupHeaders.indexOf(oldsection);
      if (index >= 0) {
        this.fGroupHeaders.splice(index, 1);
        if (this.fGroupHeaders.length > 0) {
          this.section = this.fGroupHeaders[0]!;
          const asec = this.lastPending();
          this.currentSubReportIndex = this.subReportIndexOf(asec.subReport);
          if (this.currentSubReportIndex < 0) throw new UnNamedException('SubReport not found');
          this.subreport = this.section.subReport;
        } else {
          this.section = this.lastPending();
          this.currentSubReportIndex = this.subReportIndexOf(this.section.subReport);
          if (this.currentSubReportIndex < 0) throw new UnNamedException('SubReport not found');
          this.pendingSections.pop();
          this.subreport = this.section.subReport;
          this.currentSectionIndex = this.subreport!.sections.indexOf(this.section);
          if (this.currentSectionIndex < 0) throw new UnNamedException('Section not found');
        }
      }
    }
    if (this.section !== null) return true;
    // Check the condition
    while (this.currentSubReportIndex < this.subReports.length) {
      this.checkProgress(false);
      let subrep = this.subReports[this.currentSubReportIndex]!;
      // The first section are the group footers until CurrentGroup
      while (subrep.currentGroupIndex !== 0) {
        this.checkProgress(false);
        const lastdetail = subrep.lastDetail;
        const firstdetail = subrep.firstDetail;
        this.currentSectionIndex++;
        if (subrep.currentGroupIndex > 0) {
          if (subrep.currentGroupIndex < this.currentSectionIndex - lastdetail) {
            // Restore position, and the next will be group headers
            if (subrep.lastRecord) {
              this.currentSectionIndex = subrep.sections.length;
              subrep.currentGroupIndex = 0;
              break;
            } else {
              // Send Messages for each group
              subrep.initGroups(subrep.currentGroupIndex);
              // Restores position
              yield* this.nextRecord(true);
              this.currentSectionIndex = subrep.firstDetail - subrep.currentGroupIndex;
              subrep.currentGroupIndex = -subrep.currentGroupIndex;
              const sec = this.sectionOf(subrep, this.currentSectionIndex);
              if (sec.evaluatePrintCondition()) {
                this.section = sec;
                this.subreport = subrep;
                break;
              }
            }
          } else {
            const sec = this.sectionOf(subrep, this.currentSectionIndex);
            if (sec.evaluatePrintCondition()) {
              this.section = sec;
              this.subreport = subrep;
              break;
            }
          }
        } else {
          // Group headers
          if (this.currentSectionIndex < firstdetail) {
            const sec = this.sectionOf(subrep, this.currentSectionIndex);
            if (sec.evaluatePrintCondition()) {
              this.section = sec;
              this.subreport = subrep;
              break;
            }
          } else {
            subrep.currentGroupIndex = 0;
            this.currentSectionIndex = -1;
          }
        }
      }
      if (this.section !== null) break;
      while (this.currentSectionIndex < subrep.sections.length) {
        this.checkProgress(false);
        if (this.currentSectionIndex < 0) this.currentSectionIndex = subrep.firstDetail;
        else this.currentSectionIndex++;
        if (!subrep.lastRecord) {
          if (this.currentSectionIndex > subrep.lastDetail) {
            if (yield* this.nextRecord(false)) {
              this.currentSectionIndex = subrep.lastDetail;
              break;
            }
            if (!subrep.lastRecord) {
              this.currentSectionIndex = subrep.firstDetail;
              const sec = this.sectionOf(subrep, this.currentSectionIndex);
              if (sec.evaluatePrintCondition()) {
                this.section = sec;
                this.subreport = subrep;
                break;
              }
            } else {
              this.currentSectionIndex = subrep.lastDetail;
              subrep.currentGroupIndex = subrep.groupCount;
              break;
            }
          } else if (this.currentSectionIndex <= subrep.lastDetail) {
            const sec = this.sectionOf(subrep, this.currentSectionIndex);
            if (sec.evaluatePrintCondition()) {
              this.section = sec;
              this.subreport = subrep;
              break;
            }
          }
        }
      }
      if (this.section === null && subrep.currentGroupIndex === 0) {
        // If it's a child subreport, returns null section so pending will print
        if (subrep.parentSubReport !== null) break;
        for (;;) {
          subrep.subReportChanged(SubReportEvent.SubReportEnd, '');
          do {
            this.currentSubReportIndex++;
          } while (
            this.currentSubReportIndex < this.subReports.length &&
            !this.subreportMustBeExecuted(this.subReports[this.currentSubReportIndex]!)
          );
          if (this.currentSubReportIndex >= this.subReports.length) break;
          subrep = this.subReports[this.currentSubReportIndex]!;
          if (subrep.parentSubReport === null) {
            if (subrep.isDataAvailable()) {
              subrep.subReportChanged(SubReportEvent.SubReportStart, '');
              subrep.subReportChanged(SubReportEvent.DataChange, '');
              break;
            }
          }
        }
        if (this.currentSubReportIndex >= this.subReports.length) break;
        this.currentSectionIndex = subrep.firstDetail - subrep.groupCount - 1;
        subrep.currentGroupIndex = -subrep.groupCount;
        subrep.lastRecord = false;
      } else if (subrep.currentGroupIndex === 0) break;
    }
    const aresult = this.section !== null;
    // If there are still pending sections
    if (this.section === null) {
      if (this.pendingSections.length > 0) {
        this.section = this.lastPending();
        this.currentSubReportIndex = this.subReportIndexOf(this.section.subReport);
        if (this.currentSubReportIndex < 0) throw new UnNamedException('Subreport not found');
        this.pendingSections.pop();
        this.subreport = this.section.subReport;
        this.currentSectionIndex = this.subreport!.sections.indexOf(this.section);
        if (this.currentSectionIndex < 0) throw new UnNamedException('Subreport not found');
        yield* this.nextSection(false);
      }
    }
    return aresult;
  }

  private lastPending(): SectionRuntime {
    const s = this.pendingSections[this.pendingSections.length - 1];
    if (s === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
    return s;
  }

  private subReportIndexOf(sub: SubReportRuntime | null): number {
    return sub === null ? -1 : this.subReports.indexOf(sub);
  }

  private sectionOf(subrep: SubReportRuntime, index: number): SectionRuntime {
    const s = subrep.sections[index];
    if (s === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
    return s;
  }

  private skipToPageAndPosition(): void {
    const asection = this.asection!;
    const ev = this.evaluator;
    const ctx = ev.context;
    let newposx = 0;
    let newposy = 0;
    try {
      // Go to page?
      if (asection.skipToPageExpre.length > 0) {
        if (!this.model.twoPass) throw new UnNamedException('Two pass report required for skip to feature');
        let newpage = convertDoubleToInt32(ev.evaluateText(asection.skipToPageExpre).toDouble(ctx));
        newpage = newpage - 1;
        if (newpage < 0) throw new UnNamedException('Can not combine skip to page');
        const meta = this.metaFile;
        while (newpage > meta.pages.currentCount) {
          meta.pages.add(new MetaPage(meta));
          const last = meta.pages.get(meta.pages.currentCount - 1);
          last.orientation = this.currentOrientation;
          this.doUpdatePageSize(last, last.pageDetail);
          this.checkProgress(false);
        }
        meta.currentPage = newpage;
        this.pageNum = meta.currentPage;
      }
    } catch (e) {
      throw new ReportException(messageOf(e), asection.name, 'SkipToPage');
    }
    let moveh = false;
    try {
      if (asection.skipExpreH.length > 0) {
        newposx = convertDoubleToInt32(ev.evaluateText(asection.skipExpreH).toDouble(ctx));
        moveh = true;
      }
    } catch (e) {
      throw new ReportException(messageOf(e), asection.name, 'SkipExpreH');
    }
    let movev = false;
    try {
      if (asection.skipExpreV.length > 0) {
        newposy = convertDoubleToInt32(ev.evaluateText(asection.skipExpreV).toDouble(ctx));
        movev = true;
      }
    } catch (e) {
      throw new ReportException(messageOf(e), asection.name, 'SkipExpreV');
    }
    if (moveh) {
      if (asection.skipRelativeH) this.pageposx = this.pageposx + newposx;
      else this.pageposx = newposx;
    }
    if (movev) {
      if (asection.skipRelativeV) this.pageposy = this.pageposy + newposy;
      else this.pageposy = newposy;
    }
    this.freeSpace = this.pagefooterpos - this.pageposy;
    if (this.freeSpace < 0) this.freeSpace = 0;
  }

  private checkSpace(): boolean {
    if (this.freeSpace === 0) return false;
    const maxExtent = pt(this.pagespacex, this.freeSpace);
    const asection = this.asection!;
    const driver = this.requireDriver();
    if (!this.sectionextevaluated) {
      // Skip to page and position
      if (asection.skipType === SkipType.Before) this.skipToPageAndPosition();
      this.sectionext = asection.getExtension(driver, maxExtent, false);
    }
    let aresult = true;
    if (this.sectionext.y > this.freeSpace) {
      if (this.printedSomething) aresult = false;
      else {
        // Force partial print for expressions
        this.sectionext = asection.getExtension(driver, maxExtent, true);
        if (this.sectionext.y > this.freeSpace)
          throw new UnNamedException(
            'No Espace to print SubReport ' + String(this.currentSubReportIndex) + ' Section ' + String(this.currentSectionIndex),
          );
      }
    }
    this.sectionextevaluated = false;
    return aresult;
  }

  private printSection(datasection: boolean, partialPrint: PartialRef): void {
    const section = this.section!;
    const subreport = this.subreport!;
    if (subreport.currentGroupIndex < 0) {
      if (section.groupName === this.sectionOf(subreport, subreport.firstDetail + subreport.currentGroupIndex).groupName) {
        if (section.iniNumPage) this.pageNumGroup = 0;
        section.firstPage = this.metaFile.currentPage;
      }
    }
    this.pagefooterpos = this.pageposy + this.freeSpace;
    partialPrint.value = false;
    const maxExtent = pt(this.pagespacex, this.freeSpace);
    const asection = this.asection!;
    if (datasection) {
      let ispagerepeat = false;
      if (asection.sectionType === SectionType.GroupHeader) ispagerepeat = asection.pageRepeat;
      if (!ispagerepeat) {
        this.oldprintedsection = section;
        this.oldprintedsectionext = { ...this.sectionext };
        if (this.fGroupHeaders.length < 1) this.printedSomething = true;
      }
    }
    const driver = this.requireDriver();
    if (!asection.alignBottom) {
      asection.print(driver, this.pageposx, this.pageposy, -1, -1, this.metaFile, maxExtent, partialPrint);
      this.freeSpace = this.freeSpace - this.sectionext.y;
      this.pageposy = this.pageposy + this.sectionext.y;
    } else {
      // Align to bottom
      this.pageposy = this.pageposy + this.freeSpace - this.sectionext.y;
      asection.print(driver, this.pageposx, this.pageposy, -1, -1, this.metaFile, maxExtent, partialPrint);
      this.freeSpace = 0;
    }
    if (asection.skipType === SkipType.After) this.skipToPageAndPosition();
  }

  private printFixedSections(headers: boolean): void {
    const partialPrint: PartialRef = { value: false };
    const maxExtent = pt(this.pagespacex, this.freeSpace);
    const subreport = this.subreport!;
    if (headers) {
      // First the global headers
      for (const psection of this.gHeaders) {
        if (psection.evaluatePrintCondition()) {
          this.asection = psection;
          this.checkSpace();
          this.printSection(false, partialPrint);
        }
      }
      // Print the header fixed sections
      const pheader = subreport.firstPageHeader;
      const pheadercount = subreport.pageHeaderCount;
      for (let i = 0; i < pheadercount; i++) {
        const psection = this.sectionOf(subreport, i + pheader);
        if (!psection.global) {
          if (psection.evaluatePrintCondition()) {
            this.asection = psection;
            this.checkSpace();
            this.printSection(false, partialPrint);
          }
        }
      }
      const psubreports: SubReportRuntime[] = [];
      for (const psection of this.pendingSections) {
        // C# parity: the subreport of a section without one (null) is added as null
        const sub = psection.subReport;
        if (sub === null) throw nullReferenceException();
        if (psubreports.indexOf(sub) < 0) psubreports.push(sub);
      }
      if (psubreports.indexOf(subreport) < 0) psubreports.push(subreport);
      // Now prints repeated group headers
      for (const subrep of psubreports) {
        const afirstdetail = subrep.firstDetail;
        for (let i = subrep.groupCount; i > 0; i--) {
          const psection = this.sectionOf(subrep, afirstdetail - i);
          if (psection.pageRepeat) {
            let dopagerepeat = false;
            // Allways if there is another active subreport
            if (subrep !== subreport) dopagerepeat = true;
            else if (this.section !== psection) {
              // Never if the current section is just the group header
              if (this.currentSectionIndex > subrep.firstDetail - i) {
                // If the section is enclosed between the header and the footer
                if (psection.forcePrint) {
                  if (this.currentSectionIndex <= subrep.lastDetail + i) dopagerepeat = true;
                } else if (this.currentSectionIndex < subrep.lastDetail + i) dopagerepeat = true;
              }
            }
            if (dopagerepeat && psection.evaluatePrintCondition()) {
              // Add group headers to be printed at the main print loop
              this.fGroupHeaders.push(psection);
            }
          }
        }
      }
      this.pagefooterpos = this.pageposy + this.freeSpace;
      // Reserve space for page footers: print conditions for footers are evaluated at the
      // begining of the page
      for (const psection of this.gFooters) {
        this.asection = psection;
        this.checkSpace();
        this.pagefooterpos = this.pageposy + this.freeSpace - this.sectionext.y;
        this.freeSpace = this.freeSpace - this.sectionext.y;
      }
      const pfooter = subreport.firstPageFooter;
      const pfootercount = subreport.pageFooterCount;
      for (let i = 0; i < pfootercount; i++) {
        const psection = this.sectionOf(subreport, i + pfooter);
        if (!psection.global) {
          this.asection = psection;
          this.havepagefooters = true;
          this.checkSpace();
          this.pagefooters!.push(psection);
          this.pagefooterpos = this.pageposy + this.freeSpace - this.sectionext.y;
          this.freeSpace = this.freeSpace - this.sectionext.y;
        }
      }
    } else {
      // Print page footers
      const pagefooters = this.pagefooters!;
      if (this.gFooters.length > 0 || pagefooters.length > 0) {
        this.pageposy = this.pagefooterpos;
        const driver = this.requireDriver();
        for (const asection of pagefooters) {
          this.asection = asection;
          if (!asection.global) {
            let printit = true;
            if (!asection.forcePrint && this.section === null) printit = false;
            if (printit && asection.evaluatePrintCondition()) {
              this.sectionext = asection.getExtension(driver, maxExtent, false);
              this.printSection(false, partialPrint);
              this.freeSpace = 0;
            }
          }
        }
        // Global page footers
        for (const asection of this.gFooters) {
          this.asection = asection;
          let printit = true;
          if (!asection.forcePrint && this.section === null) printit = false;
          if (printit && asection.evaluatePrintCondition()) {
            this.sectionext = asection.getExtension(driver, maxExtent, false);
            this.printSection(false, partialPrint);
            this.freeSpace = 0;
          }
        }
      }
    }
  }

  private *nextRecord(grouprestore: boolean): Op<boolean> {
    let aresult = false;
    const subrep = this.subReports[this.currentSubReportIndex]!;
    if (subrep.alias.length === 0) subrep.lastRecord = true;
    else {
      const index = this.dataInfoIndexOf(subrep.alias);
      if (index < 0) throw new NamedException('Alias not exists' + subrep.alias, subrep.alias);
      const data = this.dataInfos[index]!.data;
      yield* data.next();
      // If its the last record no group change
      if (!grouprestore) subrep.lastRecord = data.eof;
      if (!subrep.lastRecord) {
        if (!grouprestore) {
          subrep.groupChanged();
          if (subrep.currentGroupIndex > 0) {
            aresult = true;
            yield* data.prior();
          } else subrep.subReportChanged(SubReportEvent.DataChange, '');
        } else subrep.subReportChanged(SubReportEvent.DataChange, '');
      }
      this.fRecordCount++;
      this.checkProgress(false);
    }
    return aresult;
  }

  /** PrintNextPage: generates the next page; true when it is the last one. */
  *printNextPage(): Op<boolean> {
    if (this.errorProcessing) throw new UnNamedException('Error processing\n' + this.lastErrorProcessing);
    const meta = this.metaFile;
    this.pageNum++;
    this.pageNumGroup++;
    // Updates page size, and orientation
    if (meta.pages.currentCount <= this.pageNum) {
      if (this.model.twoPass) meta.forwardOnly = false;
      meta.pages.add(new MetaPage(meta));
    }
    meta.currentPage = this.pageNum;
    const pageDetail = this.initialPageDetail;
    this.doUpdatePageSize(meta.pages.get(meta.pages.currentCount - 1), pageDetail);
    this.fGroupHeaders.length = 0;
    this.printedSomething = false;
    if (this.section === null) throw new UnNamedException('Last sectoin reached');
    if (this.subreport !== null) for (const sub of this.subReports) sub.subReportChanged(SubReportEvent.PageChange, '');
    this.havepagefooters = false;
    this.sectionextevaluated = false;
    this.oldprintedsection = null;
    const model = this.model;
    if (!this.fCompose) {
      this.freeSpace = this.internalPageHeight;
      this.freeSpace = this.freeSpace - model.topMargin - model.bottomMargin;
      this.pageposy = model.topMargin;
      this.pageposx = model.leftMargin;
    } else {
      if (this.gHeaders.length > 0 || this.subreport!.pageHeaderCount > 0) {
        meta.pages.add(new MetaPage(meta));
        this.pageNum++;
        meta.currentPage = meta.pages.currentCount - 1;
        this.freeSpace = this.internalPageHeight;
        this.freeSpace = this.freeSpace - model.topMargin - model.bottomMargin;
        this.pageposy = model.topMargin;
        this.pageposx = model.leftMargin;
        this.doUpdatePageSize(meta.pages.get(meta.pages.currentCount - 1), pageDetail);
      } else this.printedSomething = true;
    }
    this.pagespacex = this.internalPageWidth;
    let oldhorzdespposition = model.leftMargin;
    const oldculture = this.context.culture;
    // Change culture
    const pageCulture = languageCulture(this.fLanguage);
    if (pageCulture !== undefined) this.context.culture = pageCulture;
    this.pagefooters = [];
    try {
      const partialPrint: PartialRef = { value: false };
      // Fills the page with fixed sections
      this.printFixedSections(true);
      // Group headers with child subreports
      if (this.fGroupHeaders.length > 0) {
        this.pendingSections.push(this.section!);
        this.section = this.fGroupHeaders[0]!;
      }
      this.oldsubreport = this.subreport;
      const lastvertpos = pt(this.pageposx, this.pageposy);
      while (this.section !== null) {
        const section: SectionRuntime = this.section;
        if (this.printedSomething) {
          if (section.evaluateBeginPage()) break;
        }
        this.asection = section;
        const driver = this.requireDriver();
        // Horz.Desp.
        const oldprinted = this.oldprintedsection as SectionRuntime | null;
        if (oldprinted !== null) {
          if (oldprinted.horzDesp) {
            if (section.horzDesp) {
              const maxExtent = pt(this.pagespacex, this.freeSpace);
              this.sectionext = section.getExtension(driver, maxExtent, false);
              this.sectionextevaluated = true;
              if (this.pageposx + this.oldprintedsectionext.x + this.sectionext.x <= this.pagespacex) {
                this.pageposx = this.pageposx + this.oldprintedsectionext.x;
                this.pageposy = this.pageposy - this.oldprintedsectionext.y;
                this.freeSpace = this.freeSpace + this.oldprintedsectionext.y;
              } else this.pageposx = model.leftMargin;
            } else this.pageposx = oldhorzdespposition;
          } else oldhorzdespposition = this.pageposx;
        }
        if (!this.checkSpace()) {
          // If the current section have vert desp, do a vertical and horz. desp if possible
          if (section.vertDesp) {
            // Go to old vertical position if fits horizontally
            const maxExtent = pt(this.pagespacex, lastvertpos.y - model.bottomMargin);
            this.sectionext = section.getExtension(driver, maxExtent, false);
            this.sectionextevaluated = true;
            if (this.pageposx + this.sectionext.x * 2 <= this.pagespacex) {
              this.freeSpace = this.freeSpace + (this.pageposy - lastvertpos.y);
              this.pageposx = this.pageposx + this.sectionext.x;
              this.pageposy = lastvertpos.y;
            } else {
              this.pageposx = model.leftMargin;
              break;
            }
            if (!this.checkSpace()) break;
          } else break;
        }
        partialPrint.value = false;
        this.printSection(true, partialPrint);
        if (!partialPrint.value) {
          if (!section.vertDesp) {
            lastvertpos.x = this.pageposx;
            lastvertpos.y = this.pageposy;
          }
          yield* this.nextSection(true);
          if (this.section !== null) {
            if (!(this.section as SectionRuntime).vertDesp) {
              lastvertpos.x = this.pageposx;
              lastvertpos.y = this.pageposy;
            }
          }
        }
        if (this.printedSomething) {
          if (this.asection!.skipPage) break;
        }
        // if Subreport changed and has have pagefooter
        if (this.oldsubreport !== this.subreport && this.havepagefooters) break;
        this.oldsubreport = this.subreport;
      }
      // Fills the page with fixed sections
      if (this.printedSomething) {
        const oldprinted = this.oldprintedsection as SectionRuntime | null;
        if (oldprinted !== null && oldprinted.horzDesp) this.pageposx = oldhorzdespposition;
      }
      this.printFixedSections(false);
      this.pagefooters = null;
      this.context.culture = oldculture;
    } catch (e) {
      this.context.culture = oldculture;
      this.pagefooters = null;
      this.errorProcessing = true;
      this.lastErrorProcessing = messageOf(e);
      throw e;
    }
    const aresult = this.section === null;
    this.lastPage = aresult;
    if (this.lastPage) {
      meta.finish();
      this.checkProgress(true);
    }
    if (aresult) yield* this.endPrint();
    return aresult;
  }

  // -------------------------------------------------------------------------------------------
  // The operations of the report identifiers

  graphicOp(
    left: number,
    top: number,
    width: number,
    height: number,
    drawStyle: number,
    brushStyle: number,
    brushColor: number,
    penStyle: number,
    penWidth: number,
    penColor: number,
  ): boolean {
    const obj = new MetaObjectDraw();
    obj.metaType = MetaObjectType.Draw;
    obj.top = top;
    obj.left = left;
    obj.height = height;
    obj.width = width;
    obj.drawStyle = drawStyle;
    obj.brushStyle = brushStyle;
    obj.brushColor = brushColor;
    obj.penStyle = penStyle;
    obj.penWidth = penWidth;
    obj.penColor = penColor;
    this.metaFile.pages.get(this.metaFile.currentPage).objects.push(obj);
    return true;
  }

  orientationOp(orientation: number): void {
    if (orientation < 0 || orientation > 2) throw new UnNamedException('Invalid page orientation');
    this.currentOrientation = orientation as OrientationType;
    this.updatePageSize = true;
    const meta = this.metaFile;
    const page = meta.pages.get(meta.pages.currentCount - 1);
    this.doUpdatePageSize(page, page.pageDetail);
  }

  pageOp(
    pageIndex: number,
    custom: boolean,
    customwidth: number,
    customheight: number,
    papersource: number,
    forcepapername: string,
    duplex: number,
  ): boolean {
    const meta = this.metaFile;
    // C# parity: Pages.Count generates every page first (a request of every page from inside an
    // expression); a page not generated yet is not supported here
    if (pageIndex >= meta.pages.currentCount && !meta.finished)
      throw new NotSupportedYetError('SETPAGESOURCE for a page that is not generated yet (page ' + String(pageIndex) + ')');
    if (pageIndex < meta.pages.currentCount) {
      const page = meta.pages.get(pageIndex);
      page.updatedPageSize = true;
      const d = page.pageDetail;
      // C# parity: the report's Duplex, not the one given
      void duplex;
      d.duplex = this.model.duplex;
      d.index = pageIndex;
      d.custom = custom;
      d.customHeight = customheight;
      d.customWidth = customwidth;
      d.paperSource = papersource;
      d.forcePaperName = forcepapername;
    }
    return true;
  }

  imageOp(
    left: number,
    top: number,
    width: number,
    height: number,
    drawStyle: number,
    dpires: number,
    previewOnly: boolean,
    image: string,
  ): boolean {
    const astream = this.evaluator.getStreamFromExpression(image);
    if (astream !== null) {
      const obj = new MetaObjectImage();
      obj.metaType = MetaObjectType.Image;
      obj.top = top;
      obj.left = left;
      obj.height = height;
      obj.width = width;
      obj.drawImageStyle = drawStyle;
      obj.dpiRes = dpires;
      obj.previewOnly = previewOnly;
      const page = this.metaFile.pages.get(this.metaFile.currentPage);
      obj.streamPos = page.addStream(astream, false);
      obj.streamSize = astream.length;
      page.objects.push(obj);
    }
    // C# parity: ImageOp returns false
    return false;
  }

  /** BarcodeOp (BARCODEOP): a barcode drawn in the current page (barcode/barcodeitem.ts). */
  barcodeOp(
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
    return barcodeOp(this, left, top, width, height, expression, displayFormat, barType, modul, ratio, rotation, calcChecksum, brushColor);
  }

  textOp(
    left: number,
    top: number,
    width: number,
    height: number,
    text: string,
    lFontName: string,
    wFontName: string,
    fontSize: number,
    fontRotation: number,
    fontStyle: number,
    fontColor: number,
    type1Font: number,
    cutText: boolean,
    alignment: number,
    wordWrap: boolean,
    rightToLeft: boolean,
    printStep: number,
    backColor: number,
    transparent: boolean,
  ): boolean {
    const obj = new MetaObjectText();
    obj.left = left;
    obj.top = top;
    obj.height = height;
    obj.width = width;
    obj.fontSize = (fontSize << 16) >> 16;
    obj.fontRotation = (fontRotation << 16) >> 16;
    obj.fontStyle = (fontStyle << 16) >> 16;
    obj.fontColor = fontColor;
    obj.rightToLeft = rightToLeft;
    obj.cutText = cutText;
    obj.alignment = alignment;
    obj.wordWrap = wordWrap;
    obj.printStep = printStep;
    obj.backColor = backColor;
    obj.transparent = transparent;
    obj.type1Font = type1Font;
    const page = this.metaFile.pages.get(this.metaFile.currentPage);
    obj.textP = page.addString(text);
    obj.textS = text.length;
    obj.lFontNameP = page.addString(lFontName);
    obj.lFontNameS = lFontName.length;
    obj.wFontNameP = page.addString(wFontName);
    obj.wFontNameS = wFontName.length;
    page.objects.push(obj);
    return true;
  }

  textHeightOp(
    text: string,
    lFontName: string,
    _wFontName: string,
    recWidth: number,
    fontSize: number,
    fontStyle: number,
    type1Font: number,
    printStep: number,
  ): number {
    const extent = this.requireDriver().textExtent(
      {
        text,
        lFontName,
        // C# parity: the report's default Windows font, not the one given (a misspelt argument)
        wFontName: this.model.wFontName,
        fontSize: (fontSize << 16) >> 16,
        fontRotation: 0,
        fontStyle: (fontStyle << 16) >> 16,
        fontColor: 0,
        type1Font,
        cutText: false,
        alignment: 0,
        wordWrap: true,
        rightToLeft: false,
        printStep,
        isHtml: false,
      },
      pt(recWidth, 0),
    );
    return extent.y;
  }

  paramInfoOp(paramName: string, index: number): Variant {
    const ctx = this.evaluator.context;
    let aresult: Variant = Variant.fromString('');
    const ind0 = this.paramIndexOf(toUpperNet(paramName));
    if (ind0 < 0) throw new NamedException('Parameter not found:' + paramName, paramName);
    const param = this.params[ind0]!;
    const textOf = (v: Variant): string => v.toString(ctx);
    // aresult + "\n" + s (values of a multiple selection) or aresult + (char)10 + s (the others)
    const append = (s: string, sep: 'string' | 'char'): void => {
      if (textOf(aresult).length > 0) {
        const separator = sep === 'char' ? Variant.fromChar(10) : Variant.fromString('\n');
        aresult = Variant.add(Variant.add(aresult, separator, ctx), Variant.fromString(s), ctx);
      } else aresult = Variant.fromString(s);
    };
    const toIndex = (s: string): number => parseInt32(s, NumberStyles.Integer, ctx.culture.number);
    const datasetsAndTexts = (): boolean => {
      switch (index) {
        case 6:
          for (const d of param.datasets) append(d, 'char');
          return true;
        case 7:
          aresult = Variant.fromString(param.description);
          return true;
        case 8:
          aresult = Variant.fromString(param.hint);
          return true;
        case 9:
          aresult = Variant.fromString(param.errorMessage);
          return true;
        case 10:
          aresult = Variant.fromString(param.validation);
          return true;
      }
      return false;
    };
    const pt2 = param.paramType;
    if (pt2 === ParamType.Multiple || pt2 === ParamType.List || pt2 === ParamType.SubsExpreList) {
      switch (index) {
        case 0:
          aresult = param.lastValue;
          break;
        case 1:
          if (pt2 === ParamType.Multiple) {
            for (const s of param.selected) {
              const ind = toIndex(s);
              if (param.values.length > ind) append(param.values[ind]!, 'string');
            }
          } else aresult = param.listValue;
          break;
        case 2:
          if (pt2 === ParamType.Multiple) {
            for (const s of param.selected) append(String(toIndex(s)), 'char');
          } else aresult = Variant.fromString(param.listValue.toString(ctx));
          break;
        case 3:
          if (pt2 === ParamType.Multiple) {
            for (const s of param.selected) {
              const ind = toIndex(s);
              if (param.items.length > ind) append(param.items[ind]!, 'char');
            }
          } else aresult = Variant.fromString(param.lastValue.toString(ctx));
          break;
        case 4:
          for (const s of param.items) append(s, 'char');
          break;
        case 5:
          for (const s of param.values) append(s, 'char');
          break;
        default:
          datasetsAndTexts();
          break;
      }
    } else if (!datasetsAndTexts()) aresult = Variant.fromString(param.lastValue.toString(ctx));
    return aresult;
  }

  reOpenOp(datasetName: string, sql: string): boolean {
    const index = this.dataInfoIndexOf(datasetName);
    if (index < 0) throw new NamedException('No data info found:' + datasetName, datasetName);
    const adata = this.dataInfos[index]!;
    adata.disConnect();
    // Evaluates from evaluator all parameters
    for (const p of this.params) p.lastValue = this.evaluator.evaluateText('M.' + p.alias);
    adata.sqlOverride = sql;
    runSync(adata.connect(), 'REOPEN of the dataset ' + datasetName);
    return true;
  }

  getSQLValueOp(connectionname: string, sql: string): Variant {
    const index = this.databaseIndexOf(toUpperNet(connectionname));
    if (index < 0) throw new NamedException('Connection name not found:' + connectionname, connectionname);
    return runSync(this.getValueFromSQL(this.databases[index]!, sql), 'GETVALUEFROMSQL');
  }

  /**
   * DatabaseInfo.GetDataReaderFromSQL with the first column of the first row. As the commands of
   * the datasets, the command runs inside the implicit transaction of the connection (an HTTP agent
   * one through its executor); the result is read whole, as C# closes its reader at once.
   */
  private *getValueFromSQL(db: ReportDatabase, sqlsentence: string): Op<Variant> {
    yield* db.connect();
    // C# parity: Connection.CreateCommand; a Mybase connection has no Connection
    if (db.driver === DriverType.Mybase) throw nullReferenceException();
    const connection = db.connection;
    if (connection === null) throw nullReferenceException();
    const ctx = this.evaluator.context;
    const dataalias = '';
    for (const aparam of this.params) {
      switch (aparam.paramType) {
        case ParamType.Subst:
        case ParamType.Multiple:
          if (aparam.datasets.indexOf(dataalias) >= 0)
            sqlsentence = replaceNet(sqlsentence, aparam.search, aparam.value.toImplicitString(ctx) ?? '');
          break;
        case ParamType.SubstExpre:
        case ParamType.SubsExpreList:
          // C# parity: the datasets are searched for the alias of the connection, and the value
          // is evaluated by a new evaluator without the report's identifiers
          if (aparam.datasets.indexOf(db.alias) >= 0) {
            const ev = new Evaluator({ context: this.context, host: this.evalHost });
            ev.expression = aparam.value.toString(ctx);
            const nvalue = ev.evaluate().toString(ctx);
            sqlsentence = replaceNet(sqlsentence, aparam.search, nvalue);
          }
          break;
      }
    }
    const parameters: QueryParameter[] = [];
    for (const aparam of this.params) {
      if (aparam.datasets.indexOf(dataalias) >= 0) {
        const t = aparam.paramType;
        if (t !== ParamType.Subst && t !== ParamType.Multiple && t !== ParamType.SubstExpre && t !== ParamType.SubsExpreList) {
          // C# parity: the value assigned is the Variant itself (no provider can bind it)
          const pv = variantParameterValue(aparam.value);
          parameters.push({ name: '@' + aparam.alias, value: pv.value, valueType: 'Object', dbType: variantDbType(aparam.value) });
        }
      }
    }
    const result = yield* wait(connection.query({ sql: sqlsentence, parameters, dataset: dataalias }));
    const first = result.rows[0];
    if (first === undefined) return Variant.null;
    // Variant.AssignFromObject(reader[0]): the value as the reader gives it, by its type
    const value = first[0];
    if (value === null || value === undefined) return Variant.null;
    if (typeof value === 'number') {
      switch (result.columns[0]?.type) {
        case 'Int64':
          return Number.isInteger(value) ? Variant.fromLong(value) : Variant.fromDouble(value);
        case 'Int32':
        case 'Int16':
          return Number.isInteger(value) ? Variant.fromInteger(value) : Variant.fromDouble(value);
        case 'Byte':
          return Number.isInteger(value) ? Variant.fromByte(value) : Variant.fromDouble(value);
        default:
          return Variant.fromDouble(value);
      }
    }
    return Variant.fromHost(value);
  }
}
