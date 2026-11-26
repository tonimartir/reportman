// The designer operations of Reportman.Server (Reportman.Designer.Server's DesignerService), one by
// one, over a backend: where the reports are stored and how a report runs with its connections. A
// report travels as the JSON the designer edits (the camelCase document of the C# engine, read with
// hydrateReport, written by designerDocument); the answers are the ones of Reportman.Server
// (test/golden-http compares them).
//
// This module uses no Node.js API, so the operations run in a browser too (a service worker answering
// the designer, as the live demo of reportman.es does). The backend of the Node server is
// node-backend.ts: the folder store and the engine of @reportman/node, with the connections of the
// server only (the ones of its dbxconnections.ini and the ones the program gives): a report connection
// the server does not define fails, whatever the report carries, and a connection string the report
// carries (ADOCONNECTIONSTRING) never changes where it goes.

import {
  CsDecimal,
  DateTimeKind,
  DatasetAlias,
  EvalException,
  EvalIdenExpression,
  Evaluator,
  IdenConstant,
  IdenFunction,
  IdenVariable,
  MemoryTable,
  NoDataToPrintException,
  ReportException,
  RpDateTime,
  Translator,
  CultureInfo,
  VariantType,
  runAsync,
  type ReportRun,
  type StoredValue,
  type Variant,
} from '@reportman/engine';
import { Report, exportSubReport, importReport, writeReportXmlBytes, type DataInfo } from '@reportman/lib';
import { designerDocument, modelFromDocument, modelFromXml } from './document.js';
import { DatasetColumnsCache, datasetColumns, datasetKey, netTypeName, type DatasetColumn } from './columns.js';
import { SqlSchemaService, type SchemaConnection, type SchemaFiles, type SqlSchema } from './schema.js';
import { base64ToBytes, bytesToBase64 } from './base64.js';

/** A stored report: its bytes and its version tag. */
export interface StoredReportContent {
  content: Uint8Array;
  eTag: string;
}

/**
 * Where the designer's reports are kept, by alias and path (FolderReportStore of @reportman/server).
 * A report that is not there fails with an error whose `kind` is 'notFound'; a save with an ETag
 * that is not the current one fails too (someone else changed it).
 */
export interface DesignerStore {
  open(alias: string, path: string): StoredReportContent | Promise<StoredReportContent>;
  /** Saves a report; expectedETag null creates it (it must not exist). Returns its new ETag. */
  save(alias: string, path: string, content: Uint8Array, expectedETag: string | null): { eTag: string } | Promise<{ eTag: string }>;
}

/** What the preview printed, besides its PDF. */
export interface PrintedMetafile {
  customX: number;
  customY: number;
  pageSizeIndex: number;
  pages: { currentCount: number };
}

/** A report opened to run, with the connections, culture, clock and fonts of its host. */
export interface DesignerRunner {
  /** A fresh run of a fresh copy of the model, for the tools (functions, syntax, data). Close it. */
  prepareRun(): Promise<ReportRun>;
  /** The preview: the PDF with the values the parameters form would start from. */
  executeToPdf(options: { subReportIndexes?: number[]; onMetafile: (meta: PrintedMetafile) => void }): Promise<Uint8Array>;
}

/** Where the designer's operations store and run reports. */
export interface DesignerBackend {
  readonly store: DesignerStore;
  /**
   * The model ready to run with the connections of a report alias ('' without one). layout false:
   * the tools that lay nothing out, which run with the standard fonts.
   */
  open(model: Report, reportAlias: string, layout: boolean): DesignerRunner;
  /** What a connection alias opens, as a key of the caches (never the connection string: it may carry a password). */
  fingerprint(reportAlias: string, databaseAlias: string): string;
  /** What the host knows of a connection alias, for the SQL editor (null: it does not define it). */
  schemaConnection(alias: string): SchemaConnection | null;
  /** The local schema files of the direct connections (dbxschemas), when the host keeps them. */
  readonly schemaFiles?: SchemaFiles | null;
}

