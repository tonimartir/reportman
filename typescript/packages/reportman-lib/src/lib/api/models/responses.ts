import { Report } from "../../models/report.js";
import { ReportResult } from "./report-result.js";

export class ReportGenericResponse {
  public errorMessage?: string;
  public errorComponentName?: string;
  public errorComponentProperty?: string;
}
export class ReadReportResponse extends ReportGenericResponse {
  public report?: Report;
  public functions?: FunctionHelp[];
  public dataSets?: DataSetInformation[];
  public evaluateResult?: EvaluateResult;
  public syntaxCheck?: SyntaxCheckResult;
}
export class SyntaxCheckResult {
  public valid = false;
  public message?: string;
  /** 1-based line of the error, when the parser knows it. */
  public line?: number;
  /** 1-based column of the error, when the parser knows it. */
  public position?: number;
  public datasetErrors?: string[];
}
export class EvaluateResult {
  public dataType?: string;
  public value: any;
}
export class WriteReportResponse extends ReportGenericResponse {}

export class ExecuteReportResponse extends ReportGenericResponse {
  public result?: ReportResult;
  /** The report printed nothing: its datasets returned no rows. */
  public noData?: boolean;
}

export interface FunctionHelp {
  name: string;
  category: string;
  model?: string;
  hint?: string;
  /** The engine's string numbers (RpKey_n) of category, model and hint, when they are one. */
  categoryKey?: number;
  modelKey?: number;
  hintKey?: number;
}
export interface DataSetInformation {
  name: string;
  columns: DataSetColumn[];
  rows?: DataSetRow[];
}
export interface DataSetColumn {
  dbType: string;
  name: string;
}
export interface DataSetRow {
  values: any[];
}
