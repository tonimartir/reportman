// The reports API of Reportman.Server (ReportsController, HealthController), framework
// independent: a request in, a response out. The adapters of node.ts plug it into node:http,
// Express and Fastify.
//
//   GET  /api/health
//   GET  /api/reports/aliases
//   GET  /api/reports/{alias}/tree
//   GET  /api/reports/{alias}/parameters?path=        (the frozen shape of Reportman.Server)
//   GET  /api/reports/{alias}/parameters/describe?path=   (ParameterDescription, step 1)
//   GET  /api/reports/{alias}/execute?path=&format=&PARAM=value[&download=1]
//   POST /api/reports/{alias}/execute?path=&format=    (a JSON body { parameters, format } or a form)
//
// A key (X-ReportmanServer-ApiKey header or apikey in the query) opens the reports of its aliases;
// without keys configured the API is open, for a server only its own programs reach.

import { gzipSync } from 'node:zlib';
import { openReport, isSynchronousDataRequired, NoDataToPrintException, ParameterException, ReportException } from '@reportman/node';
import type { ConnectionFactory, DatasetSource, FontOptions, NodeReport, OpenReportOptions, PdfClock } from '@reportman/node';
import { TextDevice, decodeCp437, encodeUtf8, metafileToCsv, runReportToText } from '@reportman/export';
import { writeRpmf } from '@reportman/metafile';
import { FolderReportStore, ServerError } from './store.js';

/** A request, whatever the framework. */
export interface ServerRequest {
  method: string;
  /** The path, without the query ("/api/reports/SAMPLES/execute"). */
  path: string;
  query: URLSearchParams;
  /** Header names in lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body?: Uint8Array;
}

/** A response, whatever the framework. */
export interface ServerResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** An API key: the aliases whose reports it runs ('*' all of them). */
export interface ApiKey {
  key: string;
  name?: string;
  aliases: readonly string[] | '*';
}

/** Options of createReportServer. */
export interface ReportServerOptions {
  /** The folder of .rep files of each alias. */
  aliases: Readonly<Record<string, string>>;
  /** The connections of the reports, by connection alias; or a function of the report alias. */
  connections?: Readonly<Record<string, ConnectionFactory>> | ((alias: string) => Readonly<Record<string, ConnectionFactory>>);
  /** Rows for datasets, as in openReport. */
  datasets?: Readonly<Record<string, DatasetSource>>;
  /** The keys that open the API; without keys it is open. */
  apiKeys?: readonly ApiKey[];
  /** The culture of the runs (en-US by default). */
  culture?: string;
  /**
   * The fonts of the PDF, metafile and CSV (their layout): the system TrueType fonts by default, as
   * the FreeType device of Reportman.Server; false for the standard 14 PDF fonts.
   */
  fonts?: FontOptions | false;
  /** FILEEXISTS, image files, LOADFILE and GETINIVALUE may read files (false by default). */
  allowFileAccess?: boolean;
  /**
   * The "text" format: the PLAIN text of Reportman.Server by default (PrintOutText with the PLAIN
   * driver, its bytes read in code page 437 and answered in UTF-8); a function gives another one
   * (another driver, a printer configuration), false turns the format off (501).
   */
  text?: ((report: NodeReport, assign: Readonly<Record<string, unknown>>) => Promise<Uint8Array>) | false;
  /** The clock of TODAY, NOW and the dates of the PDF (the system clock by default). */
  clock?: PdfClock;
  /** The version the health check gives (the one of the server's package by default). */
  version?: string;
}

const FORMATS: Record<string, { contentType: string; extension: string }> = {
  pdf: { contentType: 'application/pdf', extension: 'pdf' },
  metafile: { contentType: 'application/x-reportman-metafile', extension: 'rpmf' },
  text: { contentType: 'text/plain; charset=utf-8', extension: 'txt' },
  csv: { contentType: 'text/csv; charset=utf-8', extension: 'csv' },
};
// The query values that are not parameters of the report
const RESERVED = new Set(['path', 'format', 'apikey', 'download', '_']);
const API_KEY_HEADER = 'x-reportmanserver-apikey';

const encoder = new TextEncoder();
const json = (status: number, value: unknown): ServerResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: encoder.encode(JSON.stringify(value)),
});

/** The parameters of the query: every value but the reserved ones (QueryParameters). */
function queryParameters(query: URLSearchParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of query) if (!RESERVED.has(k.toLowerCase())) result[k] = v;
  return result;
}

/** The text fields of a multipart/form-data body. */
function multipartFields(body: Uint8Array, contentType: string): URLSearchParams {
  const fields = new URLSearchParams();
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (m === null) return fields;
  const boundary = '--' + (m[1] ?? m[2]!).trim();
  const text = new TextDecoder('utf-8').decode(body);
  for (const part of text.split(boundary)) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.substring(0, headerEnd);
    const name = /name="([^"]*)"/i.exec(headers);
    if (name === null || /filename="/i.test(headers)) continue;
    fields.append(name[1]!, part.substring(headerEnd + 4).replace(/\r\n$/, ''));
  }
  return fields;
}