/** The culture and clock of the operations. */
export interface DesignerOperationsOptions {
  /** The culture of the engine's texts, a .NET culture name ('en-US' by default). */
  culture?: string;
  /** The clock (DateTime.Now). */
  clock?: { now(): Date };
}

/** A store error saying that the report is not there (ServerError of kind notFound). */
function isNotFound(e: unknown): boolean {
  return e !== null && typeof e === 'object' && (e as { kind?: unknown }).kind === 'notFound';
}

/** The caller may not do what it asks (ForbiddenException): 403, or errorMessage in the protocol. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** The report printed nothing (ReportNoDataException): ExecuteReport answers noData. */
export class NoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDataError';
  }
}

/** The item and property of the report an error names (FillComponent). */
export function componentOf(e: unknown): { name?: string; property?: string } {
  if (e instanceof ReportException) return { name: e.itemName ?? undefined, property: e.propertyName ?? undefined };
  return {};
}

/** A report as the designer sends and receives it: the camelCase JSON of the engine model. */
export type ReportDocument = Record<string, unknown>;

/** FunctionHelp: an entry of the expression editor's list. */
export interface FunctionHelp {
  name?: string;
  category?: string;
  model?: string;
  hint?: string;
  categoryKey?: number;
  modelKey?: number;
  hintKey?: number;
}

/** DataSetInformation: the columns (and rows) of a dataset or of a table. */
export interface DataSetInformation {
  name: string;
  columns: { dbType: string; name: string }[];
  rows?: { values: unknown[] }[];
}

/** EvaluateResult. */
export interface EvaluateResult {
  dataType: string;
  value: unknown;
}

/** SyntaxCheckResult. */
export interface SyntaxCheckResult {
  valid: boolean;
  message?: string;
  line?: number;
  position?: number;
  datasetErrors: string[];
}

/** ReportResult: the preview. */
export interface ReportResult {
  base64Pdf: string;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
  pageSizeIndex?: number;
  pageSizeName?: string;
}

/** A value whose JSON text is written as it is (a decimal with its scale, a long beyond 2^53). */
export class JsonText {
  constructor(readonly text: string) {}
}

/** Where a request comes from: the name of the report it is about, when it says one ("ALIAS/path.rep"). */
export interface OperationContext {
  reportName?: string | null;
}

/** DateTime.AddYears: the same day and time years before or after (29 February to the 28th). */
function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setFullYear(result.getFullYear() + years);
  const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, last));
  return result;
}

// The engine's index (MetaFile.PageSizeArray, Qt's order as in Delphi), not Windows' DMPAPER_*
const PAGE_SIZE_NAMES = [
  'A4', 'B5', 'Letter', 'Legal', 'Executive', 'A0', 'A1', 'A2', 'A3', 'A5', 'A6', 'A7', 'A8', 'A9', 'B0',
  'B1', 'B10', 'B2', 'B3', 'B4', 'B6', 'B7', 'B8', 'B9', 'C5E', 'Comm10E', 'DLE', 'Folio', 'Ledger', 'Tabloid',
];

const pageSizeName = (index: number): string => (index >= 0 && index < PAGE_SIZE_NAMES.length ? PAGE_SIZE_NAMES[index]! : 'Custom');

// Variant.GetDbType().ToString()
const DB_TYPES: Record<string, string> = {
  [VariantType.Null]: 'Object',
  [VariantType.Boolean]: 'Boolean',
  [VariantType.Byte]: 'Byte',
  [VariantType.Char]: 'SByte',
  [VariantType.Integer]: 'Int32',
  [VariantType.Long]: 'Int64',
  [VariantType.Decimal]: 'Decimal',
  [VariantType.Double]: 'Double',
  [VariantType.DateTime]: 'DateTime',
  [VariantType.Binary]: 'Binary',
  [VariantType.String]: 'String',
};

