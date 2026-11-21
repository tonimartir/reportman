import { ReadReportRequest, WriteReportRequest, ExecuteReportRequest } from "../models/requests.js";
import {
  ReadReportResponse,
  WriteReportResponse,
  ExecuteReportResponse,
} from "../models/responses.js";
import { IReportService } from "./ireport.service.js";
import { hydrateReport } from "./report-hydration.js";

/** How the service talks HTTP: the default is fetch; an Angular host passes HttpClient so its interceptors add the session headers. */
export type ReportServiceFetcher = (url: string, body: any) => Promise<any>;

/**
 * The part of the standard fetch API the default fetcher uses. The core packages compile without
 * DOM or Node types, so the global fetch (browsers, Node 18+) is reached through this shape.
 */
interface MinimalFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<any>;
}
type MinimalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<MinimalFetchResponse>;

const fetchJson: ReportServiceFetcher = async (url, body) => {
  const globalFetch = (globalThis as { fetch?: MinimalFetch }).fetch;
  if (typeof globalFetch !== "function") {
    throw new Error("There is no global fetch: pass a ReportServiceFetcher to ReportService");
  }
  const response = await globalFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

export class ReportService implements IReportService {
  constructor(private readonly post: ReportServiceFetcher = fetchJson) {}

  // The errors reach the caller unchanged (the designer's version also logged them to the console).
  public async getReadReportResponse(
    request: ReadReportRequest,
    url: string
  ): Promise<ReadReportResponse> {
    const data: ReadReportResponse = await this.post(url + "/ReadReport", request);
    if (data.report) {
      data.report = hydrateReport(data.report);
    }
    return data;
  }
  public async getWriteReportResponse(
    request: WriteReportRequest,
    url: string
  ): Promise<WriteReportResponse> {
    const data: WriteReportResponse = await this.post(url + "/WriteReport", request);
    return data;
  }
  public async getExecuteReportResponse(
    request: ExecuteReportRequest,
    url: string
  ): Promise<ExecuteReportResponse> {
    const data: ExecuteReportResponse = await this.post(url + "/ExecuteReport", request);
    return data;
  }
}