/** The parameters and the format of the body of an execute (a JSON object, a form or multipart). */
function bodyParameters(request: ServerRequest): { parameters: Record<string, unknown>; format?: string } {
  const body = request.body;
  if (body === undefined || body.length === 0) return { parameters: {} };
  const contentType = request.headers['content-type'] ?? '';
  if (/application\/x-www-form-urlencoded/i.test(contentType) || /multipart\/form-data/i.test(contentType)) {
    const form = /multipart/i.test(contentType) ? multipartFields(body, contentType) : new URLSearchParams(new TextDecoder('utf-8').decode(body));
    return { parameters: queryParameters(form), format: form.get('format') ?? undefined };
  }
  const text = new TextDecoder('utf-8').decode(body);
  if (text.trim().length === 0) return { parameters: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ServerError(400, 'The body is not valid JSON.');
  }
  if (value === null || typeof value !== 'object') return { parameters: {} };
  // { parameters, format }, the names in any case (PropertyNameCaseInsensitive)
  const o = value as Record<string, unknown>;
  const key = (name: string): string | undefined => Object.keys(o).find((k) => k.toLowerCase() === name);
  const p = key('parameters');
  const f = key('format');
  return {
    parameters: p !== undefined && o[p] !== null && typeof o[p] === 'object' ? (o[p] as Record<string, unknown>) : {},
    format: f !== undefined && typeof o[f] === 'string' ? (o[f] as string) : undefined,
  };
}

/** The reports API of Reportman.Server over folders of .rep files. */
export class ReportServer {
  readonly store: FolderReportStore;
  private readonly options: ReportServerOptions;

  constructor(options: ReportServerOptions) {
    this.options = options;
    this.store = new FolderReportStore(options.aliases);
  }

  /** The key of a request, or null without keys configured (the API is open). */
  private caller(request: ServerRequest): ApiKey | null {
    const keys = this.options.apiKeys;
    if (keys === undefined || keys.length === 0) return null;
    const given = request.headers[API_KEY_HEADER] ?? request.query.get('apikey') ?? '';
    const key = keys.find((k) => k.key === given);
    if (given.length === 0 || key === undefined) throw new ServerError(401, 'A valid API key is required.');
    return key;
  }

  private canRun(key: ApiKey | null, alias: string): boolean {
    if (key === null || key.aliases === '*') return true;
    return key.aliases.some((a) => a.toUpperCase() === alias.toUpperCase());
  }

  private requireAlias(key: ApiKey | null, alias: string): void {
    if (this.store.aliasName(alias) === null) throw new ServerError(404, `Alias '${alias}' is not configured.`);
    if (!this.canRun(key, alias)) throw new ServerError(403, `This API key does not run the reports of '${alias}'.`);
  }

  private async open(alias: string, reportPath: string): Promise<{ report: NodeReport; path: string }> {
    const stored = this.store.open(alias, reportPath);
    const connections = typeof this.options.connections === 'function' ? this.options.connections(alias) : this.options.connections;
    const fonts = this.options.fonts === undefined ? {} : this.options.fonts;
    const options: OpenReportOptions = {
      connections,
      datasets: this.options.datasets,
      culture: this.options.culture,
      fonts,
      allowFileAccess: this.options.allowFileAccess,
      clock: this.options.clock,
    };
    return { report: await openReport(stored.content, options), path: stored.path };
  }

  /** Answers a request (a path outside /api/ is not found). */
  async handle(request: ServerRequest): Promise<ServerResponse> {
    try {
      return await this.route(request);
    } catch (e) {
      return errorResponse(e);
    }
  }