/** DesignerService.TypeLabel: the hint of a dataset column in the expression editor. */
function typeLabel(netType: string): string {
  switch (netType) {
    case 'System.String':
    case 'System.Char':
      return 'string';
    case 'System.Int16':
    case 'System.Int32':
    case 'System.Int64':
    case 'System.Byte':
    case 'System.SByte':
    case 'System.UInt16':
    case 'System.UInt32':
    case 'System.UInt64':
      return 'integer';
    case 'System.Decimal':
      return 'currency';
    case 'System.Double':
    case 'System.Single':
      return 'float';
    case 'System.DateTime':
    case 'System.DateTimeOffset':
      return 'datetime';
    case 'System.TimeSpan':
    case 'System.TimeOnly':
      return 'time';
    case 'System.DateOnly':
      return 'date';
    case 'System.Boolean':
      return 'boolean';
    case 'System.Byte[]':
      return 'blob';
    default:
      return netType;
  }
}

/** A DateTime as Newtonsoft writes it: the fraction trimmed, Z for a UTC one. */
function dateTimeJson(d: RpDateTime): string {
  const iso = d.toIsoString();
  const [whole, fraction] = iso.split('.');
  const trimmed = (fraction ?? '').replace(/0+$/, '');
  return whole + (trimmed.length > 0 ? '.' + trimmed : '') + (d.kind === DateTimeKind.Utc ? 'Z' : '');
}

/** A value of a row as Newtonsoft writes the object of the DataRow (DBNull as null). */
function rowValue(v: StoredValue): unknown {
  if (v === null) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : new JsonText(v.toString());
  if (v instanceof Uint8Array) return bytesToBase64(v);
  if (v instanceof CsDecimal) return new JsonText(v.toInvariantString());
  if (v instanceof RpDateTime) return dateTimeJson(v);
  return v;
}

/** Convert.FromBase64String: the bytes of a base64 text, refusing what .NET refuses. */
function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[ \t\r\n]/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean))
    throw new Error('The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.');
  return base64ToBytes(clean);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The operations of the designer over a backend: its store and how its reports run. */
export class DesignerOperations {
  readonly backend: DesignerBackend;
  private readonly options: DesignerOperationsOptions;
  private readonly columns = new DatasetColumnsCache();
  private readonly schemas: SqlSchemaService;

  constructor(backend: DesignerBackend, options: DesignerOperationsOptions = {}) {
    this.backend = backend;
    this.options = options;
    this.schemas = new SqlSchemaService((alias) => backend.schemaConnection(alias), backend.schemaFiles ?? null, () => options.clock?.now() ?? new Date());
  }

  // ---- names, models ----

  /** "ALIAS/path/name.rep" → its alias and path (DesignerService.SplitName); a name without alias is refused. */
  static splitName(reportName: string | null | undefined): { alias: string; path: string } {
    const name = (reportName ?? '').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
    const slash = name.indexOf('/');
    if (slash <= 0 || slash === name.length - 1) throw new Error('The report name must be ALIAS/path.rep');
    return { alias: name.substring(0, slash), path: name.substring(slash + 1) };
  }

  /** The alias whose connections a request runs with: the one of its report name, else ''. */
  private aliasOf(context: OperationContext): string {
    const name = context.reportName;
    if (name === null || name === undefined || name.trim().length === 0) return '';
    try {
      return DesignerOperations.splitName(name).alias;
    } catch {
      return '';
    }
  }

  /** The model of a document the designer sent (or a model already read). */
  private model(report: ReportDocument | Report): Report {
    return isModel(report) ? report : modelFromDocument(report);
  }

  /**
   * A fresh run of the report, with the connections, culture and clock of the alias, for the tools
   * that lay nothing out (columns, functions, syntax, evaluate, data): with the standard fonts, so a
   * machine without fonts (a slim container) still answers them; the preview uses the server's.
   */
  private run(model: Report, context: OperationContext): Promise<ReportRun> {
    return this.backend.open(model, this.aliasOf(context), false).prepareRun();
  }

  /** The culture of the server (the translator of the engine's texts follows it). */
  private translator(): Translator {
    return Translator.forCulture(CultureInfo.get(this.options.culture ?? 'en-US'));
  }

  // ---- read / write / execute ----

