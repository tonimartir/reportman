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
//
// With a data folder (dataPath, laid out as the one of Reportman.Server) the server also keeps its
// aliases, API keys and connections there, and answers the administration routes of
// Reportman.Server (console.ts) and its console page at / (assets/console.html):
//
//   /api/connections[/{alias}[/test]], /api/connections/providers[/{name}/parameters]
//   /api/console/aliases[/{alias}], /api/console/keys[/{id}[/rotate]], POST /api/console/samples
//   /api/reports/samples[/thumbnails/{name}], GET /api/console/status

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { openReport, isSynchronousDataRequired, NoDataToPrintException, ParameterException, ReportException } from '@reportman/node';
import { createContext, variantFromModel } from '@reportman/engine';
import type { ConnectionFactory, DatasetSource, FontOptions, NodeReport, OpenReportOptions, PdfClock } from '@reportman/node';
import { TextDevice, decodeCp437, encodeUtf8, metafileToCsv, runReportToText } from '@reportman/export';
import { writeRpmf } from '@reportman/metafile';
import { FolderReportStore, ServerError } from './store.js';
import { ConsoleApi, type ConsoleAnswer } from './console.js';
import { ServerData } from './data.js';
import { connectionFactories, type ServerDrivers } from './connections.js';

/** A request, whatever the framework. */
export interface ServerRequest {
  method: string;
  /** The path, without the query ("/api/reports/SAMPLES/execute"). */
  path: string;
  query: URLSearchParams;
  /** Header names in lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body?: Uint8Array;
  /** The address of the client (the socket's), when the adapter knows it. */
  remoteAddress?: string;
  /**
   * The request of the framework (node:http's IncomingMessage, Express's Request, Fastify's raw
   * request), for a hook that looks at the program's own session (the designer's authorize).
   */
  raw?: unknown;
  /**
   * Aborted when the client goes away before the answer ends, when the adapter can tell (nodeHandler,
   * fastifyPlugin): a server that relays a long answer stops the call it relays.
   */
  signal?: AbortSignal;
}

/** A server an adapter (nodeHandler, fastifyPlugin) plugs into a framework. */
export interface HttpServerLike {
  /** Whether a path is one this server answers: an adapter passes the others on. */
  owns(path: string): boolean;
  /** Answers a request. */
  handle(request: ServerRequest): Promise<ServerResponse>;
  /** The route patterns of a Fastify plugin ('/api/reports/*'...). */
  routes(): string[];
}

/** A response, whatever the framework. */
export interface ServerResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /**
   * A body that arrives in parts (the events of an AI answer), written as each part comes, with no
   * Content-Length; `body` is then empty. The adapters cancel it when the client goes away.
   */
  stream?: ReadableStream<Uint8Array>;
}

/** An API key: the aliases whose reports it runs ('*' all of them). */
export interface ApiKey {
  key: string;
  name?: string;
  aliases: readonly string[] | '*';
}

/** Options of createReportServer. */
export interface ReportServerOptions {
  /**
   * The folder of .rep files of each alias, fixed by the program. With a data folder they are
   * served next to the aliases of its server.json (and the console does not change them).
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * The data folder, laid out as the one of Reportman.Server: informes/ (the report folders),
   * server.json (the aliases), apikeys.json (the API keys), dbxconnections.ini (the connections)
   * and ejemplos/ (the database of the sample reports). It turns on the console.
   */
  dataPath?: string;
  /**
   * The drivers of the connections of dbxconnections.ini (SQLite is built in): postgresql,
   * firebird, mysql and sqlserver take a connection string, agent the Hub database and key.
   */
  drivers?: ServerDrivers;
  /** The administrator's key of the console (X-ReportmanServer-AdminKey). */
  adminKey?: string;
  /** Open the console without a key: only for a server that just its own people reach. */
  trusted?: boolean;
  /** The Hub API that tests Agent connections (https://aiapi.reportman.es by default). */
  agentApiUrl?: string;
  /** Serve the console page at / (true with a data folder). */
  consolePage?: boolean;
  /**
   * The connections of the reports, by connection alias; or a function of the report alias. They
   * win over the ones of dbxconnections.ini with the same alias.
   */
  connections?: Readonly<Record<string, ConnectionFactory>> | ((alias: string) => Readonly<Record<string, ConnectionFactory>>);
  /** Rows for datasets, as in openReport. */
  datasets?: Readonly<Record<string, DatasetSource>>;
  /** Keys that open the API, besides the ones of apikeys.json; without any key it is open. */
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
  /** The callers design reports (canDesign of the sample reports): a designer is mounted next to it. */
  canDesign?: boolean;
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
export class ReportServer implements HttpServerLike {
  readonly store: FolderReportStore;
  /** The console, with a data folder. */
  readonly console: ConsoleApi | undefined;
  private readonly options: ReportServerOptions;

