import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ReportService,
  IReportService,
  ReadReportRequest,
  ReadReportResponse,
  WriteReportRequest,
  WriteReportResponse,
  ExecuteReportRequest,
  ExecuteReportResponse,
  ReportGenericRequest,
  IReportServiceParams,
} from '@reportman/lib';
import { TranslationService } from './translator.service';

export const REPORT_SERVICE_PARAMS = new InjectionToken<IReportServiceParams>('REPORT_SERVICE_PARAMS');

/**
 * The designer's door to its server: the three calls of the wire contract, sent through Angular's
 * HttpClient so the host's interceptors add the session. It also remembers the version tag of the
 * last report read and sends it back on save, so the server can refuse a stale write.
 */
@Injectable({ providedIn: 'root' })
export class NgxReportmanLibService implements IReportService {
  private params = inject(REPORT_SERVICE_PARAMS);
  private http = inject(HttpClient);
  private t = inject(TranslationService);
  public reportService: IReportService;
  /** Version tag per report name, as returned by the last ReadReport. */
  private eTags = new Map<string, string>();

  constructor() {
    this.reportService = new ReportService((url, body) => firstValueFrom(this.http.post(url, body)));
  }

  public async getReadReportResponse(request: ReadReportRequest): Promise<ReadReportResponse> {
    this.updateRequest(request);
    const response = await this.reportService.getReadReportResponse(request, this.getApiUrl());
    const eTag = (response as any)?.eTag as string | undefined;
    if (request.reportName && eTag) this.eTags.set(request.reportName, eTag);
    // The function list comes in the server's language; what has an engine string number is said
    // in the designer's (the categories, the operators).
    for (const f of response?.functions ?? []) {
      if (f.categoryKey) f.category = this.t.TranslateStr(f.categoryKey);
      if (f.modelKey) f.model = this.t.TranslateStr(f.modelKey);
      if (f.hintKey) f.hint = this.t.TranslateStr(f.hintKey);
    }
    return response;
  }

  public async getWriteReportResponse(request: WriteReportRequest): Promise<WriteReportResponse> {
    this.updateRequest(request);
    const eTag = request.reportName ? this.eTags.get(request.reportName) : undefined;
    if (eTag) (request.properties ??= []).push({ name: 'eTag', value: eTag });
    const response = await this.reportService.getWriteReportResponse(request, this.getApiUrl());
    const newTag = (response as any)?.eTag as string | undefined;
    if (request.reportName && newTag) this.eTags.set(request.reportName, newTag);
    return response;
  }

  public getExecuteReportResponse(request: ExecuteReportRequest): Promise<ExecuteReportResponse> {
    this.updateRequest(request);
    return this.reportService.getExecuteReportResponse(request, this.getApiUrl());
  }

  private getApiUrl(): string {
    const url = this.params?.getApiUrl();
    if (!url) throw new Error('No Url provided in ReportServiceParams, injection needed');
    return url;
  }

  private updateRequest(request: ReportGenericRequest): void {
    const newProperties = this.params.getProperties();
    if (!newProperties?.length) return;
    (request.properties ??= []).push(...newProperties);
  }
}