  /** ReadStored: the model of a stored report ("ALIAS/path.rep") and its ETag. */
  async readStoredModel(reportName: string): Promise<{ model: Report; eTag: string }> {
    const { alias, path: reportPath } = DesignerOperations.splitName(reportName);
    const stored = await this.backend.store.open(alias, reportPath);
    return { model: modelFromXml(stored.content), eTag: stored.eTag };
  }

  /** ReadStored: a stored report ("ALIAS/path.rep") as the designer's JSON, and its ETag. */
  async readStored(reportName: string): Promise<{ report: ReportDocument; eTag: string }> {
    const { model, eTag } = await this.readStoredModel(reportName);
    return { report: designerDocument(model), eTag };
  }

  /** ReadFromBase64Xml: the model of a .rep given in base64. */
  private modelFromBase64(base64: string): Report {
    return modelFromXml(fromBase64(base64));
  }

  /** ReadFromBase64Xml: a .rep given in base64, as the designer's JSON. */
  async readFromBase64Xml(base64: string): Promise<ReportDocument> {
    return designerDocument(this.modelFromBase64(base64));
  }

  /** The clock of the server (DateTime.Now). */
  private now(): Date {
    return this.options.clock?.now() ?? new Date();
  }

  /**
   * Write: saves a report ("ALIAS/path.rep") as .rep XML with the ETag it was opened with (the
   * current one when none is given; a name that does not exist yet is created), the undo history
   * older than four years pruned. Returns the new ETag.
   */
  async write(reportName: string, report: ReportDocument | Report, expectedETag: string | null): Promise<string> {
    const { alias, path: reportPath } = DesignerOperations.splitName(reportName);
    const model = this.model(report);
    // Like the ERP: the undo history travels inside the document; what is older than four years goes
    const cue = model.undoCue;
    if (cue !== undefined) {
      const limit = addYears(this.now(), -4).getTime();
      const recent = (op: { date?: Date }) => !(op.date instanceof Date) || !(op.date.getTime() < limit);
      cue.undoOperations = cue.undoOperations.filter(recent);
      cue.redoOperations = cue.redoOperations.filter(recent);
    }
    const xml = writeReportXmlBytes(model);
    const store = this.backend.store;
    try {
      return (await store.save(alias, reportPath, xml, expectedETag ?? (await this.currentETagOrNull(alias, reportPath)))).eTag;
    } catch (e) {
      // Saving a name that does not exist yet creates it
      if (isNotFound(e)) return (await store.save(alias, reportPath, xml, null)).eTag;
      throw e;
    }
  }