  private async route(request: ServerRequest): Promise<ServerResponse> {
    const method = request.method.toUpperCase();
    const parts = request.path.replace(/\/+$/, '').split('/').filter((p) => p.length > 0).map((p) => decodeURIComponent(p));
    if (parts[0]?.toLowerCase() !== 'api') return json(404, { error: 'Not found.' });
    if (parts.length === 2 && parts[1]!.toLowerCase() === 'health' && method === 'GET') {
      return json(200, { status: 'ok', version: this.options.version ?? '0.1.0-alpha.1', engine: 'typescript', aliases: this.store.listAliases() });
    }
    if (parts[1]?.toLowerCase() !== 'reports') return json(404, { error: 'Not found.' });
    const key = this.caller(request);
    if (parts.length === 3 && parts[2]!.toLowerCase() === 'aliases' && method === 'GET') {
      return json(200, this.store.listAliases().filter((a) => this.canRun(key, a)));
    }
    if (parts.length < 4) return json(404, { error: 'Not found.' });
    const alias = parts[2]!;
    const action = parts.slice(3).join('/').toLowerCase();
    this.requireAlias(key, alias);
    const reportPath = request.query.get('path') ?? '';
    if (action === 'tree' && method === 'GET') return json(200, this.store.getTree(alias));
    if (action === 'parameters' && method === 'GET') {
      const { report } = await this.open(alias, reportPath);
      // The shape of Reportman.Server: every parameter but the never visible ones
      return json(
        200,
        report.model.params
          .filter((p) => !p.neverVisible)
          .map((p) => ({
            name: p.alias,
            type: PARAM_TYPE_NAMES[p.paramType] ?? 'Unknown',
            description: p.descriptions[0] ?? '',
            hint: p.hints[0] ?? '',
            visible: p.visible,
            value: p.value?.value === null || p.value?.value === undefined ? '' : String(p.value.value),
            allowNulls: p.allowNulls,
          })),
      );
    }
    if (action === 'parameters/describe' && method === 'GET') {
      const { report } = await this.open(alias, reportPath);
      return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: encoder.encode(await report.describeParametersJson()) };
    }
    if (action === 'execute' && (method === 'GET' || method === 'POST')) {
      let parameters = queryParameters(request.query);
      let format = request.query.get('format') ?? undefined;
      if (method === 'POST') {
        const b = bodyParameters(request);
        // The body wins over the query for the same name (Merge)
        parameters = { ...parameters, ...b.parameters };
        format = format ?? b.format;
      }
      return this.execute(alias, reportPath, format, parameters, request.query.get('download'));
    }
    return json(404, { error: 'Not found.' });
  }

  private async execute(alias: string, reportPath: string, format: string | undefined, assign: Record<string, unknown>, download: string | null): Promise<ServerResponse> {
    const name = format === undefined || format.trim().length === 0 ? 'pdf' : format.trim().toLowerCase();
    const meta = FORMATS[name];
    if (meta === undefined) throw new ServerError(400, `Unknown format '${format}'. Use pdf, metafile, text or csv.`);
    const { report, path } = await this.open(alias, reportPath);
    let bytes: Uint8Array;
    if (name === 'pdf') bytes = await report.executeToPdf(null, { assign });
    else if (name === 'metafile') bytes = writeRpmf(await report.executeToMetafile(null, { assign }), { compressed: true });
    else if (name === 'csv') {
      // Semicolon separated and quoted, UTF-8 with its BOM, as Reportman.Server (repwebexe's CSV)
      const csv = encoder.encode(metafileToCsv(await report.executeToMetafile(null, { assign }), { separator: ';' }));
      bytes = new Uint8Array(csv.length + 3);
      bytes.set([0xef, 0xbb, 0xbf]);
      bytes.set(csv, 3);
    } else {
      const text = this.options.text ?? plainText;
      if (text === false) throw new ServerError(501, 'The text format is not supported by this server.');
      bytes = await text(report, assign);
    }
    const fileName = path.replace(/^.*\//, '').replace(/\.rep$/i, '') + '.' + meta.extension;
    const disposition = download === '1' || download === 'true' ? 'attachment' : 'inline';
    return {
      status: 200,
      headers: { 'content-type': meta.contentType, 'content-disposition': `${disposition}; filename="${fileName}"` },
      body: bytes,
    };
  }
}

/**
 * The text format of Reportman.Server (ReportExecutionService.ExecuteToText): the report laid out
 * and printed by PrintOutText with the PLAIN driver, a report without data an error; the bytes read
 * in code page 437 (PrintResult) and answered in UTF-8.
 */
async function plainText(report: NodeReport, assign: Readonly<Record<string, unknown>>): Promise<Uint8Array> {
  const device = new TextDevice({ driver: 'PLAIN' });
  device.emptyReportThrowException = true;
  const bytes = await report.executeWithDevice(device, (run) => runReportToText(run), null, { assign });
  return encodeUtf8(decodeCp437(bytes));
}

// ParamType.ToString() of C#
const PARAM_TYPE_NAMES = [
  'String', 'Integer', 'Double', 'Date', 'Time', 'DateTime', 'Currency', 'Bool', 'ExpreB', 'ExpreA',
  'Subst', 'List', 'Multiple', 'SubstExpre', 'SubsExpreList', 'InitialValue', 'Unknown',
];

/** The response of an error, with the codes of Reportman.Server (ReportsController.Wrap). */
export function errorResponse(e: unknown): ServerResponse {
  if (e instanceof ServerError) return json(e.status, { error: e.message, ...e.extra });
  if (e instanceof NoDataToPrintException) return json(422, { error: e.message, noData: true });
  if (e instanceof ReportException) return json(422, { error: e.message, errorComponentName: e.itemName, errorComponentProperty: e.propertyName });
  if (e instanceof ParameterException) return json(400, { error: e.message, parameter: e.parameter });
  if (isSynchronousDataRequired(e)) return json(422, { error: (e as Error).message });
  return json(500, { error: e instanceof Error ? e.message : String(e) });
}

/** The reports API of Reportman.Server over folders of .rep files. */
export function createReportServer(options: ReportServerOptions): ReportServer {
  return new ReportServer(options);
}

/** The gzip of a response body, for an adapter whose client accepts it. */
export function gzipBody(body: Uint8Array): Uint8Array {
  return gzipSync(body);
}
