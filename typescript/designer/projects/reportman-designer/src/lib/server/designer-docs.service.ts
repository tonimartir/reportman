import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { REPORT_SERVICE_PARAMS } from '../services/ngx-reportman-lib.service';

/** What the server's AiContext endpoint returns (mirrors AiContextBuilder.AiContext). */
export interface AiLiveContext {
  expressionContext: {
    datasetColumnsBlocks: string[];
    functions: { model: string; help: string }[];
    constants: { model: string; help: string }[];
    memoryVariablesBlock: string;
  };
  runtimeDataSources: {
    name: string;
    alias: string;
    runtimeSchema: { status: string; source: string; refreshRequired: boolean; datasetColumnsBlock: string; issues: { severity: string; code: string; message: string }[] };
  }[];
  openErrors: string[];
}

/**
 * The document conversions the copilot needs from the designer's server: the report as .rep XML
 * for the cloud (the proven round trip of the Delphi and C# designers), the answer back as the
 * JSON the designer edits, and the live context (datasets opened there, Agent or direct).
 */
@Injectable({ providedIn: 'root' })
export class DesignerDocsService {
  private http = inject(HttpClient);
  private params = inject(REPORT_SERVICE_PARAMS);

  /** `/api/designer/{operation}`, wherever the host put the designer's server. */
  url(operation: string): string {
    return this.params.getApiUrl().replace(/\/+$/, '') + '/' + operation;
  }

  async toXml(reportJson: string): Promise<string> {
    const reply = await firstValueFrom(this.http.post<{ xml: string }>(this.url('ToXml'), { reportJson }));
    return reply.xml;
  }

  async fromXml(xml: string): Promise<any> {
    const reply = await firstValueFrom(this.http.post<{ report: any }>(this.url('FromXml'), { xml }));
    return reply.report;
  }

  /**
   * The columns of a SQL the copilot wrote, run on the server as one more dataset of the report the cloud
   * gave back (its XML) — or the database's message when it does not run.
   */
  async sqlColumns(xml: string, databaseAlias: string, sql: string, parameters: unknown[] | undefined): Promise<{ columns?: { name: string; dataType: string }[]; error?: string }> {
    return firstValueFrom(this.http.post<{ columns?: { name: string; dataType: string }[]; error?: string }>(this.url('SqlColumns'), { xml, databaseAlias, sql, parameters: parameters ?? [] }));
  }

  /** The live context; with refresh the datasets are reopened instead of using the server's cached columns. */
  async aiContext(reportJson: string, refresh = false): Promise<AiLiveContext> {
    return firstValueFrom(this.http.post<AiLiveContext>(this.url('AiContext'), { reportJson, properties: refresh ? [{ name: 'refresh', value: 'true' }] : undefined }));
  }
}