  private async currentETagOrNull(alias: string, reportPath: string): Promise<string | null> {
    try {
      return (await this.backend.store.open(alias, reportPath)).eTag;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /** Execute: the preview, with the values the parameters form would start from. */
  async execute(report: ReportDocument | Report, subreportIndexes: number[] | null, context: OperationContext = {}): Promise<ReportResult> {
    const model = this.model(report);
    const runner = this.backend.open(model, this.aliasOf(context), true);
    let meta: PrintedMetafile | undefined;
    let pdf: Uint8Array;
    try {
      pdf = await runner.executeToPdf({
        subReportIndexes: subreportIndexes ?? undefined,
        onMetafile: (m) => (meta = m),
      });
    } catch (e) {
      if (e instanceof NoDataToPrintException) throw new NoDataError(e.message);
      throw e;
    }
    const printed = meta as typeof meta;
    const result: ReportResult = {
      base64Pdf: bytesToBase64(pdf),
      pageWidth: printed?.customX ?? 0,
      pageHeight: printed?.customY ?? 0,
      pageCount: printed?.pages.currentCount ?? 0,
    };
    if (printed !== undefined) {
      result.pageSizeIndex = printed.pageSizeIndex;
      result.pageSizeName = pageSizeName(printed.pageSizeIndex);
    }
    return result;
  }

  /** Duplicate: copies a stored report to a new name (which must not exist). */
  async duplicate(reportName: string, newReportName: string): Promise<void> {
    const { alias, path: reportPath } = DesignerOperations.splitName(reportName);
    const target = DesignerOperations.splitName(newReportName);
    const stored = await this.backend.store.open(alias, reportPath);
    await this.backend.store.save(target.alias, target.path, stored.content, null);
  }

  /** ImportName: saves a .rep given in base64 under a new name (written again, as C# does). */
  async importName(reportName: string, base64Xml: string): Promise<void> {
    const { alias, path: reportPath } = DesignerOperations.splitName(reportName);
    const model = this.modelFromBase64(base64Xml);
    await this.backend.store.save(alias, reportPath, writeReportXmlBytes(model), null);
  }

  // ---- functions, evaluation, datasets ----

  /** The key of the columns of a dataset: its definition and what the server opens for its connection. */
  private columnsKey(model: Report, context: OperationContext): (dinfo: DataInfo) => string {
    const alias = this.aliasOf(context);
    return (dinfo) => datasetKey(model, dinfo, (databaseAlias) => this.backend.fingerprint(alias, databaseAlias));
  }

  /** The columns of every dataset of the report (the cache), with the errors of the ones that failed. */
  private async datasetColumns(model: Report, context: OperationContext, refresh: boolean, errors: string[]): Promise<Map<string, DatasetColumn[]>> {
    return this.columns.getAll(model, this.columnsKey(model, context), () => this.run(model, context), refresh, errors);
  }

  /** ReadFunctionList: the identifiers of the expression editor, and the dataset columns. */
  async readFunctionList(report: ReportDocument, readColumns: boolean, refreshColumns: boolean, context: OperationContext = {}): Promise<FunctionHelp[]> {
    const model = this.model(report);
    const trans = this.translator();
    const result: FunctionHelp[] = [];
    const run = await this.run(model, context);
    try {
      const runtime = run.runtime;
      const evaluator = new Evaluator({ context: runtime.evaluator.context, host: runtime.evaluator.host, language: runtime.language });
      runtime.addReportItemsToEvaluator(evaluator);
      // The evaluator registers some identifiers more than once (the report adds them again): one entry each
      const seen = new Set<string>();
      for (const iden of evaluator.identifiers) {
        const categoryKey =
          iden instanceof EvalIdenExpression ? 208 : iden instanceof IdenFunction ? 248 : iden instanceof IdenVariable ? 249 : iden instanceof IdenConstant ? 250 : 0;
        if (categoryKey === 0) continue;
        const category = trans.translateStr(categoryKey);
        const key = (category + '|' + iden.name).toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const entry: FunctionHelp = { name: iden.name, category, categoryKey };
        // C# null: no model or help
        if (iden.model.length > 0) entry.model = iden.model;
        if (iden.help.length > 0) entry.hint = iden.help;
        result.push(entry);
      }
    } finally {
      await run.close();
    }
    const catOperators = trans.translateStr(251);
    const operator = (name: string, modelKey: number): FunctionHelp => ({ category: catOperators, categoryKey: 251, name, model: trans.translateStr(modelKey), modelKey });
    result.push(operator('+', 453), operator('-', 454), operator('*', 455), operator('/', 456));
    result.push({ category: catOperators, categoryKey: 251, name: ':=', model: 'Assign value to variable' });
    for (const op of ['=', '>=', '<=', '<', '>', '<>']) result.push(operator(op, 457));
    for (const op of ['AND', 'OR', 'NOT']) result.push(operator(op, 458));
    result.push({ name: ';', model: trans.translateStr(463), modelKey: 463 });
    result.push({ ...operator('IIF', 462), hint: trans.translateStr(463), hintKey: 463 });

    if (readColumns) {
      // Columns come from the cache: a dataset is opened once per SQL text, not on every dialog
      const category = trans.translateStr(247);
      const errors: string[] = [];
      const columns = await this.datasetColumns(model, context, refreshColumns, errors);
      for (const dinfo of model.dataInfo) {
        const list = columns.get(dinfo.alias.toUpperCase());
        if (list === undefined) continue;
        for (const c of list) {
          const name = dinfo.alias + '.' + c.name;
          result.push({ category, categoryKey: 247, name, model: name, hint: typeLabel(c.type) });
        }
      }
      if (errors.length > 0 && columns.size === 0) throw new Error(errors.join('; '));
    }
    return result;
  }

  /** CheckSyntax: parses an expression against the report without evaluating it. */
  async checkSyntax(report: ReportDocument, expression: string, context: OperationContext = {}): Promise<SyntaxCheckResult> {
    const model = this.model(report);
    const errors: string[] = [];
    const columns = await this.datasetColumns(model, context, false, errors);
    const run = await this.run(model, context);
    try {
      const runtime = run.runtime;
      const evaluator = new Evaluator({ context: runtime.evaluator.context, host: runtime.evaluator.host, language: runtime.language });
      runtime.addReportItemsToEvaluator(evaluator);
      const aliases = new DatasetAlias();
      for (const dinfo of model.dataInfo) {
        const list = columns.get(dinfo.alias.toUpperCase()) ?? [];
        const names: string[] = [];
        for (const c of list) if (!names.some((n) => n.toUpperCase() === c.name.toUpperCase())) names.push(c.name);
        // One empty row: the evaluator reads the field of the current row even when it only checks
        aliases.add(dinfo.alias, new MemoryTable(names, [names.map(() => null)]));
      }
      evaluator.aliasList = aliases;
      try {
        evaluator.checkSyntax(expression ?? '');
        return { valid: true, datasetErrors: errors };
      } catch (e) {
        if (e instanceof EvalException) return { valid: false, message: e.message, line: e.sourceLine, position: e.sourcePos, datasetErrors: errors };
        return { valid: false, message: message(e), datasetErrors: errors };
      }
    } finally {
      await run.close();
    }
  }

  /** Evaluate: the value of an expression, the datasets it needs opened. */
  async evaluate(report: ReportDocument, expression: string, context: OperationContext = {}): Promise<EvaluateResult> {
    const model = this.model(report);
    const run = await this.run(model, context);
    try {
      await run.applyDefaults();
      const runtime = run.runtime;
      const evaluator = new Evaluator({ context: runtime.evaluator.context, host: runtime.evaluator.host, language: runtime.language });
      // A field of a dataset that is not open opens it (OnDatasetNeeded). The data host may answer
      // asynchronously (a network database), and the evaluator does not wait: the evaluation stops,
      // the datasets open, and the expression is evaluated again with them open
      const tried = new Set<object>();
      let needed: { dataset: string; open: (typeof runtime.dataInfos)[number][] } | null = null;
      evaluator.onDatasetNeeded = (args) => {
        const dataset = args.dataset ?? '';
        // An unqualified field (TOTALAMOUNT) can be in any dataset: open them all
        const candidates = dataset.length === 0 ? runtime.dataInfos : [runtime.dataInfoByAlias(dataset)].filter((d) => d !== null);
        const open = candidates.filter((d) => !tried.has(d) && d.dataReader === null && d.data.columns.length === 0);
        if (open.length === 0) return;
        needed = { dataset, open };
        throw new Error('The dataset ' + (dataset.length > 0 ? dataset : open[0]!.alias) + ' is being opened');
      };
      runtime.addReportItemsToEvaluator(evaluator);
      const aliases = new DatasetAlias();
      for (const dinfo of runtime.dataInfos) aliases.add(dinfo.alias, dinfo.data);
      evaluator.aliasList = aliases;
      let value: Variant;
      for (;;) {
        needed = null;
        evaluator.expression = expression;
        try {
          value = evaluator.evaluate();
          break;
        } catch (e) {
          const need = needed as { dataset: string; open: (typeof runtime.dataInfos)[number][] } | null;
          if (need === null) throw e;
          for (const dinfo of need.open) {
            tried.add(dinfo);
            try {
              runtime.updateParamsBeforeOpen(runtime.dataInfoIndexOf(dinfo.alias), true);
              await runAsync(dinfo.connect());
            } catch (e2) {
              // another dataset may hold an unqualified field
              if (need.dataset.length > 0) throw e2;
            }
          }
        }
      }
      return { value: value.toString(evaluator.context), dataType: DB_TYPES[value.varType] ?? 'Object' };
    } finally {
      await run.close();
    }
  }

  /** ReadDataset: the columns and the first 500 rows of a dataset, with another SQL. */
  async readDataset(report: ReportDocument, sql: string, datasetName: string, context: OperationContext = {}, maxRows = 500): Promise<DataSetInformation[]> {
    const model = this.model(report);
    const result: DataSetInformation[] = [];
    const dinfoModel = model.dataInfo.find((d) => d.alias.toUpperCase() === (datasetName ?? '').toUpperCase());
    if (dinfoModel === undefined) return result;
    const run = await this.run(model, context);
    try {
      await run.applyDefaults();
      const runtime = run.runtime;
      const dinfo = runtime.dataInfoByAlias(dinfoModel.alias)!;
      dinfo.sqlOverride = sql ?? '';
      await runAsync(dinfo.connect());
      const info: DataSetInformation = {
        name: dinfo.alias,
        columns: datasetColumns(run, dinfo.alias).map((c) => ({ name: c.name, dbType: c.type })),
        rows: [],
      };
      // Walked with the engine's own cursor, so the record it fetched on Connect is not skipped
      const data = dinfo.data;
      while (!data.eof && info.rows!.length < maxRows) {
        const row = data.currentRow;
        if (row === null) break;
        info.rows!.push({ values: data.columns.map((_c, i) => rowValue(row.values[i] ?? null)) });
        if (!(await runAsync(data.next()))) break;
      }
      result.push(info);
    } finally {
      await run.close();
    }
    return result;
  }

  /** ReadAllTableColumns: the tables and columns behind every connection of the report. */
  async readAllTableColumns(report: ReportDocument): Promise<DataSetInformation[]> {
    const model = this.model(report);
    const result: DataSetInformation[] = [];
    const errors: string[] = [];
    for (const db of model.databaseInfo) {
      const schema = await this.schemas.get(db.alias ?? '', false);
      if (schema.error !== null && schema.schemaTables.length === 0) {
        if (schema.kind !== 'unknown') errors.push(schema.error);
        continue;
      }
      for (const table of schema.schemaTables) {
        result.push({
          name: table.name,
          columns: table.columns.map((c) => ({ name: c.name, dbType: c.detectedType.length === 0 ? c.dataType : c.detectedType })),
          rows: [],
        });
      }
    }
    if (result.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
    return result;
  }

  // ---- import / export ----

  /** ExportReport: the report as .rep XML in base64. */
  async exportReport(report: ReportDocument | Report): Promise<EvaluateResult> {
    return { value: bytesToBase64(writeReportXmlBytes(this.model(report))), dataType: 'System.String' };
  }

  /** ExportSubReport: a subreport as a .rep of its own, in base64. */
  async exportSubReport(report: ReportDocument, subreportIndex: number): Promise<EvaluateResult> {
    // ExternalReport.ExportSubReport: XML, or zlib compressed when the report's stream format is XMLZlib
    return { value: bytesToBase64(exportSubReport(this.model(report), subreportIndex)), dataType: 'System.String' };
  }

  /** ImportSubReport: the subreports of a .rep in base64 added to the report (to an empty one: null). */
  async importSubReport(target: ReportDocument | null, base64Xml: string): Promise<ReportDocument> {
    // ImportEmpty: into a new report (new Report() of C#)
    const model = target === null ? new Report() : this.model(target);
    const source = this.modelFromBase64(base64Xml);
    return designerDocument(importReport(model, source));
  }

  // ---- the SQL editor ----

  /** SqlSchema: the tables, columns and keys of a connection alias, for the SQL editor. */
  async sqlSchema(alias: string, refresh: boolean): Promise<SqlSchema> {
    return this.schemas.get(alias, refresh);
  }
}

function isModel(report: ReportDocument | Report): report is Report {
  return typeof (report as Report).updateComponentList === 'function';
}
