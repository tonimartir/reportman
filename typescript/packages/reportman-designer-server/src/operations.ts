// The designer operations of Reportman.Server (Reportman.Designer.Server's DesignerService), one by
// one, over the folder store and the engine of @reportman/node. A report travels as the JSON the
// designer edits (the camelCase document of the C# engine, read with hydrateReport); the answers
// are the ones of Reportman.Server (test/golden-http of @reportman/server compares them).

import { NoDataToPrintException, ReportException } from '@reportman/node';
import type { ReportServer } from '@reportman/server';
import type { DesignerServerOptions } from './designer.js';

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

const NOT_YET = 'This designer operation is not implemented yet in @reportman/designer-server.';

/** The operations of the designer over the store and the connections of a report server. */
export class DesignerOperations {
  readonly reports: ReportServer;
  private readonly options: DesignerServerOptions;

  constructor(reports: ReportServer, options: DesignerServerOptions) {
    this.reports = reports;
    this.options = options;
  }

  /** ReadStored: a stored report ("ALIAS/path.rep") as the designer's JSON, and its ETag. */
  async readStored(reportName: string): Promise<{ report: ReportDocument; eTag: string }> {
    void reportName;
    throw new Error(NOT_YET);
  }

  /** ReadFromBase64Xml: a .rep given in base64, as the designer's JSON. */
  async readFromBase64Xml(base64: string): Promise<ReportDocument> {
    void base64;
    throw new Error(NOT_YET);
  }

  /**
   * Write: saves a report ("ALIAS/path.rep") as .rep XML with the ETag it was opened with (the
   * current one when none is given; a name that does not exist yet is created), the undo history
   * older than four years pruned. Returns the new ETag.
   */
  async write(reportName: string, report: ReportDocument, expectedETag: string | null): Promise<string> {
    void reportName;
    void report;
    void expectedETag;
    throw new Error(NOT_YET);
  }

  /** Execute: the preview, with the values the parameters form would start from. */
  async execute(report: ReportDocument, subreportIndexes: number[] | null, reportName: string): Promise<ReportResult> {
    void report;
    void subreportIndexes;
    void reportName;
    throw new Error(NOT_YET);
  }

  /** Duplicate: copies a stored report to a new name (which must not exist). */
  async duplicate(reportName: string, newReportName: string): Promise<void> {
    void reportName;
    void newReportName;
    throw new Error(NOT_YET);
  }

  /** ImportName: saves a .rep given in base64 under a new name. */
  async importName(reportName: string, base64Xml: string): Promise<void> {
    void reportName;
    void base64Xml;
    throw new Error(NOT_YET);
  }

  /** ReadFunctionList: the identifiers of the expression editor, and the dataset columns. */
  async readFunctionList(report: ReportDocument, readColumns: boolean, refreshColumns: boolean): Promise<FunctionHelp[]> {
    void report;
    void readColumns;
    void refreshColumns;
    throw new Error(NOT_YET);
  }

  /** CheckSyntax: parses an expression against the report without evaluating it. */
  async checkSyntax(report: ReportDocument, expression: string): Promise<SyntaxCheckResult> {
    void report;
    void expression;
    throw new Error(NOT_YET);
  }

  /** Evaluate: the value of an expression, the datasets it needs opened. */
  async evaluate(report: ReportDocument, expression: string): Promise<EvaluateResult> {
    void report;
    void expression;
    throw new Error(NOT_YET);
  }

  /** ReadDataset: the columns and the first 500 rows of a dataset, with another SQL. */
  async readDataset(report: ReportDocument, sql: string, datasetName: string): Promise<DataSetInformation[]> {
    void report;
    void sql;
    void datasetName;
    throw new Error(NOT_YET);
  }

  /** ReadAllTableColumns: the tables and columns behind every connection of the report. */
  async readAllTableColumns(report: ReportDocument): Promise<DataSetInformation[]> {
    void report;
    throw new Error(NOT_YET);
  }

  /** ExportReport: the report as .rep XML in base64. */
  async exportReport(report: ReportDocument): Promise<EvaluateResult> {
    void report;
    throw new Error(NOT_YET);
  }

  /** ExportSubReport: a subreport as a .rep of its own, in base64. */
  async exportSubReport(report: ReportDocument, subreportIndex: number): Promise<EvaluateResult> {
    void report;
    void subreportIndex;
    throw new Error(NOT_YET);
  }

  /** ImportSubReport: the subreports of a .rep in base64 added to the report (to an empty one: null). */
  async importSubReport(target: ReportDocument | null, base64Xml: string): Promise<ReportDocument> {
    void target;
    void base64Xml;
    throw new Error(NOT_YET);
  }

  /** SqlSchema: the tables, columns and keys of a connection alias, for the SQL editor. */
  async sqlSchema(alias: string, refresh: boolean): Promise<unknown> {
    void alias;
    void refresh;
    void this.options;
    void NoDataToPrintException;
    throw new Error(NOT_YET);
  }
}
