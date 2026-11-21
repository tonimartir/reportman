import { Report } from "../../models/report.js";

export class ReportGenericRequest {
  public properties?: ReportRequestProperty[];
}

export class ReadReportRequest extends ReportGenericRequest {
  public operation = ReadReportOperation.ReadReport;
  public reportName?: string;
  public report?: Report;
  public expression?: string;
  public datasetName?: string;
  public group?: string;
}

export class ExecuteReportRequest extends ReportGenericRequest {
  public report?: Report;
  public reportName?: string;
  public subreportIndexes?: number[];
}

export class WriteReportRequest extends ReportGenericRequest {
  public reportName?: string;
  public report?: Report;
  public reportJson?: string;
}

export class ReportRequestProperty {
  public name?: string;
  public value?: string;
}

export enum ReadReportOperation {
  ReadReport = 0,
  ReadFunctions = 1,
  ReadColumns = 2,
  ReadFunctionsColumns = 3,
  Evaluate = 4,
  ReadAllTableColumns = 5,
  ReadDataset = 6,
  ExportSubReport = 7,
  ExportReport = 8,
  Import = 9,
  ImportEmpty = 10,
  Duplicate = 11,
  ImportName = 12,
  /** Parses the expression against the report without evaluating it (the editor's syntax check). */
  CheckSyntax = 13,
}