  constructor(options: ReportServerOptions) {
    this.options = options;
    if (options.aliases === undefined && options.dataPath === undefined) throw new Error('createReportServer needs aliases, a dataPath or both.');
    if (options.dataPath !== undefined) {
      this.console = new ConsoleApi({
        data: new ServerData(options.dataPath),
        drivers: options.drivers ?? {},
        adminKey: options.adminKey,
        trusted: options.trusted,
        agent: { apiUrl: options.agentApiUrl },
        canDesign: options.canDesign,
      });
    }
    const data = this.console?.data;
    // The aliases of server.json are read on each request: the console changes them
    this.store = new FolderReportStore(() => ({ ...(data?.aliasFolders() ?? {}), ...(options.aliases ?? {}) }));
  }

  /** Whether a path is one this server answers: an adapter passes the others on. */
  owns(path: string): boolean {
    const p = path.toLowerCase().replace(/\/+$/, '') || '/';
    if (p === '/api/health' || p === '/api/reports' || p.startsWith('/api/reports/')) return true;
    if (this.console === undefined) return false;
    if (p === '/api/connections' || p.startsWith('/api/connections/') || p.startsWith('/api/console/')) return true;
    return this.options.consolePage !== false && (p === '/' || p === '/console');
  }

  /** The route patterns of a Fastify plugin. */
  routes(): string[] {
    const routes = ['/api/health', '/api/reports/*'];
    if (this.console !== undefined) {
      routes.push('/api/connections', '/api/connections/*', '/api/console/*');
      if (this.owns('/')) routes.push('/', '/console');
    }
    return routes;
  }

  /** The key of a request, or null without any key (the API is open). */
  private caller(request: ServerRequest): ApiKey | null {
    const fixed = this.options.apiKeys ?? [];
    const stored = this.console?.data.keys() ?? [];
    if (fixed.length === 0 && stored.length === 0) return null;
    const given = request.headers[API_KEY_HEADER] ?? request.query.get('apikey') ?? '';
    if (given.length === 0) throw new ServerError(401, 'A valid API key is required.');
    const key = fixed.find((k) => k.key === given);
    if (key !== undefined) return key;
    const record = stored.length === 0 ? null : this.console!.data.authenticate(given);
    if (record === null) throw new ServerError(401, 'A valid API key is required.');
    return { key: given, name: record.name, aliases: record.aliases.includes('*') ? '*' : record.aliases };
  }

  private canRun(key: ApiKey | null, alias: string): boolean {
    if (key === null || key.aliases === '*') return true;
    return key.aliases.some((a) => a.toUpperCase() === alias.toUpperCase());
  }

  private requireAlias(key: ApiKey | null, alias: string): void {
    if (this.store.aliasName(alias) === null) throw new ServerError(404, `Alias '${alias}' is not configured.`);
    if (!this.canRun(key, alias)) throw new ServerError(403, `This API key does not run the reports of '${alias}'.`);
  }

  /**
   * The options a report of an alias opens with: the connections of dbxconnections.ini and the
   * ones of the program (those win), the datasets, culture, fonts, file access and clock of the
   * server. The designer server opens its reports with them too.
   */
  openOptions(alias: string): OpenReportOptions {
    const given = typeof this.options.connections === 'function' ? this.options.connections(alias) : this.options.connections;
    const fromFile = this.console === undefined ? {} : connectionFactories(this.console.connections, this.options.drivers ?? {});
    return {
      connections: { ...fromFile, ...(given ?? {}) },
      datasets: this.options.datasets,
      culture: this.options.culture,
      fonts: this.options.fonts === undefined ? {} : this.options.fonts,
      allowFileAccess: this.options.allowFileAccess,
      clock: this.options.clock,
    };
  }

