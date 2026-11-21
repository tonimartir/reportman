import {
  ReadReportRequest,
  WriteReportRequest,
  ExecuteReportRequest,
  ReportRequestProperty,
} from "../models/requests.js";
import {
  ReadReportResponse,
  WriteReportResponse,
  ExecuteReportResponse,
} from "../models/responses.js";

export interface IReportService {
  getReadReportResponse(request: ReadReportRequest, url: string): Promise<ReadReportResponse>;
  getWriteReportResponse(request: WriteReportRequest, url: string): Promise<WriteReportResponse>;
  getExecuteReportResponse(
    request: ExecuteReportRequest,
    url: string
  ): Promise<ExecuteReportResponse>;
}

export interface IReportServiceParams {
  getProperties(): ReportRequestProperty[];
  getApiUrl(): string;
}