  private async open(alias: string, reportPath: string): Promise<{ report: NodeReport; path: string }> {
    const stored = this.store.open(alias, reportPath);
    return { report: await openReport(stored.content, this.openOptions(alias)), path: stored.path };
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
    if (parts[0]?.toLowerCase() !== 'api') {
      const page = parts.length === 0 || (parts.length === 1 && parts[0]!.toLowerCase() === 'console');
      if (page && method === 'GET' && this.console !== undefined && this.options.consolePage !== false) return consolePage();
      return json(404, { error: 'Not found.' });
    }
    if (parts.length === 2 && parts[1]!.toLowerCase() === 'health' && method === 'GET') {
      return json(200, {
        status: 'ok',
        version: this.options.version ?? '4.1.0-alpha.3',
        engine: 'typescript',
        // As Reportman.Server; null without a data folder
        dataPath: this.options.dataPath === undefined ? null : path.resolve(this.options.dataPath),
        aliases: this.store.listAliases(),
        // Of the Node server alone: whether it has the console (a data folder)
        console: this.console !== undefined,
      });
    }
    if (this.console !== undefined) {
      const answer = await this.console.handle(method, parts.slice(1), request.query, request.headers, request.body);
      if (answer !== null) return consoleResponse(answer);
    } else if (['connections', 'console'].includes(parts[1]?.toLowerCase() ?? '')) {
      return json(404, { error: 'The console needs a data folder (dataPath).' });
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
      // The shape of Reportman.Server: every parameter but the never visible ones, the value as
      // Variant.ToString gives it in the culture of the server
      const ctx = createContext(this.options.culture ?? 'en-US');
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
            value: variantFromModel(p.value).toString(ctx),
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
    // A download as ASP.NET's File(bytes, type, name) writes it; inline as Reportman.Server sets it
    const disposition = download === '1' || download === 'true' ? attachmentDisposition(fileName) : `inline; filename="${fileName}"`;
    return {
      status: 200,
      headers: { 'content-type': meta.contentType, 'content-disposition': disposition },
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

// tchar of RFC 7230 (HttpRuleParser.IsTokenChar)
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * The Content-Disposition of a download as ASP.NET writes it (ContentDispositionHeaderValue with
 * SetHttpFileName): the name in ASCII (others as '_'), quoted when it is not a token, and the
 * name in UTF-8 as filename* (RFC 5987).
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = [...fileName].map((c) => (c.charCodeAt(0) > 0x7f ? '_' : c)).join('');
  const name = TOKEN.test(ascii) ? ascii : '"' + ascii.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  let star = "UTF-8''";
  for (const byte of new TextEncoder().encode(fileName)) {
    const c = String.fromCharCode(byte);
    star += byte > 0x7f || !TOKEN.test(c) || c === '*' || c === "'" || c === '%' ? '%' + byte.toString(16).toUpperCase().padStart(2, '0') : c;
  }
  return `attachment; filename=${name}; filename*=${star}`;
}

/** The response of a console route. */
function consoleResponse(answer: ConsoleAnswer): ServerResponse {
  if (answer.bytes !== undefined) {
    const headers: Record<string, string> = { 'content-type': answer.contentType ?? 'application/octet-stream' };
    if (answer.cacheControl !== undefined) headers['cache-control'] = answer.cacheControl;
    return { status: answer.status, headers, body: answer.bytes };
  }
  if (answer.json === undefined) return { status: answer.status, headers: {}, body: new Uint8Array(0) };
  return json(answer.status, answer.json);
}

let pageBytes: Uint8Array | undefined;

/** The console page (assets/console.html of the package). */
function consolePage(): ServerResponse {
  pageBytes ??= new Uint8Array(readFileSync(fileURLToPath(new URL('../assets/console.html', import.meta.url))));
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      // The page talks only to this server, and no other site frames it
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
    },
    body: pageBytes,
  };
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
